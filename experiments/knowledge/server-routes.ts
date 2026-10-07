import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import type {Express, Request, Response} from "express";
import {
  isCaptureEvent, isKnowledgeCard, offsetsFromRange, normalizeWorkspaceRelativePath, createOpenAICompatibleClient,
  extractKnowledgeCardDraft, extractAgentRecapDraft, parseAgentRecapDraft, type KnowledgeCard
} from "@simplercp/knowledge";
import {requireIdentity} from "../../apps/server/src/auth/permissions.js";
import type {ServerConfig} from "../../apps/server/src/config.js";
import type {ProjectRuntimeManager} from "../../apps/server/src/projectRuntimeManager.js";
import type {AgentRunManager} from "../../apps/server/src/agent/agentRunManager.js";
import {writeJsonFileAtomically} from "../../apps/server/src/jsonFile.js";
import {getProjectMetadataPath} from "../../apps/server/src/projects.js";
import {enrichRecapEvidence} from "../../apps/server/src/knowledge/recapEvidence.js";
import {redactSensitive} from "../../apps/server/src/agent/traceStore.js";

export function registerExperimentRoutes(app: Express, options: {enabled: boolean; provider: string; model: string; speed: number; configuration: ServerConfig}) {
  if (!options.enabled) return;
  const manager = app.locals.runtimeManager as ProjectRuntimeManager;
  const agentRuns = app.locals.agentRuns as AgentRunManager;
  const route = (method: "get" | "post", suffix: string, operation: (request: Request, response: Response) => Promise<void>) => {
    app[method](`/api/projects/:projectId/experiments/${suffix}`, (request, response, next) => {void operation(request, response).catch(next);});
  };
  app.get("/api/experiments/status", (_request, response) => response.json({enabled: true, fakeAgentRuntime: options.configuration.fakeAgentRuntime, provider: options.provider, model: options.model, speed: options.speed, captureConfig: options.configuration.captureConfig}));
  route("post", "cards/import", async (request, response) => {
    const identity = requireIdentity(request, response); if (!identity) return;
    const runtime = manager.get(request.params.projectId);
    if (!Array.isArray(request.body.cards) || request.body.cards.length > 100) throw new Error("At most 100 cards are allowed");
    const sources: KnowledgeCard[] = request.body.cards;
    if (sources.some(card => !isKnowledgeCard(card) || !/^[\w-]+$/u.test(card.id))) throw new Error("Import requires valid schema v3 cards");
    const cards = [];
    for (const source of sources) {
      for (const anchor of source.anchors) {
        const text = await fs.readFile(path.join(runtime.project.workspacePath, anchor.file.workspaceRelativePath), "utf8");
        const offsets = anchor.rangeAtCapture && offsetsFromRange(text, anchor.rangeAtCapture);
        if (!offsets || text.slice(offsets.startOffset, offsets.endOffset) !== anchor.snapshot.text) throw new Error(`Import snapshot differs from its range: ${source.id}`);
      }
      const created = await runtime.knowledge!.create(identity, {
        type: source.type, title: source.title, summary: source.summary, content: source.content, tags: source.tags,
        scope: source.scope === "team" ? "team" : "personal", appliesTo: source.appliesTo, check: source.check,
        anchors: source.anchors.map(anchor => ({file: anchor.file.workspaceRelativePath, selection: anchor.rangeAtCapture}))
      });
      const imported: KnowledgeCard = {
        ...source, anchors: created.anchors, ownerMemberId: identity.memberId,
        metadata: {...source.metadata, roomId: runtime.room.id},
        provenance: {...source.provenance!, author: {kind: "human", memberId: identity.memberId, displayName: identity.displayName}},
        review: {...source.review!, confirmedBy: [identity.memberId]}
      };
      if (!isKnowledgeCard(imported)) throw new Error("Imported card schema is invalid");
      const cardsDirectory = path.join(getProjectMetadataPath(runtime.project), "knowledge/cards");
      await writeJsonFileAtomically(path.join(cardsDirectory, `${source.id}.json`), imported);
      await fs.unlink(path.join(cardsDirectory, `${created.id}.json`));
      cards.push(await runtime.knowledge!.get(identity, source.id));
    }
    runtime.events.append({type: "knowledge_config_updated", roomId: runtime.room.id, memberId: identity.memberId, payload: {experiment: "cards/import", cardIds: sources.map(card => card.id)}});
    response.json({cards});
  });
  route("post", "cards/:id/review", async (request, response) => {
    const identity = requireIdentity(request, response); if (!identity) return;
    const runtime = manager.get(request.params.projectId);
    const card = await runtime.knowledge!.get(identity, request.params.id);
    if (!card || card.status !== "draft" || card.ownerMemberId !== identity.memberId) throw new Error("An owned draft is required");
    const now = Date.now();
    const reviewed: KnowledgeCard = {...card, status: "reviewed", updatedAt: now, review: {confirmedBy: [identity.memberId], confirmedAt: now, editedBeforeConfirm: false}, evolution: [...card.evolution, {at: now, action: "confirmed", by: {peerId: identity.memberId}, note: "experiment:T2"}]};
    await runtime.knowledge!.awaitIdle();
    await writeJsonFileAtomically(path.join(getProjectMetadataPath(runtime.project), "knowledge/cards", `${card.id}.json`), reviewed);
    runtime.events.append({type: "knowledge_card_confirmed", roomId: runtime.room.id, memberId: identity.memberId, payload: {cardId: card.id, experiment: "T2", directReviewed: true}});
    await runtime.knowledgeProvider!.onCardConfirmed(reviewed);
    response.json({card: reviewed});
  });
  route("post", "capture/disable", async (request, response) => {
    const identity = requireIdentity(request, response); if (!identity) return;
    const runtime = manager.get(request.params.projectId);
    await runtime.capture!.dispose();
    runtime.events.append({type: "knowledge_config_updated", roomId: runtime.room.id, memberId: identity.memberId, payload: {experiment: "capture/disable"}});
    response.json({disabled: true});
  });
  route("post", "documents/flush", async (request, response) => {
    const identity = requireIdentity(request, response); if (!identity) return;
    const runtime = manager.get(request.params.projectId);
    const {file, expectedText} = request.body;
    if (file !== undefined || expectedText !== undefined) {
      if (typeof file !== "string" || typeof expectedText !== "string") throw new Error("Document path and expected text are required");
      const normalized = normalizeWorkspaceRelativePath(file);
      const name = `${runtime.project.id}|${runtime.room.id}:${normalized}`;
      const deadline = Date.now() + 10000;
      let document = await runtime.documents.getPreparedDocument(name);
      while ((!document || document.getText("content").toString() !== expectedText) && Date.now() < deadline) {
        await new Promise<void>(resolve => setTimeout(resolve, 20));
        document = await runtime.documents.getPreparedDocument(name);
      }
      if (!document || document.getText("content").toString() !== expectedText) throw new Error("Server did not receive the expected Yjs edit");
    }
    await runtime.documents.awaitIdle();
    if (file !== undefined && await fs.readFile(path.join(runtime.project.workspacePath, normalizeWorkspaceRelativePath(file)), "utf8") !== expectedText) throw new Error("Persisted document differs from its acknowledged edit");
    response.json({flushed: true});
  });
  route("post", "runs/:id/settle", async (request, response) => {
    const identity = requireIdentity(request, response); if (!identity) return;
    const runtime = manager.get(request.params.projectId);
    const run = await agentRuns.awaitRunIdle(runtime.project.id, request.params.id);
    await runtime.documents.awaitIdle();
    response.json({run});
  });
  route("post", "capture/agent-event", async (request, response) => {
    const identity = requireIdentity(request, response); if (!identity) return;
    const event = request.body.event;
    if (!isCaptureEvent(event) || !["agentRun", "agentTool"].includes(event.type)) throw new Error("A script Agent event is required");
    const runtime = manager.get(request.params.projectId);
    await runtime.capture!.feed(event);
    runtime.events.append({type: "knowledge_config_updated", roomId: runtime.room.id, memberId: identity.memberId, payload: {experiment: "script-agent-event", type: event.type}});
    response.json({recorded: true});
  });
  route("get", "recording", async (request, response) => {
    const identity = requireIdentity(request, response); if (!identity) return;
    const runtime = manager.get(request.params.projectId);
    const suggestions = await runtime.capture!.list(identity.memberId, true);
    const directory = path.join(getProjectMetadataPath(runtime.project), "knowledge");
    response.json({events: (await fs.readFile(path.join(directory, "events.jsonl"), "utf8")).split("\n").filter(Boolean).map(line => JSON.parse(line)), config: JSON.parse(await fs.readFile(path.join(directory, "capture-config.json"), "utf8")), suggestions});
  });
  route("post", "drafts", async (request, response) => {
    const identity = requireIdentity(request, response); if (!identity) return;
    const runtime = manager.get(request.params.projectId);
    const {mode, evidence: rawEvidence, triggerType, runId} = request.body;
    const evidence = rawEvidence && typeof rawEvidence === "object" ? redactSensitive(await enrichRecapEvidence(rawEvidence, runtime.project.workspacePath), [options.configuration.knowledgeLlm?.apiKey ?? "", options.configuration.agent?.apiKey ?? ""], {preserveLength: true}) as Record<string, unknown> : rawEvidence;
    if (!["ordinary", "server", "agent-self"].includes(mode) || !evidence || typeof evidence !== "object") throw new Error("Draft mode and evidence are required");
    const configuration = options.configuration.knowledgeLlm!;
    const started = Date.now();
    const calls: any[] = [];
    const responses: string[] = [];
    const base = createOpenAICompatibleClient({...configuration, fetch: (url, input) => fetch(url, {...input, body: JSON.stringify({...JSON.parse(String(input!.body)), reasoning_split: true})})});
    const client = {...base, async complete(input: Parameters<typeof base.complete>[0]) {
      const result = await base.complete(input);
      responses.push(result.text);
      calls.push({provider: configuration.provider, model: configuration.model, promptHash: crypto.createHash("sha256").update(JSON.stringify(input.messages)).digest("hex"), usage: result.usage});
      return result;
    }};
    let draft: any;
    let fallback = false;
    if (mode === "ordinary") draft = await extractKnowledgeCardDraft({triggerType, evidence}, {client, model: configuration.model, onFallback() {fallback = true;}});
    else if (mode === "server") {
      const result = await extractAgentRecapDraft(evidence, {client, model: configuration.model, language: "zh"});
      draft = result.draft; fallback = result.fallback;
    } else {
      const result = await agentRuns.requestAgentSelfRecap(runtime.project.id, runId, evidence);
      responses.push(result.text);
      draft = parseAgentRecapDraft(result.text, evidence);
      if (!draft) throw new Error("Agent self recap could not be parsed");
      calls.push({provider: result.provider, model: result.model, usage: result.usage, promptHash: result.promptHash});
    }
    for (const call of calls) await fs.appendFile(path.join(getProjectMetadataPath(runtime.project), "knowledge/llm-calls.jsonl"), JSON.stringify({...call, purpose: `experiment:K2:${mode}`, completed: !fallback, fallback, durationMs: Date.now() - started}) + "\n");
    runtime.events.append({type: "knowledge_config_updated", roomId: runtime.room.id, memberId: identity.memberId, payload: {experiment: "drafts", mode}});
    response.json({draft, fallback, calls, responses, evidence, latencyMs: Date.now() - started});
  });
  route("post", "recap-from-episode", async (request, response) => {
    const identity = requireIdentity(request, response); if (!identity) return;
    const runtime = manager.get(request.params.projectId);
    const {runId, correctionRunId, correctionAction, correctionText, correctionFiles = []} = request.body;
    if (typeof runId !== "string" || typeof correctionText !== "string" || !correctionText.trim() || !["revise", "correct", "interrupt"].includes(correctionAction)) throw new Error("Run, correction action and original text are required");
    const run = await agentRuns.awaitRunIdle(runtime.project.id, runId);
    if (!run || !["completed", "failed", "cancelled"].includes(run.status)) throw new Error("The original run must be finished");
    const correctionRun = correctionRunId ? await agentRuns.awaitRunIdle(runtime.project.id, correctionRunId) : undefined;
    if (correctionRunId && (!correctionRun || !["completed", "failed", "cancelled"].includes(correctionRun.status))) throw new Error("The correction run must be finished");
    if (correctionRun && (correctionRun.initiatorMemberId ?? correctionRun.memberId) !== identity.memberId) throw new Error("Correction must belong to the requesting member");
    if (!Array.isArray(correctionFiles)) throw new Error("Correction file versions must be an array");
    const previousChanges = await runtime.capture!.getAgentRunChanges(runId);
    const correctedChanges = correctionRun ? await runtime.capture!.getAgentRunChanges(correctionRun.id) : [];
    const files = correctionFiles.length ? correctionFiles : correctedChanges.flatMap(change => {
      const beforeText = previousChanges.find(previous => previous.file === change.file)?.afterText ?? change.beforeText ?? "";
      return typeof change.afterText === "string" ? [{file: change.file, beforeText, afterText: change.afterText}] : [];
    });
    for (const file of files) {
      if (typeof file.file !== "string" || typeof file.beforeText !== "string" || typeof file.afterText !== "string") throw new Error("Complete correction file versions are required");
      const current = await runtime.documents.getPreparedDocument(`${runtime.project.id}|${runtime.room.id}:${normalizeWorkspaceRelativePath(file.file)}`);
      const text = current?.getText("content").toString() ?? await fs.readFile(path.join(runtime.project.workspacePath, normalizeWorkspaceRelativePath(file.file)), "utf8");
      const secrets = [options.configuration.knowledgeLlm?.apiKey ?? "", options.configuration.agent?.apiKey ?? ""];
      if (redactSensitive(text, secrets, {preserveLength: true}) !== redactSensitive(file.afterText, secrets, {preserveLength: true})) throw new Error("Correction version differs from current workspace");
      const previous = previousChanges.find(change => change.file === normalizeWorkspaceRelativePath(file.file));
      const expectedBefore = previous?.afterText ?? correctedChanges.find(change => change.file === normalizeWorkspaceRelativePath(file.file))?.beforeText;
      if (typeof expectedBefore !== "string" || redactSensitive(expectedBefore, secrets, {preserveLength: true}) !== redactSensitive(file.beforeText, secrets, {preserveLength: true})) throw new Error("Agent version differs from the recorded original run");
    }
    const natural = (await runtime.capture!.list(identity.memberId, true)).find(item => item.evidence.captureBypassed !== true && item.actors.runIds.includes(runId) && ["agent.revised", "agent.corrected", "agent.interrupted"].includes(item.triggerType));
    const naturallyTriggered = Boolean(natural);
    const suggestion = await runtime.capture!.fromEpisode({id: crypto.randomUUID(), createdAt: Date.now(), triggerType: correctionAction === "revise" ? "agent.revised" : "agent.corrected", origin: "human-agent", state: "open", actors: {memberIds: [...new Set([identity.memberId, run.initiatorMemberId ?? run.memberId])], runIds: [runId, ...(correctionRun ? [correctionRun.id] : [])]}, suggestedTitle: "实验纠正记录", suggestedSummary: correctionText, suggestedType: "constraint", evidence: {previousRun: run, correctionRun, correction: correctionText, editor: identity.memberId, primaryActor: identity.memberId, correctionFiles: files, captureBypassed: true, naturallyTriggered}});
    runtime.events.append({type: "knowledge_config_updated", roomId: runtime.room.id, memberId: identity.memberId, payload: {experiment: "recap-from-episode", runId, suggestionId: suggestion.id, captureBypassed: true, naturallyTriggered: suggestion.evidence.naturallyTriggered}});
    response.json({suggestion, captureBypassed: true, naturallyTriggered: suggestion.evidence.naturallyTriggered});
  });
  app.use((error: Error, _request: Request, response: Response, _next: unknown) => response.status(400).json({error: error.message}));
}
