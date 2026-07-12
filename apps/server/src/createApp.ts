import cors from "cors";
import express from "express";
import { createChatStore } from "./chat.js";
import { createCollaborativeDocumentStore } from "./collaborativeDocuments.js";
import type { ServerConfig } from "./config.js";
import { createEventLog } from "./eventLog.js";
import { createRoomStore } from "./rooms.js";
import { runWorkspaceCommand } from "./runner.js";
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
  const chat = createChatStore(events);
  const documents = createCollaborativeDocumentStore({
    workspaceRoot: config.workspaceRoot
  });
  const defaultRoom = rooms.createRoom(config.workspaceRoot);

  app.locals.events = events;
  app.locals.rooms = rooms;
  app.locals.chat = chat;
  app.locals.documents = documents;
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

  app.get("/api/rooms/:roomId", (req, res) => {
    const room = rooms.getRoom(req.params.roomId);
    if (!room) {
      res.status(404).json({ error: "Room not found" });
      return;
    }
    res.json({ room });
  });

  app.post("/api/rooms/:roomId/members", (req, res, next) => {
    try {
      const { name, userId, connectionId } = req.body as {
        name?: string;
        userId?: string;
        connectionId?: string;
      };
      if (!name) {
        res.status(400).json({ error: "name is required" });
        return;
      }
      res.json({
        member: rooms.joinRoom(req.params.roomId, {
          name,
          userId,
          connectionId
        })
      });
    } catch (error) {
      next(error);
    }
  });

  app.post(
    "/api/rooms/:roomId/connections/:connectionId/offline",
    (req, res, next) => {
      try {
        rooms.markConnectionOffline(req.params.roomId, req.params.connectionId);
        rooms.cleanupStaleMembers(req.params.roomId);
        res.json({ ok: true });
      } catch (error) {
        next(error);
      }
    }
  );

  app.get("/api/events", (_req, res) => {
    res.json({ events: events.list() });
  });

  app.get("/api/rooms/:roomId/chat", (req, res) => {
    res.json({ messages: chat.listMessages(req.params.roomId) });
  });

  app.post("/api/rooms/:roomId/chat", (req, res, next) => {
    try {
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
      const message = chat.createMessage({
        roomId: req.params.roomId,
        authorId,
        authorName,
        text
      });
      res.json({ message });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/config/commands", (_req, res) => {
    res.json({ commands: config.commandWhitelist });
  });

  app.get("/api/config/runtime", (_req, res) => {
    res.json({
      commandMode: config.commandMode,
      commands: config.commandWhitelist
    });
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
        commandMode: config.commandMode,
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
      const force = req.query.force === "true";
      res.json(await readWorkspaceFile(config.workspaceRoot, filePath, force));
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
      const { path, content, initiatorId } = req.body as {
        path?: string;
        content?: string;
        initiatorId?: string;
      };
      if (!path) {
        res.status(400).json({ error: "path is required" });
        return;
      }
      await createWorkspaceFile(config.workspaceRoot, path, content ?? "");
      events.append({
        type: "workspace_file_created",
        roomId: defaultRoom.id,
        memberId: initiatorId,
        payload: { path }
      });
      res.json({ tree: await listWorkspaceTree(config.workspaceRoot) });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/workspace/directory", async (req, res, next) => {
    try {
      const { path, initiatorId } = req.body as {
        path?: string;
        initiatorId?: string;
      };
      if (!path) {
        res.status(400).json({ error: "path is required" });
        return;
      }
      await createWorkspaceDirectory(config.workspaceRoot, path);
      events.append({
        type: "workspace_directory_created",
        roomId: defaultRoom.id,
        memberId: initiatorId,
        payload: { path }
      });
      res.json({ tree: await listWorkspaceTree(config.workspaceRoot) });
    } catch (error) {
      next(error);
    }
  });

  app.patch("/api/workspace/path", async (req, res, next) => {
    try {
      const { fromPath, toPath, initiatorId } = req.body as {
        fromPath?: string;
        toPath?: string;
        initiatorId?: string;
      };
      if (!fromPath || !toPath) {
        res.status(400).json({ error: "fromPath and toPath are required" });
        return;
      }
      await documents.retirePath(fromPath);
      await renameWorkspacePath(config.workspaceRoot, fromPath, toPath);
      events.append({
        type: "workspace_path_renamed",
        roomId: defaultRoom.id,
        memberId: initiatorId,
        payload: { fromPath, toPath }
      });
      res.json({ tree: await listWorkspaceTree(config.workspaceRoot) });
    } catch (error) {
      next(error);
    }
  });

  app.delete("/api/workspace/path", async (req, res, next) => {
    try {
      const workspacePath = String(req.query.path ?? "");
      const initiatorId = String(req.query.initiatorId ?? "") || undefined;
      if (!workspacePath) {
        res.status(400).json({ error: "path is required" });
        return;
      }
      await documents.retirePath(workspacePath);
      await deleteWorkspacePath(config.workspaceRoot, workspacePath);
      events.append({
        type: "workspace_path_deleted",
        roomId: defaultRoom.id,
        memberId: initiatorId,
        payload: { path: workspacePath }
      });
      res.json({ tree: await listWorkspaceTree(config.workspaceRoot) });
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
