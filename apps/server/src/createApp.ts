import cors from "cors";
import express from "express";
import type { ServerConfig } from "./config.js";
import { createEventLog } from "./eventLog.js";
import { createRoomStore } from "./rooms.js";
import { runWorkspaceCommand } from "./runner.js";
import { createTaskStore } from "./tasks.js";
import {
  listWorkspaceTree,
  readWorkspaceFile,
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
      const { name, kind } = req.body as {
        name?: string;
        kind?: "human" | "agent";
      };
      if (!name) {
        res.status(400).json({ error: "name is required" });
        return;
      }
      res.json({
        member: rooms.joinRoom(req.params.roomId, name, kind ?? "human")
      });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/events", (_req, res) => {
    res.json({ events: events.list() });
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
