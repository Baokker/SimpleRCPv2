import type { Express } from "express";
import type { ProjectRuntimeManager } from "../projectRuntimeManager.js";
import { requireIdentity } from "../auth/permissions.js";

export function registerConflictGuardRoutes(app: Express, runtimeManager: ProjectRuntimeManager) {
  app.get("/api/projects/:projectId/conflict-guard/symbol", (req, res, next) => {
    try {
      if (!requireIdentity(req, res)) return;
      const runtime = runtimeManager.get(req.params.projectId);
      if (!runtime.conflictGuard) { res.sendStatus(404); return; }
      if (typeof req.query.key !== "string") { res.status(400).json({ error: "必须提供符号 key" }); return; }
      const symbol = runtime.conflictGuard.symbol(req.query.key);
      if (!symbol) { res.sendStatus(404); return; }
      res.json(symbol);
    } catch (error) { next(error); }
  });
  app.get("/api/projects/:projectId/conflict-guard/state", (req, res, next) => {
    try {
      if (!requireIdentity(req, res)) return;
      const runtime = runtimeManager.get(req.params.projectId);
      if (!runtime.conflictGuard) { res.sendStatus(404); return; }
      res.json({ mode: runtime.conflictGuard.mode, ...runtime.conflictGuard.state() });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/projects/:projectId/conflict-guard/trace", async (req, res, next) => {
    try {
      if (!requireIdentity(req, res)) return;
      const runtime = runtimeManager.get(req.params.projectId);
      if (!runtime.conflictGuard) { res.sendStatus(404); return; }
      await runtime.conflictGuard.waitForTrace();
      res.type("application/x-ndjson");
      res.setHeader("Content-Disposition", 'attachment; filename="conflict-guard-trace.jsonl"');
      res.send(await runtime.conflictGuard.exportTrace());
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") { res.type("application/x-ndjson").send(""); return; }
      next(error);
    }
  });

  app.post("/api/projects/:projectId/conflict-guard/done", (req, res, next) => {
    try {
      if (!requireIdentity(req, res)) return;
      const runtime = runtimeManager.get(req.params.projectId);
      if (!runtime.conflictGuard) { res.sendStatus(404); return; }
      runtime.conflictGuard.markDone(req.identity!.memberId);
      res.status(204).end();
    } catch (error) {
      next(error);
    }
  });
}
