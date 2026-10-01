import type { Express } from "express";
import type { ProjectRuntimeManager } from "../projectRuntimeManager.js";
import type { MemberStore } from "../auth/identity.js";
import { requireIdentity } from "../auth/permissions.js";

export function registerCollaborationRoutes(app: Express, runtimeManager: ProjectRuntimeManager, members: MemberStore) {
  app.get("/api/projects/:projectId/room", (req, res, next) => {
    try {
      if (!requireIdentity(req, res)) return;
      res.json({ room: runtimeManager.get(req.params.projectId).room });
    } catch (error) { next(error); }
  });

  app.get("/api/projects/:projectId/participants", async (req, res, next) => {
    try {
      const participants = (await members.listMembers(req.params.projectId)).map((member) => ({
        id: member.memberId,
        projectId: member.projectId,
        displayName: member.displayName,
        profileRole: member.role || undefined,
        createdAt: member.createdAt,
        updatedAt: member.updatedAt
      }));
      res.json({ participants });
    } catch (error) { next(error); }
  });

  app.post("/api/projects/:projectId/members", async (req, res, next) => {
    try {
      const member = await members.join(req.params.projectId, {
        memberId: typeof req.body?.memberId === "string" ? req.body.memberId : undefined,
        displayName: String(req.body?.name ?? ""),
        role: typeof req.body?.role === "string" ? req.body.role : undefined
      });
      const runtime = runtimeManager.get(req.params.projectId);
      const participant = {
        id: member.memberId,
        projectId: member.projectId,
        displayName: member.displayName,
        profileRole: member.role || undefined,
        createdAt: member.createdAt,
        updatedAt: member.updatedAt
      };
      const roomMember = runtime.rooms.joinRoom(runtime.room.id, {
        memberId: member.memberId,
        participantId: member.memberId,
        name: member.displayName,
        profileRole: member.role || undefined,
        connectionId: req.body?.connectionId
      });
      res.json({ member: roomMember, participant });
    } catch (error) { next(error); }
  });

  app.post("/api/projects/:projectId/connections/:connectionId/offline", (req, res, next) => {
    try {
      const identity = requireIdentity(req, res);
      if (!identity) return;
      const runtime = runtimeManager.get(req.params.projectId);
      const connection = runtime.room.connections.find((candidate) => candidate.id === req.params.connectionId);
      if (!connection || connection.participantId !== identity.memberId) {
        res.status(403).json({ error: "Connection belongs to another member" });
        return;
      }
      runtime.rooms.markConnectionOffline(runtime.room.id, req.params.connectionId);
      runtime.rooms.cleanupStaleMembers(runtime.room.id);
      res.json({ ok: true });
    } catch (error) { next(error); }
  });

  app.get("/api/projects/:projectId/events", async (req, res, next) => {
    try {
      if (!requireIdentity(req, res)) return;
      const events = runtimeManager.get(req.params.projectId).events;
      await events.awaitIdle();
      res.json({ events: events.list() });
    } catch (error) { next(error); }
  });

  app.get("/api/projects/:projectId/chat", async (req, res, next) => {
    try {
      if (!requireIdentity(req, res)) return;
      const runtime = runtimeManager.get(req.params.projectId);
      res.json({ messages: await runtime.chat.listMessages(runtime.room.id) });
    } catch (error) { next(error); }
  });

  app.post("/api/projects/:projectId/chat", async (req, res, next) => {
    try {
      const identity = requireIdentity(req, res);
      if (!identity) return;
      const text = String(req.body?.text ?? "");
      if (!text) { res.status(400).json({ error: "text is required" }); return; }
      const runtime = runtimeManager.get(req.params.projectId);
      const message = await runtime.chat.createMessage({
        roomId: runtime.room.id,
        authorId: identity.memberId,
        authorName: identity.displayName,
        text
      });
      res.json({ message });
    } catch (error) { next(error); }
  });

  app.get("/api/projects/:projectId/me", (req, res, next) => {
    const identity = requireIdentity(req, res);
    if (!identity) return;
    res.json({ member: identity });
  });

  app.patch("/api/projects/:projectId/me", async (req, res, next) => {
    try {
      const identity = requireIdentity(req, res);
      if (!identity) return;
      const member = await members.join(req.params.projectId, {
        memberId: identity.memberId,
        displayName: String(req.body?.name ?? identity.displayName),
        role: String(req.body?.role ?? identity.role)
      });
      res.json({ member });
    } catch (error) { next(error); }
  });
}
