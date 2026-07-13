import cors from "cors";
import express from "express";
import { createChatStore } from "./chat.js";
import { createCollaborativeDocumentStore } from "./collaborativeDocuments.js";
import type { ServerConfig } from "./config.js";
import { createEventLog } from "./eventLog.js";
import { createRoomStore } from "./rooms.js";
import { runWorkspaceCommand } from "./runner.js";
import {
  createHostAccessToken,
  createSessionControl
} from "./sessionControl.js";
import type { SessionSettings } from "./types.js";
import {
  createWorkspaceDirectory,
  createWorkspaceFile,
  deleteWorkspacePath,
  listWorkspaceTree,
  listWorkspaceDirectory,
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
  const hostAccessToken = config.hostAccessToken ?? createHostAccessToken();
  const sessionControl = createSessionControl({
    hostAccessToken,
    initialSettings: {
      terminalEnabled: true,
      commandMode: config.commandMode,
      commands: config.commandWhitelist,
      commandTimeoutMs: 30_000,
      guestCanEditFiles: true,
      guestCanManageFiles: true,
      guestCanRunCommands: true
    }
  });
  const defaultRoom = rooms.createRoom(config.workspaceRoot);

  app.locals.events = events;
  app.locals.rooms = rooms;
  app.locals.chat = chat;
  app.locals.documents = documents;
  app.locals.sessionControl = sessionControl;
  app.locals.hostAccessToken = hostAccessToken;
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

  app.post("/api/session/host", (req, res) => {
    const accessToken = String(req.body?.accessToken ?? "");
    if (!accessToken) {
      res.status(400).json({ error: "accessToken is required" });
      return;
    }
    try {
      res.json({ sessionToken: sessionControl.claimHost(accessToken) });
    } catch (error) {
      res.status(403).json({
        error: error instanceof Error ? error.message : "Host claim failed"
      });
    }
  });

  app.get("/api/session/settings", (_req, res) => {
    res.json({
      settings: sessionControl.getSettings(),
      workspaceRoot: config.workspaceRoot,
      roomId: defaultRoom.id
    });
  });

  app.put("/api/session/settings", (req, res) => {
    const hostSession = getHostSession(req);
    if (!sessionControl.isHostSession(hostSession)) {
      res.status(403).json({ error: "Host authorization required" });
      return;
    }
    try {
      const { initiatorId, ...patch } = req.body as Partial<SessionSettings> & {
        initiatorId?: string;
      };
      const settings = sessionControl.updateSettings(hostSession, patch);
      events.append({
        type: "session_settings_updated",
        roomId: defaultRoom.id,
        memberId: initiatorId,
        payload: { settings }
      });
      res.json({ settings });
    } catch (error) {
      res.status(400).json({
        error: error instanceof Error ? error.message : "Invalid settings"
      });
    }
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
          connectionId,
          role: sessionControl.isHostSession(getHostSession(req))
            ? "host"
            : "guest"
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
    res.json({ commands: sessionControl.getSettings().commands });
  });

  app.get("/api/config/runtime", (_req, res) => {
    res.json(sessionControl.getSettings());
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
      const settings = sessionControl.getSettings();
      if (!settings.terminalEnabled) {
        res.status(403).json({ error: "Terminal is disabled" });
        return;
      }
      if (!memberCan(rooms, defaultRoom.id, initiatorId, settings.guestCanRunCommands)) {
        res.status(403).json({ error: "Command execution is not permitted" });
        return;
      }
      const run = await runWorkspaceCommand({
        workspaceRoot: config.workspaceRoot,
        command,
        whitelist: settings.commands,
        commandMode: settings.commandMode,
        events,
        roomId: defaultRoom.id,
        initiatorId,
        timeoutMs: settings.commandTimeoutMs
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

  app.get("/api/workspace/directory", async (req, res, next) => {
    try {
      const directoryPath = String(req.query.path ?? "");
      res.json({
        tree: await listWorkspaceDirectory(
          config.workspaceRoot,
          directoryPath
        )
      });
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
      const { path, content, initiatorId } = req.body as {
        path?: string;
        content?: string;
        initiatorId?: string;
      };
      if (!path || typeof content !== "string" || !initiatorId) {
        res.status(400).json({ error: "path, content, and initiatorId are required" });
        return;
      }
      if (!memberCan(rooms, defaultRoom.id, initiatorId, sessionControl.getSettings().guestCanEditFiles)) {
        res.status(403).json({ error: "File editing is not permitted" });
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
      if (!initiatorId || !memberCan(rooms, defaultRoom.id, initiatorId, sessionControl.getSettings().guestCanManageFiles)) {
        res.status(403).json({ error: "File management is not permitted" });
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
      if (!initiatorId || !memberCan(rooms, defaultRoom.id, initiatorId, sessionControl.getSettings().guestCanManageFiles)) {
        res.status(403).json({ error: "File management is not permitted" });
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
      if (!initiatorId || !memberCan(rooms, defaultRoom.id, initiatorId, sessionControl.getSettings().guestCanManageFiles)) {
        res.status(403).json({ error: "File management is not permitted" });
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
      if (!initiatorId || !memberCan(rooms, defaultRoom.id, initiatorId, sessionControl.getSettings().guestCanManageFiles)) {
        res.status(403).json({ error: "File management is not permitted" });
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

function getHostSession(req: express.Request) {
  return req.header("x-simplercp-host-session");
}

function memberCan(
  rooms: ReturnType<typeof createRoomStore>,
  roomId: string,
  memberId: string,
  guestAllowed: boolean
) {
  const member = rooms.getMember(roomId, memberId);
  return Boolean(member && (member.role === "host" || guestAllowed));
}
