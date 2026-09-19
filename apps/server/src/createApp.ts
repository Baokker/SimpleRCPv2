import cors from "cors";
import express from "express";
import path from "node:path";
import { createAgentSettingsStore } from "./agent/agentSettingsStore.js";
import { createOpenCodeRuntime } from "./agent/openCodeRuntime.js";
import { createAgentRunManager } from "./agent/agentRunManager.js";
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
  const agentSettings = await createAgentSettingsStore({
    storagePath: path.join(config.dataDir, "agent", "settings.json"),
    defaultModel: config.agent?.model ?? "deepseek-chat",
    apiKeyConfigured: Boolean(config.agent?.apiKey)
  });
  const agentRuntime = createOpenCodeRuntime({
    port: config.agent?.openCodePort ?? 4096,
    apiKey: config.agent?.apiKey,
    baseUrl: config.agent?.baseUrl ?? "https://api.deepseek.com/v1",
    getSettings: () => agentSettings.get()
  });
  const agentRuns = createAgentRunManager({
    runtime: agentRuntime,
    registry,
    runtimeManager,
    getSettings: () => agentSettings.get(),
    apiKey: config.agent?.apiKey,
    runTimeoutMs: config.agent?.runTimeoutMs ?? 600_000,
    appendActivity(projectId, input) {
      return runtimeManager.get(projectId).events.append(input);
    }
  });
  await agentRuns.initialize();
  const app = express();

  app.locals.registry = registry;
  app.locals.runtimeManager = runtimeManager;
  app.locals.agentSettings = agentSettings;
  app.locals.agentRuntime = agentRuntime;
  app.locals.agentRuns = agentRuns;
  app.use(cors());
  app.use(express.json({ limit: "5mb" }));

  app.get("/api/health", (_req, res) => {
    res.json({
      ok: true,
      dataDir: config.dataDir,
      publicOrigin: config.publicOrigin
    });
  });

  app.get("/api/agent/settings", (_req, res) => {
    res.json(agentSettings.get());
  });

  app.put("/api/agent/settings", async (req, res, next) => {
    try {
      const current = agentSettings.get();
      const nextSettings = req.body as {
        model?: unknown;
        enabled?: unknown;
      };
      if (
        agentRuns.hasActiveTasks() &&
        (nextSettings.model !== current.model ||
          nextSettings.enabled !== current.enabled)
      ) {
        throw new Error("Agent settings cannot change while tasks are active");
      }
      res.json(await agentSettings.update(req.body));
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/agent/status", async (_req, res, next) => {
    try {
      res.json(await agentRuntime.status());
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/projects/:projectId/agent/sessions", async (req, res, next) => {
    try {
      const memberId = String(req.query.memberId ?? "");
      if (!memberId) {
        res.status(400).json({ error: "memberId is required" });
        return;
      }
      res.json({
        sessions: await agentRuns.listSessions(req.params.projectId, memberId)
      });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/projects/:projectId/agent/sessions", async (req, res, next) => {
    try {
      const memberId = String(req.body?.memberId ?? "");
      if (!memberId) {
        res.status(400).json({ error: "memberId is required" });
        return;
      }
      const session = await agentRuns.createSession({
        projectId: req.params.projectId,
        memberId,
        title: typeof req.body?.title === "string" ? req.body.title : undefined
      });
      res.status(201).json({ session });
    } catch (error) {
      next(error);
    }
  });

  app.get(
    "/api/projects/:projectId/agent/sessions/:sessionId",
    async (req, res, next) => {
      try {
        const memberId = String(req.query.memberId ?? "");
        if (!memberId) {
          res.status(400).json({ error: "memberId is required" });
          return;
        }
        const session = await agentRuns.getSession(
          req.params.projectId,
          req.params.sessionId
        );
        if (memberId && session.memberId !== memberId) {
          res.status(403).json({ error: "Agent session belongs to another member" });
          return;
        }
        res.json({ session });
      } catch (error) {
        next(error);
      }
    }
  );

  app.post(
    "/api/projects/:projectId/agent/sessions/:sessionId/runs",
    async (req, res, next) => {
      try {
        const memberId = String(req.body?.memberId ?? "");
        const prompt = String(req.body?.prompt ?? "");
        const contexts = Array.isArray(req.body?.contexts) ? req.body.contexts : undefined;
        if (!memberId || !prompt) {
          res.status(400).json({ error: "memberId and prompt are required" });
          return;
        }
        const run = await agentRuns.createRun({
          projectId: req.params.projectId,
          memberId,
          prompt,
          sessionId: req.params.sessionId,
          contexts
        });
        res.status(202).json({ run });
      } catch (error) {
        next(error);
      }
    }
  );

  app.get("/api/projects/:projectId/agent/runs", async (req, res, next) => {
    try {
      res.json({ runs: await agentRuns.listRuns(req.params.projectId) });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/projects/:projectId/agent/runs", async (req, res, next) => {
    try {
      const { memberId, prompt, sessionId, contexts } = req.body as {
        memberId?: string;
        prompt?: string;
        sessionId?: string;
        contexts?: import("@simplercp/shared").AgentPromptContext[];
      };
      if (!memberId || !prompt) {
        res.status(400).json({ error: "memberId and prompt are required" });
        return;
      }
      const run = await agentRuns.createRun({
        projectId: req.params.projectId,
        memberId,
        prompt,
        sessionId,
        contexts
      });
      res.status(202).json({ run });
    } catch (error) {
      next(error);
    }
  });

  app.get(
    "/api/projects/:projectId/agent/runs/:runId",
    async (req, res, next) => {
      try {
        res.json({
          run: await agentRuns.getRun(req.params.projectId, req.params.runId)
        });
      } catch (error) {
        next(error);
      }
    }
  );

  app.get(
    "/api/projects/:projectId/agent/runs/:runId/trace",
    async (req, res, next) => {
      try {
        const events = await agentRuns.listTrace(
          req.params.projectId,
          req.params.runId
        );
        if (req.query.download === "true") {
          res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
          res.setHeader(
            "Content-Disposition",
            `attachment; filename="trace-${req.params.runId}.jsonl"`
          );
          res.send(`${events.map((event) => JSON.stringify(event)).join("\n")}\n`);
          return;
        }
        res.json({ events });
      } catch (error) {
        next(error);
      }
    }
  );

  app.post(
    "/api/projects/:projectId/agent/runs/:runId/cancel",
    async (req, res, next) => {
      try {
        const memberId = String(req.body?.memberId ?? "");
        if (!memberId) {
          res.status(400).json({ error: "memberId is required" });
          return;
        }
        res.json({
          run: await agentRuns.cancelRun(
            req.params.projectId,
            req.params.runId,
            memberId
          )
        });
      } catch (error) {
        next(error);
      }
    }
  );

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
      await agentRuns.disposeProject(projectId);
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

  app.get("/api/projects/:projectId/chat", async (req, res, next) => {
    try {
      const runtime = runtimeManager.get(req.params.projectId);
      res.json({ messages: await runtime.chat.listMessages(runtime.room.id) });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/projects/:projectId/chat", async (req, res, next) => {
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
      const message = await runtime.chat.createMessage({
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
      runtime.suppressWorkspaceChange({ type: "add", path: filePath });
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
      runtime.suppressWorkspaceChange({
        type: "addDir",
        path: directoryPath
      });
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
      runtime.suppressWorkspaceChange({
        type: "rename",
        fromPath,
        path: toPath
      });
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
      runtime.suppressWorkspaceChange({ type: "unlink", path: workspacePath });
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
