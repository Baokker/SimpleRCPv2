import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { minimatch } from "minimatch";
import diff from "fast-diff";
import {
  VirtualCaptureClock, NotificationPolicy, createCaptureEngine, createOpenAICompatibleClient,
  extractKnowledgeCardDraft, isCaptureEvent, isCaptureSuggestion, searchKnowledgeCards, changedSnippet, applyCaptureOps,
  type CaptureEvent, type CaptureSuggestion, type CaptureChatEvent, type CaptureConfigInput,
  type CaptureCheckpoint, type LlmUsage
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

type EventInput<T = CaptureEvent> = T extends CaptureEvent ? Omit<T, "seq" | "at" | "schemaVersion"> : never;
export interface CaptureServiceOptions {
  metadataRoot: string; workspaceRoot: string; knowledge: KnowledgeService; documents: CollaborativeDocumentStore;
  chat: ChatStore; events: EventLog; roomId: string; projectId: string; recordEvents?: boolean;
  config?: CaptureConfigInput; llm?: { apiKey?: string; baseUrl: string; model: string };
  onNotify(memberId: string, message: ServerMessage): void;
  memberName(memberId: string): string;
}
export const riskWarningConfig = {
  files: ["**/package.json", "**/tsconfig*.json", "**/vite.config.*", "**/.eslintrc*", "**/Dockerfile", "**/docker-compose*.yml", ".github/workflows/*"],
  lexicalThreshold: 1, vectorThreshold: 0.8, cooldownMs: 300_000, dedupeThreshold: 0.8
};
export interface KnowledgeRiskWarning { id: string; cardId: string; file: string; createdAt: number; seen: boolean; }

export function createCaptureService(options: CaptureServiceOptions) {
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
  const engine = createCaptureEngine({ clock, config: options.config,
    onSuggestion(suggestion) { if (!recovering) enqueue(() => storeSuggestion(suggestion)); },
    onCheckpoint(checkpoint) { if (!recovering) enqueue(() => warn(checkpoint)); }
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
    if (previousConfig !== undefined && JSON.stringify(previousConfig) !== JSON.stringify(engine.config)) throw new Error("Recorded capture configuration differs from this runtime");
    await writeJsonFileAtomically(configPath, engine.config);
    try {
      const recording = await fs.readFile(eventFile, "utf8");
      for (const line of recording.split("\n").filter(Boolean)) {
        const event: unknown = JSON.parse(line);
        if (!isCaptureEvent(event)) throw new Error("Invalid recorded capture event");
        if (event.seq <= seq) throw new Error("Recorded capture sequence must increase");
        clock.advanceTo(event.at); engine.process(event); seq = event.seq;
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
    if (typeof value === "string") return options.llm?.apiKey ? value.split(options.llm.apiKey).join("*".repeat(options.llm.apiKey.length)) : value;
    if (Array.isArray(value)) return value.map(mask);
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, mask(item)]));
    return value;
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
    const actors = suggestion.actors.memberIds;
    const cards = new Map<string, Awaited<ReturnType<KnowledgeService["list"]>>[number]>();
    for (const memberId of actors) for (const card of await options.knowledge.list({ memberId, displayName: options.memberName(memberId) }, { status: "reviewed" })) {
      if (card.scope === "personal" || card.scope === "proposedTeam") { if (actors.length !== 1) continue; }
      cards.set(card.id, card);
    }
    if (!actors.length) for (const card of await options.knowledge.list({ memberId: "filesystem", displayName: "filesystem" }, { status: "reviewed", scope: "team" })) cards.set(card.id, card);
    const results = await searchKnowledgeCards({ cards: [...cards.values()], workspaceId: options.projectId, indexDir: path.join(root, "index"), query: `${suggestion.suggestedSummary ?? ""}\n${JSON.stringify(suggestion.evidence).slice(0, 6000)}`, filters: { statuses: ["reviewed"] }, topK: 1 });
    const best = results[0];
    if (best && best.score >= riskWarningConfig.dedupeThreshold) suggestion.dedupe = { cardId: best.cardId, score: Math.min(1, best.score) };
    suggestions.set(suggestion.id, suggestion);
    await save(suggestion);
    options.events.append({ type: "knowledge_suggestion_created", roomId: options.roomId, payload: { suggestionId: suggestion.id, trigger: suggestion.triggerType, actors } });
    for (const actor of actors) notify(actor, { type: "knowledge_suggestion", suggestionId: suggestion.id }, suggestion.createdAt);
    return suggestion;
  }
  async function save(suggestion: CaptureSuggestion) { await writeJsonFileAtomically(path.join(inbox, `${suggestion.id}.json`), suggestion); }
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
    if (resolving.has(id) || suggestion.state && suggestion.state !== "open") throw Object.assign(new Error("Knowledge suggestion is being processed or has already been resolved"), { statusCode: 409 });
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
    const started = Date.now();
    const usage: LlmUsage = {};
    const promptHashes: string[] = [];
    const client = ai && options.llm?.apiKey ? createOpenAICompatibleClient(options.llm) : undefined;
    let completed = false;
    let fallback = !client;
    try {
      const draft = await extractKnowledgeCardDraft({
        triggerType: suggestion.triggerType, suggestedType: suggestion.suggestedType,
        suggestedTitle: suggestion.suggestedTitle, suggestedSummary: suggestion.suggestedSummary,
        anchors: suggestion.suggestedAnchors, evidence: suggestion.evidence
      }, {
        model: options.llm?.model ?? "deterministic", maxAttempts: 3, onFallback() { fallback = true; },
        client: client ? { async complete(request) {
          promptHashes.push(crypto.createHash("sha256").update(JSON.stringify(request.messages)).digest("hex"));
          const result = await client.complete(request);
          for (const key of ["promptTokens", "completionTokens", "totalTokens"] as const) if (result.usage?.[key] !== undefined) usage[key] = (usage[key] ?? 0) + result.usage[key]!;
          return result;
        } } : undefined
      });
      completed = true;
      return { draft, fallback };
    } finally {
      if (ai) {
        suggestion.ai = { model: options.llm?.model, durationMs: Date.now() - started, totalTokens: usage.totalTokens, fallback };
        await fs.appendFile(path.join(root, "llm-calls.jsonl"), JSON.stringify({ suggestionId: suggestion.id, at: started, ...suggestion.ai, completed, usage, attempts: promptHashes.length, promptHashes }) + "\n", { mode: 0o600 });
        await save(suggestion);
      }
    }
  }
  return {
    ready, feed, attribution,
    async list(memberId: string, all = false) { await awaitIdle(); return [...suggestions.values()].filter(item => (!item.state || item.state === "open") && (all || item.actors.memberIds.includes(memberId))).sort((a, b) => b.createdAt - a.createdAt); },
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
        for (const file of [...texts.keys()].filter(file => file === change.path || file.startsWith(`${change.path}/`))) {
          await feed({ type: "fileExternal", file, change: "unlink", textBefore: texts.get(file) });
          texts.delete(file);
        }
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
        const card = await options.knowledge.createDraft(actor, { ...draft, source: ai && !fallback ? "ai" : "event", provenance: { origin: "human-human", author: { kind: "human", memberId: authorId, displayName: options.memberName(authorId) }, trigger: { type: suggestion.triggerType, suggestionId: id }, evidenceRefs: { chatMessageIds: Array.isArray(suggestion.evidence.chatMessages) ? (suggestion.evidence.chatMessages as CaptureChatEvent[]).map(message => message.messageId) : [], files: typeof suggestion.evidence.file === "string" ? [{ path: suggestion.evidence.file, revision: String(suggestion.evidence.revisionAfter ?? "") }] : [] } } });
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
