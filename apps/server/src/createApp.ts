import cors from "cors";
import express from "express";
import { runAgentTask } from "./agents/runtime.js";
import type { ServerConfig } from "./config.js";
import { createEventLog } from "./eventLog.js";
import { createRoomStore } from "./rooms.js";
import { runWorkspaceCommand } from "./runner.js";
import { createTaskStore } from "./tasks.js";
import {
  createWorkspaceDirectory,
  createWorkspaceFile,
  deleteWorkspacePath,
  listWorkspaceTree,
  readWorkspaceFile,
  renameWorkspacePath,
  writeWorkspaceFile
} from "./workspace.js";

export function createApp(config: ServerConfig) {
  const app = express();
  const events = createEventLog();
  const rooms = createRoomStore(events);
  const tasks = createTaskStore(events);
  const defaultRoom = rooms.createRoom(config.workspaceRoot);

  app.locals.events = events;
  app.locals.rooms = rooms;
  app.locals.tasks = tasks;
  app.locals.defaultRoom = defaultRoom;

  app.use(cors());
  app.use(express.json({ limit: "5mb" }));

  app.get("/api/health", (_req, res) => {
    res.json({
      ok: true,
      workspaceRoot: config.workspaceRoot,
      roomId: defaultRoom.id
    });
  });

  app.get("/api/rooms/:roomId", (req, res, next) => {
    try {
      const room = rooms.getRoom(req.params.roomId);
      if (!room) {
        res.status(404).json({ error: "Room not found" });
        return;
      }
      res.json({ room });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/rooms/:roomId/members", (req, res, next) => {
    try {
      const { name, kind, clientId, provider } = req.body as {
        name?: string;
        kind?: "human" | "agent";
        clientId?: string;
        provider?: string;
      };
      if (!name) {
        res.status(400).json({ error: "name is required" });
        return;
      }
      const stableClientId =
        clientId ?? `${kind ?? "human"}:${provider ?? name.toLowerCase()}`;
      res.json({
        member: rooms.joinRoom(req.params.roomId, {
          name,
          kind: kind ?? "human",
          clientId: stableClientId,
          provider
        })
      });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/events", (_req, res) => {
    res.json({ events: events.list() });
  });

  app.get("/api/config/commands", (_req, res) => {
    res.json({ commands: config.commandWhitelist });
  });

  app.post("/api/tasks", (req, res, next) => {
    try {
      const task = tasks.createTask(req.body);
      res.json({ task });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/tasks", (req, res) => {
    const roomId =
      typeof req.query.roomId === "string" ? req.query.roomId : undefined;
    res.json({ tasks: tasks.listTasks(roomId) });
  });

  app.post("/api/tasks/:taskId/agent/mock/run", async (req, res, next) => {
    try {
      const { agentId } = req.body as { agentId?: string };
      if (!agentId) {
        res.status(400).json({ error: "agentId is required" });
        return;
      }
      const report = await runAgentTask("mock", {
        workspaceRoot: config.workspaceRoot,
        events,
        tasks,
        taskId: req.params.taskId,
        agentId
      });
      res.json({ report });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/tasks/:taskId/agent/run", async (req, res, next) => {
    try {
      const { agentId } = req.body as { agentId?: string };
      if (!agentId) {
        res.status(400).json({ error: "agentId is required" });
        return;
      }
      const report = await runAgentTask(
        config.agent.provider,
        {
          workspaceRoot: config.workspaceRoot,
          events,
          tasks,
          taskId: req.params.taskId,
          agentId
        },
        config.agent
      );
      res.json({ report });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/tasks/:taskId/run", async (req, res, next) => {
    try {
      const task = tasks.getTask(req.params.taskId);
      const { command, initiatorId } = req.body as {
        command?: string;
        initiatorId?: string;
      };
      if (!task || !command || !initiatorId) {
        res
          .status(400)
          .json({ error: "task, command, and initiatorId are required" });
        return;
      }
      const run = await runWorkspaceCommand({
        workspaceRoot: config.workspaceRoot,
        command,
        whitelist: task.commandWhitelist,
        events,
        roomId: task.roomId,
        taskId: task.id,
        initiatorId,
        timeoutMs: 30_000
      });
      res.json({ run });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/runner/run", async (req, res, next) => {
    try {
      const { command, initiatorId } = req.body as {
        command?: string;
        initiatorId?: string;
      };
      if (!command || !initiatorId) {
        res.status(400).json({ error: "command and initiatorId are required" });
        return;
      }
      const run = await runWorkspaceCommand({
        workspaceRoot: config.workspaceRoot,
        command,
        whitelist: config.commandWhitelist,
        events,
        roomId: defaultRoom.id,
        initiatorId,
        timeoutMs: 30_000
      });
      res.json({ run });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/workspace/tree", async (_req, res, next) => {
    try {
      res.json({ tree: await listWorkspaceTree(config.workspaceRoot) });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/workspace/file", async (req, res, next) => {
    try {
      const filePath = String(req.query.path ?? "");
      res.json({
        path: filePath,
        content: await readWorkspaceFile(config.workspaceRoot, filePath)
      });
    } catch (error) {
      next(error);
    }
  });

  app.put("/api/workspace/file", async (req, res, next) => {
    try {
      const { path, content } = req.body as {
        path?: string;
        content?: string;
      };
      if (!path || typeof content !== "string") {
        res.status(400).json({ error: "path and content are required" });
        return;
      }

      await writeWorkspaceFile(config.workspaceRoot, path, content);
      res.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/workspace/file", async (req, res, next) => {
    try {
      const { path, content } = req.body as {
        path?: string;
        content?: string;
      };
      if (!path) {
        res.status(400).json({ error: "path is required" });
        return;
      }

      await createWorkspaceFile(config.workspaceRoot, path, content ?? "");
      events.append({
        type: "workspace_file_created",
        roomId: defaultRoom.id,
        payload: { path }
      });
      res.json({ ok: true, tree: await listWorkspaceTree(config.workspaceRoot) });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/workspace/directory", async (req, res, next) => {
    try {
      const { path } = req.body as { path?: string };
      if (!path) {
        res.status(400).json({ error: "path is required" });
        return;
      }

      await createWorkspaceDirectory(config.workspaceRoot, path);
      events.append({
        type: "workspace_directory_created",
        roomId: defaultRoom.id,
        payload: { path }
      });
      res.json({ ok: true, tree: await listWorkspaceTree(config.workspaceRoot) });
    } catch (error) {
      next(error);
    }
  });

  app.patch("/api/workspace/path", async (req, res, next) => {
    try {
      const { fromPath, toPath } = req.body as {
        fromPath?: string;
        toPath?: string;
      };
      if (!fromPath || !toPath) {
        res.status(400).json({ error: "fromPath and toPath are required" });
        return;
      }

      await renameWorkspacePath(config.workspaceRoot, fromPath, toPath);
      events.append({
        type: "workspace_path_renamed",
        roomId: defaultRoom.id,
        payload: { fromPath, toPath }
      });
      res.json({ ok: true, tree: await listWorkspaceTree(config.workspaceRoot) });
    } catch (error) {
      next(error);
    }
  });

  app.delete("/api/workspace/path", async (req, res, next) => {
    try {
      const workspacePath = String(req.query.path ?? "");
      if (!workspacePath) {
        res.status(400).json({ error: "path is required" });
        return;
      }

      await deleteWorkspacePath(config.workspaceRoot, workspacePath);
      events.append({
        type: "workspace_path_deleted",
        roomId: defaultRoom.id,
        payload: { path: workspacePath }
      });
      res.json({ ok: true, tree: await listWorkspaceTree(config.workspaceRoot) });
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
      res.status(400).json({ error: error.message });
    }
  );

  return app;
}
