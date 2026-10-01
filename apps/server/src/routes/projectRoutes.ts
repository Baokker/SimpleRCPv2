import express, { type Express } from "express";
import type { AgentRunManager } from "../agent/agentRunManager.js";
import type { ProjectRuntimeManager } from "../projectRuntimeManager.js";
import type { ProjectRegistry } from "../projects.js";
import { setSessionCookie, type AuthStore } from "../auth/identity.js";
import { requirePermission } from "../auth/permissions.js";

export function registerProjectRoutes(
  app: Express,
  dependencies: {
    agentRuns: AgentRunManager;
    registry: ProjectRegistry;
    runtimeManager: ProjectRuntimeManager;
    auth: AuthStore;
    publicOrigin?: string;
  }
) {
  const { agentRuns, registry, runtimeManager, auth } = dependencies;

  app.get("/api/projects", async (req, res, next) => {
    try {
      const projects = await registry.listProjects();
      if (!req.identity) { res.status(401).json({ error: "Authentication required" }); return; }
      if (req.identity.kind === "member") {
        const visible = [];
        for (const project of projects) if (await auth.getMember(project.id, req.identity.memberId)) visible.push(project);
        res.json({ projects: visible });
        return;
      }
      const projectIds = new Set(projects.map((project) => project.id));
      await Promise.all(
        runtimeManager
          .listActive()
          .filter((runtime) => !projectIds.has(runtime.project.id))
          .map((runtime) => runtimeManager.disposeProject(runtime.project.id))
      );
      res.json({ projects });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/projects", async (req, res, next) => {
    try {
      if (!requirePermission(req, res, "project:write")) return;
      const project = await registry.createBlankProject(
        String(req.body?.name ?? "")
      );
      res.status(201).json({ project });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/projects/import", async (req, res, next) => {
    try {
      if (!requirePermission(req, res, "project:write")) return;
      const project = await registry.importDirectory(
        String(req.body?.name ?? ""),
        String(req.body?.path ?? "")
      );
      res.status(201).json({ project });
    } catch (error) {
      next(error);
    }
  });

  app.post(
    "/api/projects/import-zip",
    express.raw({ type: "application/zip", limit: "200mb" }),
    async (req, res, next) => {
      try {
        if (!requirePermission(req, res, "project:write")) return;
        if (!Buffer.isBuffer(req.body)) {
          res.status(400).json({ error: "A ZIP archive is required" });
          return;
        }
        const result = await registry.importZip(
          String(req.query.name ?? ""),
          req.body
        );
        res.status(201).json(result);
      } catch (error) {
        next(error);
      }
    }
  );

  app.get("/api/projects/:projectId", async (req, res, next) => {
    try {
      if (!requirePermission(req, res, "project:read", { projectId: req.params.projectId })) return;
      const project = await registry.markOpened(req.params.projectId);
      const runtime = runtimeManager.get(project.id);
      res.json({ project, roomId: runtime.room.id });
    } catch (error) {
      next(error);
    }
  });

  app.delete("/api/projects/:projectId", async (req, res, next) => {
    try {
      if (!requirePermission(req, res, "project:write", { projectId: req.params.projectId })) return;
      const projectId = req.params.projectId;
      const project = registry.getProject(projectId);
      if (!project) throw new Error("Project not found");
      if (project.source === "demo") {
        throw new Error("Demo project cannot be deleted");
      }
      await agentRuns.disposeProject(projectId);
      await runtimeManager.disposeProject(projectId);
      await registry.deleteProject(projectId);
      res.json({ deletedProjectId: projectId });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/projects/:projectId/join", async (req, res, next) => {
    try {
      const result = await auth.join(req.params.projectId, String(req.body?.inviteToken ?? ""), String(req.body?.name ?? ""));
      const secure = new URL(dependencies.publicOrigin ?? process.env.SIMPLERCP_PUBLIC_URL ?? "http://127.0.0.1").protocol === "https:";
      const member = { memberId: result.member.memberId, projectId: result.member.projectId, displayName: result.member.displayName, role: result.member.role, createdAt: result.member.createdAt };
      setSessionCookie(res, auth.memberCookieName(req.params.projectId), result.sessionToken, secure);
      res.status(201).json({ member });
    } catch (error) { next(error); }
  });

  app.get("/api/projects/:projectId/public", (req, res, next) => {
    try {
      const project = registry.getProject(req.params.projectId);
      if (!project) { res.status(404).json({ error: "Project not found" }); return; }
      res.json({ project: { id: project.id, name: project.name, source: project.source } });
    } catch (error) { next(error); }
  });

  app.get("/api/projects/:projectId/invites", async (req, res, next) => {
    try { if (!requirePermission(req, res, "invite:manage", { projectId: req.params.projectId })) return; res.json({ invites: await auth.listInvites(req.params.projectId) }); } catch (error) { next(error); }
  });
  app.post("/api/projects/:projectId/invites", async (req, res, next) => {
      try { if (!requirePermission(req, res, "invite:manage", { projectId: req.params.projectId })) return; const created = await auth.createInvite(req.params.projectId, { role: req.body?.role, expiresAt: req.body?.expiresAt, maxUses: req.body?.maxUses }); const origin = dependencies.publicOrigin ?? process.env.SIMPLERCP_PUBLIC_URL ?? "http://127.0.0.1:5173"; res.status(201).json({ invite: created.invite, url: `${origin}/join/${req.params.projectId}#invite=${created.token}` }); } catch (error) { next(error); }
  });
  app.delete("/api/projects/:projectId/invites/:inviteId", async (req, res, next) => {
    try { if (!requirePermission(req, res, "invite:manage", { projectId: req.params.projectId })) return; res.json({ invite: await auth.revokeInvite(req.params.projectId, req.params.inviteId) }); } catch (error) { next(error); }
  });
  app.get("/api/projects/:projectId/members", async (req, res, next) => {
    try { if (!requirePermission(req, res, "project:read", { projectId: req.params.projectId })) return; res.json({ members: await auth.listMembers(req.params.projectId) }); } catch (error) { next(error); }
  });
  app.put("/api/projects/:projectId/members/:memberId", async (req, res, next) => {
    try { if (!requirePermission(req, res, "member:role", { projectId: req.params.projectId })) return; res.json({ member: await auth.updateRole(req.params.projectId, req.params.memberId, String(req.body?.role ?? "member")) }); } catch (error) { next(error); }
  });
}
