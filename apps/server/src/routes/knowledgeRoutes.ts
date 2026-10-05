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

  async function validateDraftAuthor(projectId: string, patch: Record<string, unknown>) {
    if (patch.authorMemberId === undefined) return;
    if (typeof patch.authorMemberId !== "string") throw new Error("Draft author must be a project member");
    const author = await members.getMember(projectId, patch.authorMemberId);
    if (!author) throw new Error("Draft author must be a project member");
    patch.authorName = author.displayName;
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

  app.get("/api/projects/:projectId/knowledge/cards/pending-team", async (req, res, next) => {
    try {
      const identity = requireIdentity(req, res); if (!identity) return;
      const service = serviceFor(req.params.projectId, res); if (!service) return;
      res.json({ cards: await service.listPendingTeam(identity) });
    } catch (error) { next(error); }
  });

  app.get("/api/projects/:projectId/knowledge/cards/:id/relations/candidates", async (req, res, next) => {
    try {
      const identity = requireIdentity(req, res); if (!identity) return;
      const service = serviceFor(req.params.projectId, res); if (!service) return;
      res.json({ candidates: await service.relationCandidates(identity, req.params.id) });
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
      await validateDraftAuthor(req.params.projectId, patch);
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
      const patchInput = req.body?.patch;
      if (patchInput !== undefined && (patchInput === null || typeof patchInput !== "object" || Array.isArray(patchInput))) throw new Error("Confirmation patch must be an object");
      const patch = patchInput === undefined ? undefined : { ...patchInput } as Record<string, unknown>;
      if (patch) await validateDraftAuthor(req.params.projectId, patch);
      const card = await service.confirm(identity, req.params.id, { edited: req.body?.edited === true, durationMs, patch });
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

  app.post("/api/projects/:projectId/knowledge/cards/:id/scope/request-team", async (req, res, next) => {
    try {
      const identity = requireIdentity(req, res); if (!identity) return;
      const service = serviceFor(req.params.projectId, res); if (!service) return;
      res.json({ card: await service.requestTeam(identity, req.params.id) });
    } catch (error) { next(error); }
  });

  app.post("/api/projects/:projectId/knowledge/cards/:id/scope/confirm-team", async (req, res, next) => {
    try {
      const identity = requireIdentity(req, res); if (!identity) return;
      const runtime = runtimeManager.get(req.params.projectId); const service = serviceFor(req.params.projectId, res); if (!service) return;
      const config = await runtime.knowledgeProvider?.getConfig();
      res.json({ card: await service.confirmTeam(identity, req.params.id, config?.requireSecondConfirmForTeam ?? true) });
    } catch (error) { next(error); }
  });

  app.post("/api/projects/:projectId/knowledge/cards/:id/relations", async (req, res, next) => {
    try {
      const identity = requireIdentity(req, res); if (!identity) return;
      const service = serviceFor(req.params.projectId, res); if (!service) return;
      const kind = req.body?.kind; const cardId = req.body?.cardId;
      if (!["supersedes", "contradicts", "duplicates", "refines"].includes(kind) || typeof cardId !== "string") throw new Error("Knowledge relation is invalid");
      res.json({ card: await service.relate(identity, req.params.id, { kind, cardId }) });
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

  app.get("/api/projects/:projectId/knowledge/config", async (req, res, next) => {
    try {
      if (!requireIdentity(req, res)) return;
      const provider = runtimeManager.get(req.params.projectId).knowledgeProvider;
      if (!provider) { res.sendStatus(404); return; }
      res.json({ config: await provider.getConfig() });
    } catch (error) { next(error); }
  });

  app.put("/api/projects/:projectId/knowledge/config", async (req, res, next) => {
    try {
      const identity = requireIdentity(req, res); if (!identity) return;
      const provider = runtimeManager.get(req.params.projectId).knowledgeProvider;
      if (!provider) { res.sendStatus(404); return; }
      const config = await provider.updateConfig(req.body ?? {}, identity.memberId);
      res.json({ config });
    } catch (error) { next(error); }
  });

  app.post("/api/projects/:projectId/knowledge/preview", async (req, res, next) => {
    try {
      const identity = requireIdentity(req, res); if (!identity) return;
      const runtime = runtimeManager.get(req.params.projectId);
      const provider = runtime.knowledgeProvider;
      if (!provider) { res.sendStatus(404); return; }
      const member = runtime.rooms.getMember(runtime.room.id, identity.memberId);
      if (!member) { res.status(403).json({ error: "Project membership is required" }); return; }
      const run = {
        id: "preview",
        projectId: req.params.projectId,
        memberId: identity.memberId,
        initiatorMemberId: identity.memberId,
        prompt: typeof req.body?.prompt === "string" ? req.body.prompt : "",
        extraPrompt: typeof req.body?.extraPrompt === "string" ? req.body.extraPrompt : undefined,
        contexts: Array.isArray(req.body?.contexts) ? req.body.contexts : undefined,
        knowledge: normalizeKnowledgeInput(req.body?.knowledge),
        status: "queued",
        runtime: "opencode",
        provider: "deepseek",
        model: "preview",
        createdAt: new Date().toISOString()
      } as const;
      res.json(await provider.buildContext({ project: runtime.project, run, initiator: member }, { recordUsage: false }));
    } catch (error) { next(error); }
  });

  app.post("/api/projects/:projectId/knowledge/cards/:id/view", async (req, res, next) => {
    try {
      const identity = requireIdentity(req, res); if (!identity) return;
      const provider = runtimeManager.get(req.params.projectId).knowledgeProvider;
      if (!provider) { res.sendStatus(404); return; }
      await provider.markViewed(req.params.id, identity.memberId);
      res.json({ ok: true });
    } catch (error) { next(error); }
  });

  app.get("/api/projects/:projectId/knowledge/metrics/reuse", async (req, res, next) => {
    try {
      if (!requireIdentity(req, res)) return;
      const provider = runtimeManager.get(req.params.projectId).knowledgeProvider;
      if (!provider) { res.sendStatus(404); return; }
      res.json({ metrics: await provider.reuseMetrics() });
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
  app.post("/api/projects/:projectId/knowledge/inbox/:id/dispute", async (req, res, next) => {
    try {
      const identity = requireIdentity(req, res); if (!identity) return;
      const capture = runtimeManager.get(req.params.projectId).capture; if (!capture) { res.sendStatus(404); return; }
      if (typeof req.body?.reason !== "string" || !req.body.reason.trim()) throw new Error("A dispute reason is required");
      res.json({ suggestion: await capture.dispute(identity, req.params.id, req.body.reason) });
    } catch (error) { next(error); }
  });
  app.post("/api/projects/:projectId/knowledge/from-chat", async (req, res, next) => {
    try {
      const identity = requireIdentity(req, res); if (!identity) return;
      const capture = runtimeManager.get(req.params.projectId).capture; if (!capture) { res.sendStatus(404); return; }
      if (!Array.isArray(req.body?.messageIds) || req.body.messageIds.length > 100 || req.body.messageIds.some((id: unknown) => typeof id !== "string")) throw new Error("Select up to 100 chat message ids");
      res.status(201).json({ suggestion: await capture.fromChat(identity, req.body.messageIds) });
    } catch (error) { next(error); }
  });
}

function normalizeKnowledgeInput(value: unknown) {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid knowledge options");
  const input = value as Record<string, unknown>;
  if (input.excludeCardIds !== undefined && (!Array.isArray(input.excludeCardIds) || input.excludeCardIds.some((id) => typeof id !== "string"))) throw new Error("Invalid excluded knowledge cards");
  if (input.disabled !== undefined && typeof input.disabled !== "boolean") throw new Error("Invalid knowledge disabled flag");
  return { excludeCardIds: input.excludeCardIds as string[] | undefined, disabled: input.disabled as boolean | undefined };
}
