import type { Express } from "express";
import type { ProjectRuntimeManager } from "../projectRuntimeManager.js";

export function registerCollaborationRoutes(
  app: Express,
  runtimeManager: ProjectRuntimeManager
) {
  app.get("/api/projects/:projectId/room", (req, res, next) => {
    try {
      const runtime = runtimeManager.get(req.params.projectId);
      res.json({ room: runtime.room });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/projects/:projectId/participants", async (req, res, next) => {
    try {
      const runtime = runtimeManager.get(req.params.projectId);
      res.json({ participants: await runtime.participants.list() });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/projects/:projectId/members", async (req, res, next) => {
    try {
      const runtime = runtimeManager.get(req.params.projectId);
      const { name, role, participantId, connectionId } = req.body as {
        name?: string;
        role?: string;
        participantId?: string;
        connectionId?: string;
      };
      if (!name) {
        res.status(400).json({ error: "name is required" });
        return;
      }
      const participant = await runtime.participants.resolve({
        participantId,
        displayName: name,
        profileRole: role
      });
      const member = runtime.rooms.joinRoom(runtime.room.id, {
        name: participant.displayName,
        participantId: participant.id,
        connectionId,
        profileRole: participant.profileRole
      });
      res.json({ member, participant });
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

  app.get("/api/projects/:projectId/events", async (req, res, next) => {
    try {
      const events = runtimeManager.get(req.params.projectId).events;
      await events.awaitIdle();
      res.json({ events: events.list() });
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
}
