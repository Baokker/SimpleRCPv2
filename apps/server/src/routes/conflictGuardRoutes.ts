import fs from "node:fs/promises";
import type { Express } from "express";
import type { ProjectRuntimeManager } from "../projectRuntimeManager.js";
import { requireIdentity } from "../auth/permissions.js";

export function registerConflictGuardRoutes(app: Express, runtimeManager: ProjectRuntimeManager) {
  app.get("/api/projects/:projectId/conflict-guard/state", (req, res, next) => {
    try {
      const runtime = runtimeManager.get(req.params.projectId);
      if (!runtime.conflictGuard) { res.sendStatus(404); return; }
      if (!requireIdentity(req, res)) return;
      res.json({ mode: runtime.conflictGuard.mode, changeSets: runtime.conflictGuard.state() });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/projects/:projectId/conflict-guard/trace", async (req, res, next) => {
    try {
      const runtime = runtimeManager.get(req.params.projectId);
      if (!runtime.conflictGuard) { res.sendStatus(404); return; }
      if (!requireIdentity(req, res)) return;
      await runtime.conflictGuard.waitForTrace();
      res.type("application/x-ndjson");
      res.setHeader("Content-Disposition", 'attachment; filename="conflict-guard-trace.jsonl"');
      res.send(await fs.readFile(runtime.conflictGuard.tracePath, "utf8"));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") { res.type("application/x-ndjson").send(""); return; }
      next(error);
    }
  });

  app.post("/api/projects/:projectId/conflict-guard/done", (req, res, next) => {
    try {
      const runtime = runtimeManager.get(req.params.projectId);
      if (!runtime.conflictGuard) { res.sendStatus(404); return; }
      if (!requireIdentity(req, res)) return;
      runtime.conflictGuard.markDone(req.identity!.memberId);
      res.status(204).end();
    } catch (error) {
      next(error);
    }
  });
}
