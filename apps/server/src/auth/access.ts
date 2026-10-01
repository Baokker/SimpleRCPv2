import type { IncomingHttpHeaders } from "node:http";
import type { Express, Request } from "express";
import { createEventLog } from "../eventLog.js";
import type { ProjectRuntimeManager } from "../projectRuntimeManager.js";
import { can, type Action } from "./permissions.js";
import { setSessionCookie, type AuthStore, type Identity } from "./identity.js";

export function originAllowed(headers: IncomingHttpHeaders, origins: string[]) {
  if (headers.origin) return origins.includes(headers.origin);
  return Boolean(headers.authorization?.startsWith("Bearer "));
}

export function createAccessLog(storagePath: string, runtimeManager: ProjectRuntimeManager) {
  const events = createEventLog(storagePath);
  return {
    deny(identity: Identity | undefined, projectId: string | undefined, action: string, reason: string) {
      const input = {
        type: "access_decision",
        memberId: identity?.kind === "member" ? identity.memberId : undefined,
        payload: { projectId: projectId ?? null, action, result: "denied", reason }
      };
      if (projectId && runtimeManager.find(projectId)) runtimeManager.get(projectId).events.append(input);
      else events.append(input);
    },
    awaitIdle: events.awaitIdle
  };
}

export function registerAccess(app: Express, options: {
  auth: AuthStore;
  publicOrigin: string;
  allowedOrigins: string[];
  accessLog: ReturnType<typeof createAccessLog>;
}) {
  app.post("/api/admin/session", (req, res) => {
    if (!originAllowed(req.headers, options.allowedOrigins)) {
      options.accessLog.deny(undefined, undefined, "admin:session", "Origin denied");
      res.status(403).json({ error: "Origin denied" });
      return;
    }
    if (!options.auth.isAdminToken(String(req.body?.token ?? ""))) {
      options.accessLog.deny(undefined, undefined, "admin:session", "Authentication required");
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    setSessionCookie(res, "srcp_admin", String(req.body.token), new URL(options.publicOrigin).protocol === "https:");
    res.json({ kind: "admin" });
  });
  app.get("/api/identity", (req, res) => {
    res.json({ identity: req.identity ?? null });
  });
  app.use("/api", (req, res, next) => {
    const projectId = req.path.match(/^\/projects\/([^/]+)/)?.[1];
    const joined = /^\/projects\/[^/]+\/join$/.test(req.path);
    const publicProject = /^\/projects\/[^/]+\/public$/.test(req.path);
    const action = actionForRequest(req);
    const resource = { projectId: projectId && !["import", "import-zip"].includes(projectId) ? projectId : undefined };
    function deny(status: number, reason: string) {
      options.accessLog.deny(req.identity, resource.projectId, action, reason);
      res.status(status).json({ error: reason });
    }
    if (!["GET", "HEAD", "OPTIONS"].includes(req.method) && !originAllowed(req.headers, options.allowedOrigins)) {
      deny(403, "Origin denied");
      return;
    }
    if (req.path === "/health" || req.path === "/admin/session" || joined || publicProject) { next(); return; }
    if (!req.identity) { deny(401, "Authentication required"); return; }
    if (!can(req.identity, action, resource)) { deny(403, "Permission denied"); return; }
    for (const source of [req.body, req.query]) {
      for (const field of ["memberId", "authorId", "initiatorId", "participantId"]) {
        if (source?.[field] !== undefined && (req.identity.kind !== "member" || source[field] !== req.identity.memberId)) {
          deny(403, `${field} does not match authenticated member`);
          return;
        }
      }
    }
    next();
  });
}

function actionForRequest(req: Request): Action {
  if (req.path.includes("/invites")) return "invite:manage";
  if (req.path === "/agent/settings" && req.method === "PUT") return "agent:settings";
  if (/^\/projects\/[^/]+\/members\/[^/]+$/.test(req.path)) return "member:role";
  if (req.path === "/projects" && req.method === "GET") return "project:list";
  if ((req.path === "/projects" && req.method === "POST") || /^\/projects\/import/.test(req.path) || (/^\/projects\/[^/]+$/.test(req.path) && req.method === "DELETE")) return "project:write";
  return "project:read";
}
