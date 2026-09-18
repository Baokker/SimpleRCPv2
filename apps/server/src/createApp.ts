import cors from "cors";
import express from "express";
import type { ServerConfig } from "./config.js";
import { createProjectRuntimeManager } from "./projectRuntimeManager.js";
import { createProjectRegistry } from "./projects.js";
import {
  createWorkspaceDirectory,
  createWorkspaceFile,
  deleteWorkspacePath,
  listWorkspaceDirectory,
  readWorkspaceFile,
  renameWorkspacePath,
  writeWorkspaceFile
} from "./workspace.js";

export async function createApp(config: ServerConfig) {
  const registry = await createProjectRegistry({
    dataDir: config.dataDir,
    demoProjectRoot: config.demoProjectRoot
  });
  const runtimeManager = createProjectRuntimeManager(registry);
  const app = express();

  app.locals.registry = registry;
  app.locals.runtimeManager = runtimeManager;
  app.use(cors());
  app.use(express.json({ limit: "5mb" }));

  app.get("/api/health", (_req, res) => {
    res.json({
      ok: true,
      dataDir: config.dataDir,
      publicOrigin: config.publicOrigin
    });
  });

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
      const project = await registry.createBlankProject(String(req.body?.name ?? ""));
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
      await runtimeManager.disposeProject(projectId);
      await registry.deleteProject(projectId);
      res.json({ deletedProjectId: projectId });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/projects/:projectId/room", (req, res, next) => {
    try {
      const runtime = runtimeManager.get(req.params.projectId);
      res.json({ room: runtime.room });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/projects/:projectId/members", (req, res, next) => {
    try {
      const runtime = runtimeManager.get(req.params.projectId);
      const { name, role, userId, connectionId } = req.body as {
        name?: string;
        role?: string;
        userId?: string;
        connectionId?: string;
      };
      if (!name) {
        res.status(400).json({ error: "name is required" });
        return;
      }
      res.json({
        member: runtime.rooms.joinRoom(runtime.room.id, {
          name,
          userId,
          connectionId,
          profileRole: role?.trim() || undefined
        })
      });
    } catch (error) {
      next(error);
    }
  });

  app.post(
    "/api/projects/:projectId/connections/:connectionId/offline",
    (req, res, next) => {
      try {
        const runtime = runtimeManager.get(req.params.projectId);
        runtime.rooms.markConnectionOffline(
          runtime.room.id,
          req.params.connectionId
        );
        runtime.rooms.cleanupStaleMembers(runtime.room.id);
        res.json({ ok: true });
      } catch (error) {
        next(error);
      }
    }
  );

  app.get("/api/projects/:projectId/events", (req, res, next) => {
    try {
      res.json({
        events: runtimeManager.get(req.params.projectId).events.list()
      });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/projects/:projectId/chat", (req, res, next) => {
    try {
      const runtime = runtimeManager.get(req.params.projectId);
      res.json({ messages: runtime.chat.listMessages(runtime.room.id) });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/projects/:projectId/chat", (req, res, next) => {
    try {
      const runtime = runtimeManager.get(req.params.projectId);
      const { authorId, authorName, text } = req.body as {
        authorId?: string;
        authorName?: string;
        text?: string;
      };
      if (!authorId || !authorName || !text) {
        res.status(400).json({
          error: "authorId, authorName, and text are required"
        });
        return;
      }
      const message = runtime.chat.createMessage({
        roomId: runtime.room.id,
        authorId,
        authorName,
        text
      });
      res.json({ message });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/projects/:projectId/workspace/directory", async (req, res, next) => {
    try {
      const runtime = runtimeManager.get(req.params.projectId);
      const directoryPath = String(req.query.path ?? "");
      res.json({
        tree: await listWorkspaceDirectory(
          runtime.project.workspacePath,
          directoryPath
        )
      });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/projects/:projectId/workspace/file", async (req, res, next) => {
    try {
      const runtime = runtimeManager.get(req.params.projectId);
      const filePath = String(req.query.path ?? "");
      const force = req.query.force === "true";
      res.json(
        await readWorkspaceFile(runtime.project.workspacePath, filePath, force)
      );
    } catch (error) {
      next(error);
    }
  });

  app.put("/api/projects/:projectId/workspace/file", async (req, res, next) => {
    try {
      const runtime = runtimeManager.get(req.params.projectId);
      const { path: filePath, content, initiatorId } = req.body as {
        path?: string;
        content?: string;
        initiatorId?: string;
      };
      if (!filePath || typeof content !== "string" || !initiatorId) {
        res.status(400).json({ error: "path, content, and initiatorId are required" });
        return;
      }
      requireMember(runtime, initiatorId);
      await writeWorkspaceFile(runtime.project.workspacePath, filePath, content);
      res.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/projects/:projectId/workspace/file", async (req, res, next) => {
    try {
      const runtime = runtimeManager.get(req.params.projectId);
      const { path: filePath, content, initiatorId } = req.body as {
        path?: string;
        content?: string;
        initiatorId?: string;
      };
      if (!filePath || !initiatorId) {
        res.status(400).json({ error: "path and initiatorId are required" });
        return;
      }
      requireMember(runtime, initiatorId);
      await createWorkspaceFile(
        runtime.project.workspacePath,
        filePath,
        content ?? ""
      );
      runtime.events.append({
        type: "workspace_file_created",
        roomId: runtime.room.id,
        memberId: initiatorId,
        payload: { path: filePath }
      });
      runtime.announceWorkspaceChange({ type: "add", path: filePath });
      res.json({
        tree: await listWorkspaceDirectory(runtime.project.workspacePath, "")
      });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/projects/:projectId/workspace/directory", async (req, res, next) => {
    try {
      const runtime = runtimeManager.get(req.params.projectId);
      const { path: directoryPath, initiatorId } = req.body as {
        path?: string;
        initiatorId?: string;
      };
      if (!directoryPath || !initiatorId) {
        res.status(400).json({ error: "path and initiatorId are required" });
        return;
      }
      requireMember(runtime, initiatorId);
      await createWorkspaceDirectory(runtime.project.workspacePath, directoryPath);
      runtime.events.append({
        type: "workspace_directory_created",
        roomId: runtime.room.id,
        memberId: initiatorId,
        payload: { path: directoryPath }
      });
      runtime.announceWorkspaceChange({
        type: "addDir",
        path: directoryPath
      });
      res.json({
        tree: await listWorkspaceDirectory(runtime.project.workspacePath, "")
      });
    } catch (error) {
      next(error);
    }
  });

  app.patch("/api/projects/:projectId/workspace/path", async (req, res, next) => {
    try {
      const runtime = runtimeManager.get(req.params.projectId);
      const { fromPath, toPath, initiatorId } = req.body as {
        fromPath?: string;
        toPath?: string;
        initiatorId?: string;
      };
      if (!fromPath || !toPath || !initiatorId) {
        res.status(400).json({
          error: "fromPath, toPath, and initiatorId are required"
        });
        return;
      }
      requireMember(runtime, initiatorId);
      await runtime.documents.retirePath(fromPath);
      await renameWorkspacePath(runtime.project.workspacePath, fromPath, toPath);
      runtime.events.append({
        type: "workspace_path_renamed",
        roomId: runtime.room.id,
        memberId: initiatorId,
        payload: { fromPath, toPath }
      });
      runtime.announceWorkspaceChange({
        type: "rename",
        fromPath,
        path: toPath
      });
      res.json({
        tree: await listWorkspaceDirectory(runtime.project.workspacePath, "")
      });
    } catch (error) {
      next(error);
    }
  });

  app.delete("/api/projects/:projectId/workspace/path", async (req, res, next) => {
    try {
      const runtime = runtimeManager.get(req.params.projectId);
      const workspacePath = String(req.query.path ?? "");
      const initiatorId = String(req.query.initiatorId ?? "");
      if (!workspacePath || !initiatorId) {
        res.status(400).json({ error: "path and initiatorId are required" });
        return;
      }
      requireMember(runtime, initiatorId);
      await runtime.documents.retirePath(workspacePath);
      await deleteWorkspacePath(runtime.project.workspacePath, workspacePath);
      runtime.events.append({
        type: "workspace_path_deleted",
        roomId: runtime.room.id,
        memberId: initiatorId,
        payload: { path: workspacePath }
      });
      runtime.announceWorkspaceChange({
        type: "unlink",
        path: workspacePath
      });
      res.json({
        tree: await listWorkspaceDirectory(runtime.project.workspacePath, "")
      });
    } catch (error) {
      next(error);
    }
  });

  app.use(
    (
      error: Error,
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction
    ) => {
      const status = error.message === "Project not found" ? 404 : 400;
      res.status(status).json({ error: error.message });
    }
  );

  return app;
}

function requireMember(
  runtime: ReturnType<ReturnType<typeof createProjectRuntimeManager>["get"]>,
  memberId: string
) {
  if (!runtime.rooms.getMember(runtime.room.id, memberId)) {
    throw new Error("Project membership is required");
  }
}
