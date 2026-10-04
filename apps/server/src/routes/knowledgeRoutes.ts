import type { Express } from "express";
import type { ProjectRuntimeManager } from "../projectRuntimeManager.js";
import { requireIdentity } from "../auth/permissions.js";
import type { MemberStore } from "../auth/identity.js";

export function registerKnowledgeRoutes(
  app: Express,
  runtimeManager: ProjectRuntimeManager,
  members: MemberStore,
  enabled: boolean
) {
  app.use("/api/projects/:projectId/knowledge", (_req, res, next) => {
    if (!enabled) {
      res.status(404).json({ error: "Knowledge feature is disabled" });
      return;
    }
    next();
  });

  function serviceFor(projectId: string, response: { status(code: number): { json(body: unknown): void } }) {
    if (!enabled) {
      response.status(404).json({ error: "Knowledge feature is disabled" });
      return undefined;
    }
    const service = runtimeManager.get(projectId).knowledge;
    if (!service) {
      response.status(404).json({ error: "Knowledge feature is disabled" });
      return undefined;
    }
    return service;
  }

  app.get("/api/projects/:projectId/knowledge/cards", async (req, res, next) => {
    try {
      const identity = requireIdentity(req, res);
      if (!identity) return;
      const service = serviceFor(req.params.projectId, res);
      if (!service) return;
      const file = typeof req.query.file === "string" ? req.query.file : undefined;
      const cards = await service.list(identity, {
        file,
        type: typeof req.query.type === "string" ? req.query.type as never : undefined,
        status: typeof req.query.status === "string" ? req.query.status as never : undefined,
        scope: typeof req.query.scope === "string" ? req.query.scope as never : undefined
      });
      const resolutions = file ? await service.resolveAnchors(identity, file) : [];
      res.json({ cards, resolutions });
    } catch (error) { next(error); }
  });

  app.get("/api/projects/:projectId/knowledge/cards/:id", async (req, res, next) => {
    try {
      const identity = requireIdentity(req, res);
      if (!identity) return;
      const service = serviceFor(req.params.projectId, res);
      if (!service) return;
      const card = await service.get(identity, req.params.id);
      if (!card) { res.status(404).json({ error: "Knowledge card not found" }); return; }
      res.json({ card });
    } catch (error) { next(error); }
  });

  app.post("/api/projects/:projectId/knowledge/cards", async (req, res, next) => {
    try {
      const identity = requireIdentity(req, res);
      if (!identity) return;
      const service = serviceFor(req.params.projectId, res);
      if (!service) return;
      const draft = { ...(req.body ?? {}) } as Record<string, unknown>;
      if (draft.anchors === undefined && draft.anchor !== undefined) draft.anchors = [draft.anchor];
      const card = await service.create(identity, draft);
      res.status(201).json({ card });
    } catch (error) { next(error); }
  });

  app.patch("/api/projects/:projectId/knowledge/cards/:id", async (req, res, next) => {
    try {
      const identity = requireIdentity(req, res);
      if (!identity) return;
      const service = serviceFor(req.params.projectId, res);
      if (!service) return;
      const patch = { ...(req.body ?? {}) } as Record<string, unknown>;
      if (patch.authorMemberId !== undefined) {
        if (typeof patch.authorMemberId !== "string") throw new Error("Draft author must be a project member");
        const author = await members.getMember(req.params.projectId, patch.authorMemberId);
        if (!author) throw new Error("Draft author must be a project member");
        patch.authorName = author.displayName;
      }
      const card = await service.update(identity, req.params.id, patch);
      res.json({ card });
    } catch (error) { next(error); }
  });

  app.post("/api/projects/:projectId/knowledge/cards/:id/confirm", async (req, res, next) => {
    try {
      const identity = requireIdentity(req, res);
      if (!identity) return;
      const service = serviceFor(req.params.projectId, res);
      if (!service) return;
      const durationMs = req.body?.durationMs;
      if (durationMs !== undefined && (typeof durationMs !== "number" || !Number.isFinite(durationMs) || durationMs < 0)) throw new Error("Review duration is invalid");
      const card = await service.confirm(identity, req.params.id, { edited: req.body?.edited === true, durationMs });
      res.json({ card });
    } catch (error) { next(error); }
  });

  app.post("/api/projects/:projectId/knowledge/cards/:id/archive", async (req, res, next) => {
    try {
      const identity = requireIdentity(req, res);
      if (!identity) return;
      const service = serviceFor(req.params.projectId, res);
      if (!service) return;
      const card = await service.archive(identity, req.params.id, typeof req.body?.reason === "string" ? req.body.reason : undefined);
      res.json({ card });
    } catch (error) { next(error); }
  });

  app.post("/api/projects/:projectId/knowledge/cards/:id/anchors/:index", async (req, res, next) => {
    try {
      const identity = requireIdentity(req, res);
      if (!identity) return;
      const service = serviceFor(req.params.projectId, res);
      if (!service) return;
      const index = Number(req.params.index);
      if (!Number.isInteger(index) || index < 0) { res.status(400).json({ error: "Anchor index is invalid" }); return; }
      const selection = req.body?.selection ?? req.body;
      const card = await service.reanchor(identity, req.params.id, index, selection);
      res.json({ card });
    } catch (error) { next(error); }
  });

  app.get("/api/projects/:projectId/knowledge/guide", async (req, res, next) => {
    try {
      const identity = requireIdentity(req, res);
      if (!identity) return;
      const service = serviceFor(req.params.projectId, res);
      if (!service) return;
      const items = await service.guide(identity, typeof req.query.file === "string" ? req.query.file : undefined);
      res.json({ items });
    } catch (error) { next(error); }
  });

  app.get("/api/projects/:projectId/knowledge/timeline", async (req, res, next) => {
    try {
      const identity = requireIdentity(req, res);
      if (!identity) return;
      const service = serviceFor(req.params.projectId, res);
      if (!service) return;
      const items = await service.timeline(identity, typeof req.query.file === "string" ? req.query.file : undefined);
      res.json({ items });
    } catch (error) { next(error); }
  });

  app.post("/api/projects/:projectId/knowledge/demo", async (req, res, next) => {
    try {
      const identity = requireIdentity(req, res);
      if (!identity) return;
      const service = serviceFor(req.params.projectId, res);
      if (!service) return;
      const cards = await service.generateDemo(identity);
      res.status(201).json({ cards });
    } catch (error) { next(error); }
  });

  app.get("/api/projects/:projectId/knowledge/inbox", async (req, res, next) => {
    try {
      const identity = requireIdentity(req, res); if (!identity) return;
      const capture = runtimeManager.get(req.params.projectId).capture; if (!capture) { res.sendStatus(404); return; }
      res.json({ suggestions: await capture.list(identity.memberId, req.query.view === "all"), warnings: await capture.listWarnings(identity) });
    } catch (error) { next(error); }
  });
  app.get("/api/projects/:projectId/knowledge/inbox/:id", async (req, res, next) => {
    try {
      if (!requireIdentity(req, res)) return;
      const suggestion = await runtimeManager.get(req.params.projectId).capture?.get(req.params.id);
      if (!suggestion) { res.sendStatus(404); return; }
      res.json({ suggestion });
    } catch (error) { next(error); }
  });
  app.post("/api/projects/:projectId/knowledge/inbox/read", async (req, res, next) => {
    try {
      const identity = requireIdentity(req, res); if (!identity) return;
      const capture = runtimeManager.get(req.params.projectId).capture; if (!capture) { res.sendStatus(404); return; }
      if (!Array.isArray(req.body?.ids) || req.body.ids.length > 100 || req.body.ids.some((id: unknown) => typeof id !== "string")) throw new Error("Select up to 100 suggestion ids");
      await capture.markRead(identity.memberId, req.body.ids);
      res.json({ ok: true });
    } catch (error) { next(error); }
  });
  app.post("/api/projects/:projectId/knowledge/inbox/warnings/read", async (req, res, next) => {
    try {
      const identity = requireIdentity(req, res); if (!identity) return;
      const capture = runtimeManager.get(req.params.projectId).capture; if (!capture) { res.sendStatus(404); return; }
      if (!Array.isArray(req.body?.ids) || req.body.ids.length > 100 || req.body.ids.some((id: unknown) => typeof id !== "string")) throw new Error("Select up to 100 warning ids");
      await capture.markWarningsRead(identity.memberId, req.body.ids);
      res.json({ ok: true });
    } catch (error) { next(error); }
  });
  for (const action of ["accept", "ai-draft", "discard", "merge"] as const) {
    app.post(`/api/projects/:projectId/knowledge/inbox/:id/${action}`, async (req, res, next) => {
      try {
        const identity = requireIdentity(req, res); if (!identity) return;
        const capture = runtimeManager.get(req.params.projectId).capture; if (!capture) { res.sendStatus(404); return; }
        if (action === "discard") { await capture.discard(identity, req.params.id); res.json({ ok: true }); }
        else if (action === "merge") {
          if (typeof req.body?.cardId !== "string") throw new Error("A reviewed card id is required");
          res.json(await capture.merge(identity, req.params.id, req.body.cardId));
        } else res.json(await capture.accept(identity, req.params.id, action === "ai-draft"));
      } catch (error) { next(error); }
    });
  }
  app.post("/api/projects/:projectId/knowledge/from-chat", async (req, res, next) => {
    try {
      const identity = requireIdentity(req, res); if (!identity) return;
      const capture = runtimeManager.get(req.params.projectId).capture; if (!capture) { res.sendStatus(404); return; }
      if (!Array.isArray(req.body?.messageIds) || req.body.messageIds.length > 100 || req.body.messageIds.some((id: unknown) => typeof id !== "string")) throw new Error("Select up to 100 chat message ids");
      res.status(201).json({ suggestion: await capture.fromChat(identity, req.body.messageIds) });
    } catch (error) { next(error); }
  });
}
