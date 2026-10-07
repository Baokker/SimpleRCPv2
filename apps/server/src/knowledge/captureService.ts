import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { minimatch } from "minimatch";
import diff from "fast-diff";
import {
  VirtualCaptureClock, NotificationPolicy, createCaptureEngine, createOpenAICompatibleClient, createAgentRevisedSuggestion,
  extractKnowledgeCardDraft, isCaptureEvent, isCaptureSuggestion, searchKnowledgeCards, changedSnippet, applyCaptureOps,
  extractAgentRecapDraft, parseAgentRecapDraft,
  type CaptureEvent, type CaptureSuggestion, type CaptureChatEvent, type CaptureConfigInput,
  type CaptureCheckpoint, type LlmUsage, type CaptureAgentRunEvent, type CaptureAgentToolEvent, type CaptureAgentFileChange
} from "@simplercp/knowledge";
import type { KnowledgeActor, KnowledgeService } from "./knowledgeService.js";
import type { CollaborativeDocumentStore } from "../collaborativeDocuments.js";
import type { ChatStore } from "../chat.js";
import type { EventLog } from "../eventLog.js";
import type { WorkspaceChange, ServerMessage } from "../types.js";
import { readJsonFile, writeJsonFileAtomically } from "../jsonFile.js";
import { isIgnoredPath } from "../workspacePolicy.js";
import { readWorkspaceFile } from "../workspace.js";
import { createEditAttribution, deltaOperations } from "./attribution.js";
import { redactSensitive } from "../agent/traceStore.js";
import type { ImportedDraft } from "./documentIO.js";
import {enrichRecapEvidence} from "./recapEvidence.js";

type EventInput<T = CaptureEvent> = T extends CaptureEvent ? Omit<T, "seq" | "at" | "schemaVersion"> : never;
export interface CaptureServiceOptions {
  metadataRoot: string; workspaceRoot: string; knowledge: KnowledgeService; documents: CollaborativeDocumentStore;
  chat: ChatStore; events: EventLog; roomId: string; projectId: string; recordEvents?: boolean;
  config?: CaptureConfigInput; llm?: { provider?: "minimax" | "deepseek"; apiKey?: string; baseUrl: string; model: string };
  riskWarningConfig?: Partial<RiskWarningConfig>;
  onNotify(memberId: string, message: ServerMessage): void;
  memberName(memberId: string): string;
  recapMode?: () => Promise<"server" | "agent-self">;
  agentSelfRecap?: (suggestion: CaptureSuggestion) => Promise<AgentSelfRecapResult>;
  recapLanguage?: "zh" | "en";
}
export interface AgentSelfRecapResult { text: string; provider?: string; model?: string; promptHash?: string; usage?: LlmUsage; }
export interface RiskWarningConfig {
  files: string[];
  lexicalThreshold: number;
  vectorThreshold: number;
  cooldownMs: number;
  dedupeThreshold: number;
}
export const defaultRiskWarningConfig: RiskWarningConfig = {
  files: ["**/package.json", "**/tsconfig*.json", "**/vite.config.*", "**/.eslintrc*", "**/Dockerfile", "**/docker-compose*.yml", ".github/workflows/*"],
  lexicalThreshold: 1, vectorThreshold: 0.8, cooldownMs: 300_000, dedupeThreshold: 0.8
};
export interface KnowledgeRiskWarning { id: string; cardId: string; file: string; createdAt: number; seen: boolean; }

type RecapCardFields = {
  appliesTo?: { kind: "project" } | { kind: "glob"; patterns: string[] };
  check?: { kind: "regex-absent" | "regex-present"; pattern: string; fileGlob: string };
};

function recapCardFields(draft: {
  type: string;
  appliesTo?: { files: string[]; globs: string[]; taskKinds: string[] };
  checkSuggestion?: { kind: "regex-absent" | "regex-present"; pattern: string; fileGlob: string };
}): RecapCardFields {
  const patterns = [...new Set([...(draft.appliesTo?.files ?? []), ...(draft.appliesTo?.globs ?? [])].filter(Boolean))];
  const appliesTo = patterns.length ? { kind: "glob" as const, patterns } : { kind: "project" as const };
  const check = draft.checkSuggestion && (draft.type === "constraint" || draft.type === "negative")
    ? draft.checkSuggestion
    : undefined;
  return check ? { appliesTo, check } : { appliesTo };
}

export function addLlmUsage(target: LlmUsage, value: LlmUsage | undefined) {
  for (const key of ["promptTokens", "completionTokens", "reasoningTokens", "cacheReadTokens", "cacheWriteTokens", "totalTokens", "cost", "estimatedCost"] as const) {
    if (value?.[key] !== undefined) target[key] = (target[key] ?? 0) + value[key]!;
  }
  for (const key of ["estimatedCostCurrency", "estimatedCostSource"] as const) {
    if (value?.[key] !== undefined) target[key] = value[key];
  }
}

export function createCaptureService(options: CaptureServiceOptions) {
  let riskWarningConfig: RiskWarningConfig = { ...defaultRiskWarningConfig, ...options.riskWarningConfig, files: options.riskWarningConfig?.files ?? defaultRiskWarningConfig.files };
  const root = path.join(options.metadataRoot, "knowledge");
  const inbox = path.join(root, "inbox");
  const eventFile = path.join(root, "events.jsonl");
  const clock = new VirtualCaptureClock();
  const policy = new NotificationPolicy();
  const suggestions = new Map<string, CaptureSuggestion>();
  const resolving = new Set<string>();
  const activeResolutions = new Set<Promise<unknown>>();
  const texts = new Map<string, string>();
  const riskFiles = new Map<string, number>();
  const riskCards = new Map<string, number>();
  const cursorTimers = new Map<string, { timer: NodeJS.Timeout; input: EventInput }>();
  let seq = 0;
  let recovering = true;
  let disposed = false;
  let timer: NodeJS.Timeout | undefined;
  let operations: Promise<unknown> = Promise.resolve();
  let recapMode = options.recapMode;
  let agentSelfRecap = options.agentSelfRecap;
  const agentRunChanges = new Map<string, CaptureAgentFileChange[]>();
  let recapLanguage = options.recapLanguage ?? "zh";
  const engine = createCaptureEngine({ clock, config: options.config,
    onSuggestion(suggestion) { if (!recovering) enqueue(() => storeSuggestion(suggestion)); },
    onCheckpoint(checkpoint) {
      if (recovering) return;
      enqueue(async () => {
        await warn(checkpoint);
        await options.knowledge.refreshExpired({ memberId: checkpoint.actor, displayName: options.memberName(checkpoint.actor) }, checkpoint.file);
      });
    },
    onAgentRevised(event) {
      if (recovering) return;
      enqueue(() => storeSuggestion(createAgentRevisedSuggestion(event)));
    }
  });
  const ready = initialize();
  operations = ready;

  function enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const next = operations.then(operation);
    operations = next;
    return next;
  }
  function feed(input: EventInput) {
    return enqueue(async () => {
      if (disposed) return;
      if (input.type === "memberPresence" && input.action !== "join") {
        const cursor = cursorTimers.get(input.memberId);
        if (cursor) { clearTimeout(cursor.timer); cursorTimers.delete(input.memberId); processNow(cursor.input); }
      }
      processNow(input);
      schedule();
    });
  }
  function processNow(input: EventInput) {
    const at = Math.max(clock.now(), Date.now());
    clock.advanceTo(at);
    const event = mask({ ...input, schemaVersion: 1, seq: ++seq, at }) as CaptureEvent;
    if (event.type === "edit" && event.textBefore !== undefined && event.textAfter !== undefined && applyCaptureOps(event.textBefore, event.ops) !== event.textAfter) {
      event.ops = deltaOperations(event.textBefore, diff(event.textBefore, event.textAfter).map(([operation, value]) => operation === diff.EQUAL ? { retain: value.length } : operation === diff.DELETE ? { delete: value.length } : { insert: value }));
    }
    if (!isCaptureEvent(event)) throw new Error("Invalid normalized capture event");
    if (options.recordEvents !== false) enqueue(async () => fs.appendFile(eventFile, JSON.stringify(event) + "\n", { mode: 0o600 }));
    if (event.type === "edit" && event.actor !== "filesystem" && event.actor !== "unknown") policy.record(event.actor, "edit", at);
    if (event.type === "cursor") policy.record(event.memberId, "cursor", at);
    if (event.type === "memberPresence" && event.action === "switchFile") policy.record(event.memberId, "switch", at);
    engine.process(event);
    if (event.type === "agentRun" && event.action !== "start" && event.fileChanges) agentRunChanges.set(event.runId, event.fileChanges);
    if (event.type === "docOpen") texts.set(event.file, event.text);
    if (event.type === "edit" && event.textAfter !== undefined) texts.set(event.file, event.textAfter);
  }
  function schedule() {
    if (timer) clearTimeout(timer);
    const deadline = clock.nextDeadline();
    if (!disposed && Number.isFinite(deadline)) {
      timer = setTimeout(() => { void enqueue(async () => { if (disposed) return; clock.advanceTo(Math.max(Date.now(), clock.now())); schedule(); }); }, Math.max(0, deadline - Date.now()));
      timer.unref();
    }
  }
  async function initialize() {
    await fs.mkdir(inbox, { recursive: true, mode: 0o700 });
    for (const name of await fs.readdir(inbox)) {
      if (!name.endsWith(".json")) continue;
      const value = await readJsonFile<unknown>(path.join(inbox, name));
      if (!isCaptureSuggestion(value)) throw new Error(`Invalid knowledge suggestion: ${name}`);
      suggestions.set(value.id, value);
    }
    const configPath = path.join(root, "capture-config.json");
    const previousConfig = await readJsonFile<unknown>(configPath);
    if (previousConfig !== undefined) {
      if (!previousConfig || typeof previousConfig !== "object" || Array.isArray(previousConfig)) throw new Error("Recorded capture configuration is invalid");
      for (const [key, value] of Object.entries(previousConfig)) {
        if (key in engine.config && JSON.stringify((engine.config as unknown as Record<string, unknown>)[key]) !== JSON.stringify(value)) throw new Error("Recorded capture configuration differs from this runtime");
      }
    }
    await writeJsonFileAtomically(configPath, engine.config);
    try {
      const recording = await fs.readFile(eventFile, "utf8");
      for (const line of recording.split("\n").filter(Boolean)) {
        const event: unknown = JSON.parse(line);
        if (!isCaptureEvent(event)) throw new Error("Invalid recorded capture event");
        if (event.seq <= seq) throw new Error("Recorded capture sequence must increase");
        clock.advanceTo(event.at); engine.process(event); seq = event.seq;
        if (event.type === "agentRun" && event.action !== "start" && event.fileChanges) agentRunChanges.set(event.runId, event.fileChanges);
      }
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    await options.events.awaitIdle();
    for (const event of options.events.list()) {
      if (event.type !== "knowledge_notification" || !event.memberId) continue;
      const at = Date.parse(event.timestamp);
      if (Date.now() - at >= 3_600_000) continue;
      if (event.payload?.decision === "popup") policy.restorePopup(event.memberId, at);
      if (event.payload?.type === "knowledge_risk_warning") {
        if (typeof event.payload.file === "string") riskFiles.set(`${event.memberId}:${event.payload.file}`, at);
        if (typeof event.payload.cardId === "string") riskCards.set(`${event.memberId}:${event.payload.cardId}`, at);
      }
    }
    recovering = false;
    await scan(options.workspaceRoot);
    schedule();
  }
  async function scan(directory: string) {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      const file = path.relative(options.workspaceRoot, absolute).split(path.sep).join("/");
      if (!capturePath(file) || entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) await scan(absolute);
      else if (entry.isFile() && /\.(?:[cm]?[jt]sx?|json|md|ya?ml|py)$/.test(file)) {
        const loaded = await readWorkspaceFile(options.workspaceRoot, file);
        if (loaded.status === "text") { texts.set(file, loaded.content); processNow({ type: "docOpen", file, text: loaded.content }); }
      }
    }
  }
  function capturePath(file: string) { return !isIgnoredPath(file) && !file.split("/").some(segment => segment.startsWith(".env")); }
  function mask(value: unknown): unknown {
    return redactSensitive(value, options.llm?.apiKey ? [options.llm.apiKey] : [], {preserveLength: true});
  }
  const attribution = createEditAttribution({ documents: options.documents,
    onOpen(file, text) { if (capturePath(file)) void feed({ type: "docOpen", file, text }); },
    onEdit(edit) { if (capturePath(edit.file)) void feed({ type: "edit", ...edit }); },
    onRetired(file) { void feed({ type: "docRetired", file }); },
    onMirrorResync(file, text) { options.events.append({ type: "mirror_resync", payload: { file } }); void feed({ type: "docOpen", file, text }); }
  });
  const removeChat = options.chat.onMessage(message => { void feed({ type: "chat", messageId: message.id, authorId: message.authorId, kind: message.kind ?? "member", text: message.text, mentions: message.mentions }); });

  async function storeSuggestion(suggestion: CaptureSuggestion) {
    suggestion = mask(suggestion) as CaptureSuggestion;
    if (suggestions.has(suggestion.id)) return suggestions.get(suggestion.id)!;
    const sourceIds = sourceEvidenceIds(suggestion);
    if (sourceIds.size > 0) {
      const duplicate = [...suggestions.values()].find((candidate) => candidate.id !== suggestion.id && intersects(sourceIds, sourceEvidenceIds(candidate)));
      if (duplicate) return duplicate;
    }
    const actors = suggestion.actors.memberIds;
    const cards = new Map<string, Awaited<ReturnType<KnowledgeService["list"]>>[number]>();
    for (const memberId of actors) for (const card of await options.knowledge.list({ memberId, displayName: options.memberName(memberId) }, {})) {
      cards.set(card.id, card);
    }
    const cardSourceIds = (card: Awaited<ReturnType<KnowledgeService["list"]>>[number]) => {
      if (card.provenance?.trigger?.type === "agent.proposed") {
        const source = suggestions.get(card.provenance.trigger.suggestionId ?? "");
        return source ? sourceEvidenceIds(source) : new Set<string>();
      }
      return new Set([
        ...(card.provenance?.evidenceRefs.runIds ?? []).map((runId) => `run:${runId}`),
        ...(card.provenance?.evidenceRefs.chatMessageIds ?? []).map((messageId) => `message:${messageId}`),
        ...(card.provenance?.evidenceRefs.traceRefs ?? []).map((ref) => `trace:${ref.runId}:${ref.seq}`)
      ]);
    };
    const matchingCard = [...cards.values()].find((card) => intersects(sourceIds, cardSourceIds(card)));
    if (matchingCard) suggestion.dedupe = { cardId: matchingCard.id, score: 1 };
    if (!actors.length) for (const card of await options.knowledge.list({ memberId: "filesystem", displayName: "filesystem" }, { scope: "team" })) cards.set(card.id, card);
    const results = await searchKnowledgeCards({ cards: [...cards.values()], workspaceId: options.projectId, indexDir: path.join(root, "index"), query: `${suggestion.suggestedSummary ?? ""}\n${JSON.stringify(suggestion.evidence).slice(0, 6000)}`, filters: { statuses: ["reviewed"] }, topK: 1 });
    const best = results[0];
    if (best && best.score >= riskWarningConfig.dedupeThreshold) suggestion.dedupe = { cardId: best.cardId, score: Math.min(1, best.score) };
    suggestions.set(suggestion.id, suggestion);
    await save(suggestion);
    options.events.append({ type: "knowledge_suggestion_created", roomId: options.roomId, payload: { suggestionId: suggestion.id, trigger: suggestion.triggerType, actors } });
    for (const actor of actors) notify(actor, { type: "knowledge_suggestion", suggestionId: suggestion.id }, suggestion.createdAt);
    return suggestion;
  }

  function sourceEvidenceIds(suggestion: CaptureSuggestion) {
    const ids = new Set<string>();
    if (suggestion.triggerType === "agent.proposed") {
      const draft = suggestion.evidence.draft as Pick<ImportedDraft, "type" | "title" | "summary" | "content" | "files"> | undefined;
      if (draft) {
        const source = JSON.stringify([suggestion.actors.runIds[0], draft.type, draft.title, draft.summary, draft.content, [...new Set(draft.files)].sort()]);
        ids.add(`proposal:${crypto.createHash("sha256").update(source).digest("hex")}`);
      }
      return ids;
    }
    for (const runId of suggestion.actors.runIds) ids.add(`run:${runId}`);
    for (const key of ["runId", "previousRunId", "suggestionId"] as const) if (typeof suggestion.evidence[key] === "string") ids.add(`${key}:${suggestion.evidence[key]}`);
    const traceRefs = suggestion.evidence.traceRefs;
    if (Array.isArray(traceRefs)) for (const ref of traceRefs) {
      if (!ref || typeof ref !== "object" || typeof (ref as { runId?: unknown }).runId !== "string" || !Number.isInteger((ref as { seq?: unknown }).seq)) continue;
      ids.add(`trace:${(ref as { runId: string }).runId}:${(ref as { seq: number }).seq}`);
    }
    const messages = suggestion.evidence.chatMessages;
    if (Array.isArray(messages)) for (const message of messages) if (message && typeof message === "object" && typeof (message as { messageId?: unknown }).messageId === "string") ids.add(`message:${(message as { messageId: string }).messageId}`);
    return ids;
  }
  function intersects(left: Set<string>, right: Set<string>) { for (const value of left) if (right.has(value)) return true; return false; }
  async function save(suggestion: CaptureSuggestion) {
    if (!isCaptureSuggestion(suggestion)) throw new Error("Invalid knowledge suggestion");
    await writeJsonFileAtomically(path.join(inbox, `${suggestion.id}.json`), suggestion);
  }
  function notify(memberId: string, message: Extract<ServerMessage, { type: "knowledge_suggestion" | "knowledge_risk_warning" }>, at: number) {
    if (message.type === "knowledge_suggestion") {
      const suggestion = suggestions.get(message.suggestionId);
      if (!suggestion || suggestion.state && suggestion.state !== "open" || suggestion.seenBy?.includes(memberId)) return;
    }
    if (message.type === "knowledge_risk_warning" && options.events.list().some(event => event.type === "knowledge_warning_read" && event.memberId === memberId && event.payload?.warningId === message.warningId)) return;
    const decision = policy.decide(memberId, at);
    options.onNotify(memberId, { ...message, popup: decision === "popup" });
    options.events.append({ type: "knowledge_notification", roomId: options.roomId, memberId, payload: { ...message, decision } });
    if (decision === "deferred") clock.schedule(clock.now() + policy.config.idleMs, () => { enqueue(async () => notify(memberId, message, clock.now())); });
    schedule();
  }
  async function warn(checkpoint: CaptureCheckpoint) {
    if (!riskWarningConfig.files.some(pattern => minimatch(checkpoint.file, pattern, { dot: true }))) return;
    const fileKey = `${checkpoint.actor}:${checkpoint.file}`;
    if (checkpoint.at - (riskFiles.get(fileKey) ?? -Infinity) < riskWarningConfig.cooldownMs) return;
    const cards = await options.knowledge.list({ memberId: checkpoint.actor, displayName: options.memberName(checkpoint.actor) }, { status: "reviewed" });
    const diff = changedSnippet(checkpoint.before, checkpoint.after);
    const hits = await searchKnowledgeCards({ cards, workspaceId: options.projectId, indexDir: path.join(root, "index"), query: `${checkpoint.file}\n${diff.before}\n${diff.after}`, activeFile: checkpoint.file, viewerMemberId: checkpoint.actor, filters: { statuses: ["reviewed"], types: ["risk", "negative", "constraint"] }, topK: 3 });
    const best = hits.find(hit => hit.score >= (hit.mode === "vector" ? riskWarningConfig.vectorThreshold : riskWarningConfig.lexicalThreshold));
    if (!best || checkpoint.at - (riskCards.get(`${checkpoint.actor}:${best.cardId}`) ?? -Infinity) < riskWarningConfig.cooldownMs) return;
    riskFiles.set(fileKey, checkpoint.at); riskCards.set(`${checkpoint.actor}:${best.cardId}`, checkpoint.at);
    notify(checkpoint.actor, { type: "knowledge_risk_warning", cardId: best.cardId, file: checkpoint.file, warningId: crypto.randomUUID() }, checkpoint.at);
  }
  async function withSuggestion<T>(id: string, operation: (suggestion: CaptureSuggestion) => Promise<T>): Promise<T> {
    await awaitIdle();
    const suggestion = suggestions.get(id);
    if (!suggestion) throw Object.assign(new Error("Knowledge suggestion not found"), { statusCode: 404 });
    if (resolving.has(id) || suggestion.state && suggestion.state !== "open" && suggestion.state !== "disputed") throw Object.assign(new Error("Knowledge suggestion is being processed or has already been resolved"), { statusCode: 409 });
    resolving.add(id);
    const pending = operation(suggestion);
    activeResolutions.add(pending);
    try { return await pending; }
    finally { resolving.delete(id); activeResolutions.delete(pending); }
  }
  async function resolve(actor: KnowledgeActor, suggestion: CaptureSuggestion, action: "accepted" | "discarded" | "merged") {
    suggestion.state = action; suggestion.resolvedAt = Date.now(); suggestion.resolvedBy = actor.memberId;
    await save(suggestion);
    options.events.append({ type: "knowledge_suggestion_resolved", roomId: options.roomId, memberId: actor.memberId, payload: { suggestionId: suggestion.id, action } });
    for (const memberId of suggestion.actors.memberIds) options.onNotify(memberId, { type: "knowledge_suggestion", suggestionId: suggestion.id, popup: false });
  }
  async function awaitIdle() { await ready; let pending; do { pending = operations; await pending; } while (pending !== operations); }
  async function generateDraft(suggestion: CaptureSuggestion, ai: boolean) {
    if (ai && suggestion.origin === "human-agent") {
      const correctionId = suggestion.actors.runIds[1];
      const correction = correctionId ? agentRunChanges.get(correctionId) : undefined;
      if (!suggestion.evidence.correctionFiles && correction) {
        const previous = agentRunChanges.get(suggestion.actors.runIds[0]!) ?? [];
        suggestion.evidence.correctionFiles = correction.flatMap(change => {
          const beforeText = previous.find(item => item.file === change.file)?.afterText ?? change.beforeText;
          return typeof beforeText === "string" && typeof change.afterText === "string" ? [{file: change.file, beforeText, afterText: change.afterText}] : [];
        });
      }
      suggestion.evidence = mask(await enrichRecapEvidence(suggestion.evidence, options.workspaceRoot)) as Record<string, unknown>;
    }
    if (suggestion.origin === "preset" || suggestion.origin === "agent-self") {
      const stored = suggestion.evidence.draft as ImportedDraft;
      if (!stored || typeof stored.content !== "string") throw new Error("Prepared knowledge draft is unavailable");
      return { draft: { type: stored.type, title: stored.title, summary: stored.summary, content: stored.content, tags: [suggestion.origin], appliesTo: stored.files.length ? { kind: "glob" as const, patterns: stored.files } : { kind: "project" as const } }, fallback: false };
    }
    const started = Date.now();
    const usage: LlmUsage = {};
    const promptHashes: string[] = [];
    const client = ai && options.llm?.apiKey ? createOpenAICompatibleClient(options.llm) : undefined;
    let llmProvider: string | undefined = options.llm?.provider;
    let llmModel = options.llm?.model;
    let completed = false;
    let fallback = !client;
  let mode = "extract";
    let checkValidation: unknown;
    try {
      if (ai && suggestion.origin === "human-agent" && ["agent.interrupted", "agent.revised", "agent.corrected"].includes(suggestion.triggerType)) {
        mode = "recap";
        if (await recapMode?.() === "agent-self") {
          mode = "agent-self";
          fallback = false;
          if (!agentSelfRecap) throw new Error("Agent self recap is unavailable");
          let selfResult: Awaited<ReturnType<NonNullable<CaptureServiceOptions["agentSelfRecap"]>>>;
          try {
            selfResult = await agentSelfRecap(suggestion);
          } catch (error) {
            const recapError = error as { promptHash?: unknown; provider?: unknown; model?: unknown; usage?: unknown };
            if (typeof recapError.promptHash === "string") promptHashes.push(recapError.promptHash);
            if (typeof recapError.provider === "string") llmProvider = recapError.provider;
            if (typeof recapError.model === "string") llmModel = recapError.model;
            if (recapError.usage && typeof recapError.usage === "object") addLlmUsage(usage, recapError.usage as LlmUsage);
            throw error;
          }
          llmProvider = selfResult.provider ?? llmProvider;
          llmModel = selfResult.model ?? llmModel;
          if (selfResult.promptHash) promptHashes.push(selfResult.promptHash);
          addLlmUsage(usage, selfResult.usage);
          const parsed = parseAgentRecapDraft(selfResult.text, suggestion.evidence);
          if (!parsed) throw new Error("Agent self recap returned invalid JSON");
          checkValidation = parsed.checkValidation;
          completed = true;
          fallback = false;
          return { draft: { type: parsed.type, title: parsed.title, summary: parsed.summary, content: [`## 发生了什么`, parsed.whatHappened, `## 纠正`, parsed.correction, `## 规则`, parsed.rule, `## 适用范围`, [...parsed.appliesTo.files, ...parsed.appliesTo.globs, ...parsed.appliesTo.taskKinds].join(", ") || "当前任务", `## 不适用的情况`, parsed.notApplicable, ...parsed.unknowns].join("\n\n"), tags: [suggestion.triggerType, "agent"], confidence: parsed.confidence, evidenceCitations: parsed.evidenceCitations, unknowns: parsed.unknowns, ...recapCardFields(parsed), fallback: false }, fallback: false };
        }
        const recap = await extractAgentRecapDraft(suggestion.evidence, {
          model: llmModel ?? "deterministic",
          client: client ? { async complete(request) {
            promptHashes.push(crypto.createHash("sha256").update(JSON.stringify(request.messages)).digest("hex"));
            const result = await client.complete(request);
            addLlmUsage(usage, result.usage);
            return result;
          } } : undefined,
          onFallback() { fallback = true; }, language: recapLanguage
        });
        completed = true;
        checkValidation = recap.draft.checkValidation;
        return { draft: { type: recap.draft.type, title: recap.draft.title, summary: recap.draft.summary, content: [`## 发生了什么`, recap.draft.whatHappened, `## 纠正`, recap.draft.correction, `## 规则`, recap.draft.rule, `## 适用范围`, [...recap.draft.appliesTo.files, ...recap.draft.appliesTo.globs, ...recap.draft.appliesTo.taskKinds].join(", ") || "当前任务", `## 不适用的情况`, recap.draft.notApplicable, ...recap.draft.unknowns].join("\n\n"), tags: [suggestion.triggerType, "agent"], confidence: recap.draft.confidence, evidenceCitations: recap.draft.evidenceCitations, unknowns: recap.draft.unknowns, ...recapCardFields(recap.draft) }, fallback: recap.fallback };
      }
      const draft = await extractKnowledgeCardDraft({
        triggerType: suggestion.triggerType, suggestedType: suggestion.suggestedType,
        suggestedTitle: suggestion.suggestedTitle, suggestedSummary: suggestion.suggestedSummary,
        anchors: suggestion.suggestedAnchors, evidence: suggestion.evidence
      }, {
        model: llmModel ?? "deterministic", maxAttempts: 3, onFallback() { fallback = true; },
        client: client ? { async complete(request) {
          promptHashes.push(crypto.createHash("sha256").update(JSON.stringify(request.messages)).digest("hex"));
          const result = await client.complete(request);
          addLlmUsage(usage, result.usage);
          return result;
        } } : undefined
      });
      completed = true;
      return { draft, fallback };
    } finally {
      if (ai) {
        suggestion.ai = { provider: llmProvider, model: llmModel, durationMs: Date.now() - started, totalTokens: usage.totalTokens, fallback };
        await fs.appendFile(path.join(root, "llm-calls.jsonl"), JSON.stringify({ suggestionId: suggestion.id, at: started, mode, provider: llmProvider, ...suggestion.ai, completed, usage, attempts: promptHashes.length, promptHashes, checkValidation }) + "\n", { mode: 0o600 });
        await save(suggestion);
      }
    }
  }
  return {
    ready, feed, attribution,
    setRiskWarningConfig(config: Partial<RiskWarningConfig>) { riskWarningConfig = { ...riskWarningConfig, ...config, files: config.files ?? riskWarningConfig.files }; },
    setRecapLanguage(language: "zh" | "en") { recapLanguage = language; },
    bindAgentSelfRecap(callback: (suggestion: CaptureSuggestion) => Promise<AgentSelfRecapResult>, getMode?: () => Promise<"server" | "agent-self">) { agentSelfRecap = callback; recapMode = getMode ?? recapMode; },
    async getAgentRunChanges(runId: string) { await awaitIdle(); return agentRunChanges.get(runId) ?? []; },
    async agentRun(event: Omit<CaptureAgentRunEvent, "type" | "schemaVersion" | "seq" | "at">) {
      await feed({ type: "agentRun", ...event });
      if (["end", "failed", "cancelled", "interrupted"].includes(event.action)) {
        for (const file of new Set((event.fileChanges ?? []).map((change) => change.file))) {
          await options.knowledge.refreshExpired({ memberId: event.memberId, displayName: options.memberName(event.memberId) }, file);
        }
      }
    },
    async agentTool(event: Omit<CaptureAgentToolEvent, "type" | "schemaVersion" | "seq" | "at">) { await feed({ type: "agentTool", ...event }); },
    registerAgentWrite(file: string, runId: string, ownerId: string, ranges: Array<{ start: number; end: number; text: string }>, at = Date.now()) { engine.authorship.register(file, `agent:${runId}`, ranges.map((range) => ({ ...range, ownerId })), at); },
    async list(memberId: string, all = false) { await awaitIdle(); return [...suggestions.values()].filter(item => (!item.state || item.state === "open" || item.state === "disputed") && (all || item.actors.memberIds.includes(memberId))).sort((a, b) => b.createdAt - a.createdAt); },
    async listWarnings(actor: KnowledgeActor) {
      await awaitIdle(); await options.events.awaitIdle();
      const records = options.events.list().filter(event => event.memberId === actor.memberId);
      const seen = new Set(records.filter(event => event.type === "knowledge_warning_read").map(event => event.payload?.warningId));
      const warnings = new Map<string, KnowledgeRiskWarning>();
      for (const event of records) {
        const payload = event.payload;
        if (event.type !== "knowledge_notification" || payload?.type !== "knowledge_risk_warning" || typeof payload.warningId !== "string" || typeof payload.cardId !== "string" || typeof payload.file !== "string") continue;
        if (warnings.has(payload.warningId)) continue;
        const card = await options.knowledge.get(actor, payload.cardId);
        if (!card || card.status !== "reviewed") continue;
        warnings.set(payload.warningId, { id: payload.warningId, cardId: payload.cardId, file: payload.file, createdAt: Date.parse(event.timestamp), seen: seen.has(payload.warningId) });
      }
      return [...warnings.values()].sort((a, b) => b.createdAt - a.createdAt);
    },
    async markWarningsRead(memberId: string, ids: string[]) {
      await awaitIdle(); await options.events.awaitIdle();
      const records = options.events.list().filter(event => event.memberId === memberId);
      for (const id of new Set(ids)) {
        if (!records.some(event => event.type === "knowledge_notification" && event.payload?.warningId === id) || records.some(event => event.type === "knowledge_warning_read" && event.payload?.warningId === id)) continue;
        options.events.append({ type: "knowledge_warning_read", roomId: options.roomId, memberId, payload: { warningId: id } });
      }
      options.onNotify(memberId, { type: "knowledge_suggestion", suggestionId: "", popup: false });
    },
    async markRead(memberId: string, ids: string[]) {
      await awaitIdle();
      for (const id of ids) {
        const suggestion = suggestions.get(id);
        if (!suggestion || suggestion.seenBy?.includes(memberId)) continue;
        suggestion.seenBy = [...(suggestion.seenBy ?? []), memberId];
        await save(suggestion);
      }
      options.onNotify(memberId, { type: "knowledge_suggestion", suggestionId: ids[0] ?? "", popup: false });
    },
    async external(change: WorkspaceChange) {
      await ready;
      if (!capturePath(change.path)) return;
      if (change.type === "unlink" || change.type === "unlinkDir") {
        const affectedFiles = [...texts.keys()].filter(file => file === change.path || file.startsWith(`${change.path}/`));
        for (const file of affectedFiles) {
          await feed({ type: "fileExternal", file, change: "unlink", textBefore: texts.get(file) });
          texts.delete(file);
          await options.knowledge.refreshExpired({ memberId: "filesystem", displayName: "filesystem" }, file);
        }
        if (change.type === "unlink") await options.knowledge.refreshExpired({ memberId: "filesystem", displayName: "filesystem" }, change.path);
        return;
      }
      if (["add", "change"].includes(change.type)) {
        const result = await readWorkspaceFile(options.workspaceRoot, change.path);
        if (result.status !== "text") return;
        const before = texts.get(change.path) ?? "";
        if (before === result.content) return;
        const hasDocument = Boolean(await options.documents.getPreparedDocument(`${options.projectId}|${options.roomId}:${change.path}`));
        await feed({ type: "fileExternal", file: change.path, change: change.type as "add" | "change", textBefore: before, textAfter: result.content, hasDocument });
        texts.set(change.path, result.content);
      }
    },
    cursor(input: Extract<EventInput, { type: "cursor" }>) {
      const previous = cursorTimers.get(input.memberId);
      if (previous) { previous.input = input; return; }
      const entry = { input: input as EventInput, timer: setTimeout(() => { cursorTimers.delete(input.memberId); void feed(entry.input); }, 200) };
      cursorTimers.set(input.memberId, entry);
    },
    async discard(actor: KnowledgeActor, id: string) { return withSuggestion(id, suggestion => resolve(actor, suggestion, "discarded")); },
    async accept(actor: KnowledgeActor, id: string, ai = false) {
      return withSuggestion(id, async suggestion => {
        const { draft, fallback } = await generateDraft(suggestion, ai);
        const authorId = typeof suggestion.evidence.editor === "string" ? suggestion.evidence.editor : typeof suggestion.evidence.primaryActor === "string" ? suggestion.evidence.primaryActor : suggestion.actors.memberIds[0] ?? actor.memberId;
        const traceRefs = Array.isArray(suggestion.evidence.traceRefs)
          ? suggestion.evidence.traceRefs.filter((ref): ref is { runId: string; seq: number } => Boolean(ref) && typeof ref === "object" && typeof (ref as { runId?: unknown }).runId === "string" && Number.isInteger((ref as { seq?: unknown }).seq)).map((ref) => ({ runId: ref.runId, seq: ref.seq }))
          : [];
        const recapFallback = fallback && suggestion.origin === "human-agent" && ["agent.interrupted", "agent.revised", "agent.corrected"].includes(suggestion.triggerType);
        const anchors = (suggestion.origin === "preset" ? suggestion.suggestedAnchors ?? [] : []).flatMap((anchor) => "startLine" in anchor && typeof anchor.file === "string" ? [{ file: anchor.file, startLine: anchor.startLine, endLine: anchor.endLine }] : []);
        const card = await options.knowledge.createDraft(actor, { ...draft, ...(anchors.length ? { anchors } : {}), fallback: recapFallback, source: suggestion.origin === "agent-self" || ai && !fallback ? "ai" : "event", scope: suggestion.origin === "human-agent" || suggestion.origin === "agent-self" ? "personal" : "team", provenance: { origin: suggestion.origin, author: suggestion.origin === "agent-self" ? { kind: "agent", memberId: authorId, displayName: `${options.memberName(authorId)} Agent`, agentRunId: suggestion.actors.runIds[0] } : { kind: "human", memberId: authorId, displayName: options.memberName(authorId) }, trigger: { type: suggestion.triggerType, suggestionId: id }, evidenceRefs: { runIds: suggestion.actors.runIds, chatMessageIds: Array.isArray(suggestion.evidence.chatMessages) ? (suggestion.evidence.chatMessages as CaptureChatEvent[]).map(message => message.messageId) : [], ...(traceRefs.length ? { traceRefs } : {}), files: typeof suggestion.evidence.file === "string" ? [{ path: suggestion.evidence.file, revision: String(suggestion.evidence.revisionAfter ?? "") }] : [] } } });
        suggestion.draftCardId = card.id;
        await resolve(actor, suggestion, "accepted");
        return { card, suggestion };
      });
    },
    async merge(actor: KnowledgeActor, id: string, cardId: string) {
      return withSuggestion(id, async suggestion => {
        const card = await options.knowledge.recordRecurrence(actor, cardId, id);
        await resolve(actor, suggestion, "merged");
        return { card, suggestion };
      });
    },
    async dispute(actor: KnowledgeActor, id: string, reason: string) {
      return withSuggestion(id, async (suggestion) => {
        if (!suggestion.actors.memberIds.includes(actor.memberId)) throw new Error("Only suggestion participants can dispute it");
        suggestion.state = "disputed";
        suggestion.evidence = { ...suggestion.evidence, dispute: { memberId: actor.memberId, reason: reason.trim().slice(0, 2000) } };
        await save(suggestion);
        options.events.append({ type: "knowledge_suggestion_disputed", roomId: options.roomId, memberId: actor.memberId, payload: { suggestionId: id } });
        return suggestion;
      });
    },
    async fromChat(actor: KnowledgeActor, messageIds: string[]) {
      const messages = (await options.chat.listMessages(options.roomId)).filter(message => messageIds.includes(message.id) && (message.kind ?? "member") === "member").map(message => ({ schemaVersion: 1 as const, type: "chat" as const, seq: message.sequence, at: Date.parse(message.timestamp), messageId: message.id, authorId: message.authorId, kind: "member" as const, text: message.text }));
      if (!messages.length) throw new Error("Select member chat messages");
      await awaitIdle();
      const at = Math.max(Date.now(), clock.now());
      const counts = new Map<string, number>();
      for (const message of messages) counts.set(message.authorId, (counts.get(message.authorId) ?? 0) + 1);
      const primaryActor = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]![0];
      const suggestion: CaptureSuggestion = { id: crypto.randomUUID(), triggerType: "chat.dense", createdAt: at, origin: "human-human", state: "open", actors: { memberIds: [...new Set([actor.memberId, ...messages.map(message => message.authorId)])], runIds: [] }, suggestedType: "context", suggestedTitle: "选定的协作讨论", suggestedSummary: messages.map(message => message.text).join("\n").slice(0, 400), evidence: { chatMessages: messages, primaryActor }, suggestedAnchors: engine.infer(messages, at) };
      return storeSuggestion(suggestion);
    },
    async importPreset(actor: KnowledgeActor, input: ImportedDraft & { file: string; sourceText: string }) {
      await awaitIdle();
      const suggestion: CaptureSuggestion = { id: crypto.randomUUID(), triggerType: "preset.imported", createdAt: Date.now(), origin: "preset", state: "open", actors: { memberIds: [actor.memberId], runIds: [] }, suggestedType: input.type, suggestedTitle: input.title, suggestedSummary: input.summary, suggestedAnchors: [{ file: input.file, startLine: input.startLine, endLine: input.endLine, score: 1, reasons: ["规范文档原文"] }], evidence: { file: input.file, lineRange: { start: input.startLine, end: input.endLine }, sourceText: input.sourceText, draft: input, fallback: input.fallback } };
      return enqueue(() => storeSuggestion(suggestion));
    },
    async propose(actor: KnowledgeActor, runId: string, input: Pick<ImportedDraft, "title" | "summary" | "content" | "type" | "files">) {
      await awaitIdle();
      return enqueue(() => storeSuggestion({ id: crypto.randomUUID(), triggerType: "agent.proposed", createdAt: Date.now(), origin: "agent-self", state: "open", actors: { memberIds: [actor.memberId], runIds: [runId] }, suggestedType: input.type, suggestedTitle: input.title, suggestedSummary: input.summary, evidence: { runId, draft: input } }));
    },
    async fromEpisode(suggestion: CaptureSuggestion) {
      if (!isCaptureSuggestion(suggestion) || suggestion.evidence.captureBypassed !== true || !["agent.revised", "agent.corrected"].includes(suggestion.triggerType)) throw new Error("A correction episode is required");
      await awaitIdle();
      return enqueue(async () => {
        const existing = [...suggestions.values()].find(item => item.actors.runIds.includes(suggestion.actors.runIds[0]!) && ["agent.revised", "agent.corrected", "agent.interrupted"].includes(item.triggerType));
        if (existing) {
          if (existing.state === "accepted" && existing.draftCardId && existing.evidence.captureBypassed === true) return existing;
          if (existing.state && !["open", "disputed"].includes(existing.state)) throw new Error("Correction episode has already been reviewed");
          const naturallyTriggered = existing.evidence.captureBypassed === true ? existing.evidence.naturallyTriggered === true : true;
          const naturalEvidence = existing.evidence.captureBypassed === true ? existing.evidence.naturalEvidence : existing.evidence;
          const merged = mask({...suggestion, id: existing.id, state: existing.state, evidence: {...existing.evidence, ...suggestion.evidence, naturallyTriggered, ...(naturalEvidence ? {naturalEvidence} : {})}}) as CaptureSuggestion;
          suggestions.set(merged.id, merged); await save(merged); return merged;
        }
        return storeSuggestion(suggestion);
      });
    },
    async get(id: string) { await awaitIdle(); return suggestions.get(id); },
    awaitIdle,
    async dispose() {
      disposed = true; if (timer) clearTimeout(timer);
      for (const entry of cursorTimers.values()) clearTimeout(entry.timer);
      cursorTimers.clear(); attribution.dispose(); removeChat(); engine.dispose(); await awaitIdle(); await Promise.all(activeResolutions);
    }
  };
}
export type CaptureService = ReturnType<typeof createCaptureService>;
