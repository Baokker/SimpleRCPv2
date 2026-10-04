import type { Express } from "express";
import type { ProjectRuntimeManager } from "../projectRuntimeManager.js";
import type { MemberStore } from "../auth/identity.js";
import { requireIdentity } from "../auth/permissions.js";
import { SCENARIOS, roleLevel } from "../guard/roles.js";
import type { ChatAgentBridge } from "../agent/chatAgentBridge.js";

export function registerCollaborationRoutes(
  app: Express,
  runtimeManager: ProjectRuntimeManager,
  members: MemberStore,
  chatAgentBridge: ChatAgentBridge
) {
  app.get("/api/guard/roles", (_req, res) => res.json({ scenarios: SCENARIOS }));
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
      const member = runtime.rooms.getMember(runtime.room.id, identity.memberId);
      if (member && !member.online) runtime.guard.memberOffline(identity.memberId);
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
        authorRole: identity.role || undefined,
        text
      });
      res.json({ message });
      void Promise.resolve()
        .then(() => chatAgentBridge.handleMessage(req.params.projectId, message))
        .catch(async (error) => {
        const detail = error instanceof Error ? error.message : "Unable to start the team Agent";
        runtime.events.append({
          type: "agent_task_failed",
          roomId: runtime.room.id,
          memberId: identity.memberId,
          payload: {
            chatMessageId: message.id,
            error: detail
          }
        });
        await runtime.chat.createMessage({
          roomId: runtime.room.id,
          authorId: "agent",
          authorName: "System",
          kind: "system",
          text: `Unable to start the team Agent: ${detail}`
        });
        })
        .catch((error) => console.error("Unable to report team Agent startup failure", error));
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
      const runtime = runtimeManager.get(req.params.projectId);
      runtime.updateMemberRole(identity.memberId, member.role || undefined);
      res.json({ member });
    } catch (error) { next(error); }
  });

  app.get("/api/projects/:projectId/guard/approvals", async (req, res, next) => {
    try {
      const identity = requireIdentity(req, res);
      if (!identity) return;
      const runtime = runtimeManager.get(req.params.projectId);
      const member = await members.getMember(req.params.projectId, identity.memberId);
      const isOwner = roleLevel(member?.role) === "owner";
      res.json({ approvals: runtime.guard.pending().filter((approval) => approval.approverIds.includes(identity.memberId) || (approval.decision.approvers === "owners" && isOwner)) });
    } catch (error) { next(error); }
  });

  app.post("/api/projects/:projectId/guard/approvals/:approvalId", async (req, res, next) => {
    try {
      const identity = requireIdentity(req, res);
      if (!identity) return;
      const approve = req.body?.approve;
      if (typeof approve !== "boolean") { res.status(400).json({ error: "approve must be a boolean" }); return; }
      const runtime = runtimeManager.get(req.params.projectId);
      const accepted = approve
        ? await runtime.guard.approve(req.params.approvalId, identity.memberId)
        : await runtime.guard.reject(req.params.approvalId, identity.memberId);
      if (!accepted) { res.status(403).json({ error: "Approval is unavailable or the member is no longer authorized" }); return; }
      res.json({ accepted: true });
    } catch (error) { next(error); }
  });

  app.delete("/api/projects/:projectId/guard/approvals/:approvalId", async (req, res, next) => {
    try {
      const identity = requireIdentity(req, res);
      if (!identity) return;
      const accepted = await runtimeManager.get(req.params.projectId).guard.withdraw(req.params.approvalId, identity.memberId);
      if (!accepted) { res.status(403).json({ error: "Only the request initiator can withdraw this approval" }); return; }
      res.json({ accepted: true });
    } catch (error) { next(error); }
  });

  app.post("/api/projects/:projectId/terminal/control", async (req, res, next) => {
    try {
      const identity = requireIdentity(req, res);
      if (!identity) return;
      const runtime = runtimeManager.get(req.params.projectId);
      const holderMemberId = req.body?.holderMemberId;
      if (holderMemberId !== null && typeof holderMemberId !== "string") { res.status(400).json({ error: "holderMemberId must be a string or null" }); return; }
      await runtime.guard.setControl(holderMemberId, identity.memberId);
      res.json(runtime.guard.controlState());
    } catch (error) { next(error); }
  });

  app.get("/api/projects/:projectId/guard/settings", async (req, res, next) => {
    try {
      if (!requireIdentity(req, res)) return;
      res.json(await runtimeManager.get(req.params.projectId).guard.getSettings());
    } catch (error) { next(error); }
  });

  app.put("/api/projects/:projectId/guard/settings", async (req, res, next) => {
    try {
      const identity = requireIdentity(req, res);
      if (!identity) return;
      if (roleLevel((await members.getMember(identity.projectId, identity.memberId))?.role) !== "owner") { res.sendStatus(403); return; }
      const protectedPaths = req.body?.protectedPaths;
      if (protectedPaths !== undefined && (!Array.isArray(protectedPaths) || protectedPaths.some((value: unknown) => typeof value !== "string"))) { res.status(400).json({ error: "protectedPaths must be an array of strings" }); return; }
      res.json(await runtimeManager.get(req.params.projectId).guard.updatePolicy({
        protectedPaths,
        llmMode: req.body?.llmMode
      }));
    } catch (error) { next(error); }
  });

  app.get("/api/projects/:projectId/guard/snapshots", async (req, res, next) => {
    try {
      if (!requireIdentity(req, res)) return;
      res.json({ snapshots: await runtimeManager.get(req.params.projectId).guard.listSnapshots() });
    } catch (error) { next(error); }
  });

  app.post("/api/projects/:projectId/guard/snapshots/:snapshotId/restore", async (req, res, next) => {
    try {
      const identity = requireIdentity(req, res);
      if (!identity) return;
      const manifest = await runtimeManager.get(req.params.projectId).guard.restoreSnapshot(req.params.snapshotId, identity.memberId);
      res.json({ manifest });
    } catch (error) { next(error); }
  });
}
