import type { Express } from "express";
import type { ProjectRuntimeManager } from "../projectRuntimeManager.js";
import type { AuthStore } from "../auth/identity.js";

export function registerCollaborationRoutes(
  app: Express,
  runtimeManager: ProjectRuntimeManager,
  auth: AuthStore
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
      res.json({ participants: (await auth.listMembers(req.params.projectId)).map((member) => ({ id: member.memberId, projectId: member.projectId, displayName: member.displayName, profileRole: member.role, createdAt: member.createdAt, updatedAt: member.createdAt })) });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/projects/:projectId/members", async (req, res, next) => {
    try {
      const runtime = runtimeManager.get(req.params.projectId);
      const identity = req.identity;
      if (identity?.kind !== "member") {
        res.status(403).json({ error: "Member session required" });
        return;
      }
      const stored = await auth.getMember(req.params.projectId, identity.memberId);
      if (!stored) throw new Error("Member not found");
      const participant = { id: stored.memberId, projectId: stored.projectId, displayName: stored.displayName, profileRole: stored.role, createdAt: stored.createdAt, updatedAt: stored.createdAt };
      const member = runtime.rooms.joinRoom(runtime.room.id, {
        memberId: stored.memberId,
        name: participant.displayName,
        participantId: participant.id,
        connectionId: req.body?.connectionId,
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
        const connection = runtime.room.connections.find((candidate) => candidate.id === req.params.connectionId);
        if (req.identity?.kind !== "member" || connection?.participantId !== req.identity.memberId) {
          res.status(403).json({ error: "Connection belongs to another member" });
          return;
        }
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
      const identity = req.identity;
      if (identity?.kind !== "member") { res.status(403).json({ error: "Member session required" }); return; }
      const member = await auth.getMember(req.params.projectId, identity.memberId);
      if (!member) throw new Error("Member not found");
      const text = String(req.body?.text ?? "");
      if (!text) {
        res.status(400).json({
          error: "text is required"
        });
        return;
      }
      const message = await runtime.chat.createMessage({
        roomId: runtime.room.id,
        authorId: identity.memberId,
        authorName: member.displayName,
        text
      });
      res.json({ message });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/projects/:projectId/me", async (req, res, next) => {
    try {
      if (req.identity?.kind !== "member") { res.status(403).json({ error: "Member session required" }); return; }
      const member = await auth.getMember(req.params.projectId, req.identity.memberId);
      if (!member) throw new Error("Member not found");
      const { tokenHash: _tokenHash, ...profile } = member;
      res.json({ member: profile });
    } catch (error) { next(error); }
  });
  app.patch("/api/projects/:projectId/me", async (req, res, next) => {
    try {
      if (req.identity?.kind !== "member") { res.status(403).json({ error: "Member session required" }); return; }
      const name = String(req.body?.name ?? "").trim();
      if (!name) throw new Error("name is required");
      const member = await auth.updateDisplayName(req.params.projectId, req.identity.memberId, name);
      const { tokenHash: _tokenHash, ...profile } = member;
      res.json({ member: profile });
    } catch (error) { next(error); }
  });
}
