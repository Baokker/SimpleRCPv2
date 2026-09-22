import express, { type Express } from "express";
import type { AgentRunManager } from "../agent/agentRunManager.js";
import type { ProjectRuntimeManager } from "../projectRuntimeManager.js";
import type { ProjectRegistry } from "../projects.js";

export function registerProjectRoutes(
  app: Express,
  dependencies: {
    agentRuns: AgentRunManager;
    registry: ProjectRegistry;
    runtimeManager: ProjectRuntimeManager;
  }
) {
  const { agentRuns, registry, runtimeManager } = dependencies;

  app.get("/api/projects", async (_req, res, next) => {
    try {
      const projects = await registry.listProjects();
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
      const project = await registry.markOpened(req.params.projectId);
      const runtime = runtimeManager.get(project.id);
      res.json({ project, roomId: runtime.room.id });
    } catch (error) {
      next(error);
    }
  });

  app.delete("/api/projects/:projectId", async (req, res, next) => {
    try {
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
}
