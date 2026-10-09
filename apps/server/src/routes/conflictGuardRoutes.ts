import type { Express } from "express";
import type { ProjectRuntimeManager } from "../projectRuntimeManager.js";
import { requireIdentity } from "../auth/permissions.js";

export function registerConflictGuardRoutes(app: Express, runtimeManager: ProjectRuntimeManager) {
  app.post("/api/projects/:projectId/conflict-guard/pairs/:pairId/acknowledge", async (req, res, next) => {
    try {
      const identity = requireIdentity(req, res); if (!identity) return;
      const guard = runtimeManager.get(req.params.projectId).conflictGuard;
      if (!guard) { res.sendStatus(404); return; }
      const revision = req.body?.revision;
      const contentKey = req.body?.contentKey;
      if (!Number.isSafeInteger(revision) || typeof contentKey !== "string" || !/^[a-f0-9]{64}$/u.test(contentKey)) { res.status(400).json({ error: "必须提供检查版本和内容标识" }); return; }
      if (!await guard.acknowledgeWarning(req.params.pairId, revision, contentKey, identity.memberId)) { res.status(409).json({ error: "当前提醒已更新，或你没有确认权限" }); return; }
      res.status(204).end();
    } catch (error) { next(error); }
  });
  app.post("/api/projects/:projectId/conflict-guard/cards/:cardId/:action", async (req, res, next) => {
    try {
      const identity = requireIdentity(req, res); if (!identity) return;
      const runtime = runtimeManager.get(req.params.projectId);
      const guard = runtime.conflictGuard;
      if (!guard || !["rules", "full"].includes(guard.mode)) { res.status(409).json({ error: "当前模式不允许仲裁操作" }); return; }
      const action = req.params.action;
      if (!["accept", "yield", "chat"].includes(action)) { res.status(400).json({ error: "无效的卡片操作" }); return; }
      let card;
      try { card = guard.arbitration.act(req.params.cardId, identity.memberId, action as "accept" | "yield" | "chat"); }
      catch (error) { res.status(409).json({ error: error instanceof Error ? error.message : String(error) }); return; }
      if (action === "chat") {
        const names = card.owners.map((owner) => runtime.room.members.find((member) => member.id === owner)?.displayName ?? "协作成员");
        await runtime.chat.createMessage({ roomId: runtime.room.id, authorId: "system", authorName: "System", kind: "system", text: `${names.map((name) => `@${name}`).join(" ")} 意图差异：${card.explanation}；${card.path}` });
      }
      res.json({ card });
    } catch (error) { next(error); }
  });
  app.patch("/api/projects/:projectId/conflict-guard/notifications/:noticeId", (req, res, next) => {
    try {
      const identity = requireIdentity(req, res);
      if (!identity) return;
      const guard = runtimeManager.get(req.params.projectId).conflictGuard;
      if (!guard) { res.sendStatus(404); return; }
      const { read, handled } = req.body ?? {};
      if ((read !== undefined && typeof read !== "boolean") || (handled !== undefined && typeof handled !== "boolean")) { res.status(400).json({ error: "通知状态必须为 boolean" }); return; }
      if (!guard.agentGuard.updateNotice(req.params.noticeId, identity.memberId, { read, handled })) { res.sendStatus(404); return; }
      res.status(204).end();
    } catch (error) { next(error); }
  });
  app.get("/api/projects/:projectId/conflict-guard/symbol", (req, res, next) => {
    try {
      if (!requireIdentity(req, res)) return;
      const runtime = runtimeManager.get(req.params.projectId);
      if (!runtime.conflictGuard) { res.sendStatus(404); return; }
      if (typeof req.query.key !== "string") { res.status(400).json({ error: "必须提供符号 key" }); return; }
      const symbol = runtime.conflictGuard.symbol(req.query.key);
      if (!symbol) { res.sendStatus(404); return; }
      res.json(symbol);
    } catch (error) { next(error); }
  });
  app.get("/api/projects/:projectId/conflict-guard/state", (req, res, next) => {
    try {
      if (!requireIdentity(req, res)) return;
      const runtime = runtimeManager.get(req.params.projectId);
      if (!runtime.conflictGuard) { res.sendStatus(404); return; }
      res.json({ mode: runtime.conflictGuard.mode, ...runtime.conflictGuard.state(req.identity?.memberId) });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/projects/:projectId/conflict-guard/trace", async (req, res, next) => {
    try {
      if (!requireIdentity(req, res)) return;
      const runtime = runtimeManager.get(req.params.projectId);
      if (!runtime.conflictGuard) { res.sendStatus(404); return; }
      await runtime.conflictGuard.waitForTrace();
      res.type("application/x-ndjson");
      res.setHeader("Content-Disposition", 'attachment; filename="conflict-guard-trace.jsonl"');
      res.send(await runtime.conflictGuard.exportTrace());
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") { res.type("application/x-ndjson").send(""); return; }
      next(error);
    }
  });

  app.post("/api/projects/:projectId/conflict-guard/done", (req, res, next) => {
    try {
      if (!requireIdentity(req, res)) return;
      const runtime = runtimeManager.get(req.params.projectId);
      if (!runtime.conflictGuard) { res.sendStatus(404); return; }
      runtime.conflictGuard.markDone(req.identity!.memberId);
      res.status(204).end();
    } catch (error) {
      next(error);
    }
  });
  app.post("/api/projects/:projectId/conflict-guard/pairs/:pairId/confirm", (req, res, next) => {
    try {
      if (!requireIdentity(req, res)) return;
      const runtime = runtimeManager.get(req.params.projectId);
      if (!runtime.conflictGuard) { res.sendStatus(404); return; }
      if (!runtime.conflictGuard.confirmPair(req.params.pairId, req.identity!.memberId)) { res.status(409).json({ error: "当前成员不能确认该变更对" }); return; }
      res.status(204).end();
    } catch (error) { next(error); }
  });
  app.post("/api/projects/:projectId/conflict-guard/pairs/:pairId/revert", (req, res, next) => {
    try {
      if (!requireIdentity(req, res)) return;
      const runtime = runtimeManager.get(req.params.projectId);
      if (!runtime.conflictGuard) { res.sendStatus(404); return; }
      if (!runtime.conflictGuard.revertPair(req.params.pairId, req.identity!.memberId)) { res.status(409).json({ error: runtime.conflictGuard.revertError() }); return; }
      res.status(204).end();
    } catch (error) { next(error); }
  });
  app.post("/api/projects/:projectId/conflict-guard/pairs/:pairId/chat", async (req, res, next) => {
    try {
      const identity = requireIdentity(req, res);
      if (!identity) return;
      const runtime = runtimeManager.get(req.params.projectId);
      if (!runtime.conflictGuard) { res.sendStatus(404); return; }
      const text = String(req.body?.text ?? "").trim();
      if (!text) { res.status(400).json({ error: "必须提供聊天内容" }); return; }
      if (!runtime.conflictGuard.chatPair(req.params.pairId, identity.memberId, text)) { res.status(409).json({ error: "当前成员不能发送该变更对消息" }); return; }
      const message = await runtime.chat.createMessage({ roomId: runtime.room.id, authorId: "system", authorName: "System", kind: "system", text });
      res.json({ message });
    } catch (error) { next(error); }
  });
}
