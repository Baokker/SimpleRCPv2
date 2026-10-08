import fs from "node:fs/promises";
import path from "node:path";
import { minimatch } from "minimatch";
import diff from "fast-diff";
import {
  searchRankedKnowledgeCards,
  cardMatchesFile,
  type KnowledgeCard,
  type KnowledgeCardStatus
} from "@simplercp/knowledge";
import type { AgentRun, AgentTraceEvent, ServerMessage } from "@simplercp/shared";
import type { EventLog } from "../eventLog.js";
import type { ProjectRecord } from "../projects.js";
import type { RoomMember } from "../types.js";
import type { KnowledgeService } from "./knowledgeService.js";
import { readJsonFile, writeJsonFileAtomically } from "../jsonFile.js";
import { isIgnoredPath } from "../workspacePolicy.js";
import { readWorkspaceFile } from "../workspace.js";
import { redactSensitive } from "../agent/traceStore.js";
import {selectKnowledgeInjection} from "./injection.js";

export {KNOWLEDGE_PROMPT_TITLE} from "./injection.js";

export interface KnowledgeInjectionRecord {
  id: string;
  version: number;
  contentHash: string;
  score: number;
  lexical: number;
  boost: number;
  reason: string;
  chars: number;
  title: string;
}

export interface KnowledgeProviderConfig {
  injectEnabled: boolean;
  toolEnabled: boolean;
  toolInstructionPlacement: "prompt" | "system";
  proposeEnabled: boolean;
  recapLanguage: "zh" | "en";
  topK: number;
  maxCharsPerCard: number;
  maxTotalChars: number;
  lexicalScoring: "legacy" | "exact-boost";
  ranking: "legacy" | "bounded";
  useActiveFiles: boolean;
  statuses: KnowledgeCardStatus[];
  fixedCardIds: string[];
  postRunCheck: boolean;
  inflightNotify: boolean;
  requireSecondConfirmForTeam: boolean;
  recapMode: "server" | "agent-self";
  orphanedAfterMs: number;
  riskWarning: KnowledgeRiskWarningConfig;
}

export interface KnowledgeRiskWarningConfig {
  files: string[];
  lexicalThreshold: number;
  vectorThreshold: number;
  cooldownMs: number;
  dedupeThreshold: number;
}

export const defaultKnowledgeProviderConfig: KnowledgeProviderConfig = {
  injectEnabled: true,
  toolEnabled: true,
  toolInstructionPlacement: "prompt",
  proposeEnabled: false,
  recapLanguage: "zh",
  topK: 5,
  maxCharsPerCard: 800,
  maxTotalChars: 4000,
  lexicalScoring: "legacy",
  ranking: "bounded",
  useActiveFiles: true,
  statuses: ["reviewed"],
  fixedCardIds: [],
  postRunCheck: true,
  inflightNotify: true,
  requireSecondConfirmForTeam: true,
  recapMode: "server",
  orphanedAfterMs: 7 * 24 * 60 * 60_000,
  riskWarning: {
    files: ["**/package.json", "**/tsconfig*.json", "**/vite.config.*", "**/.eslintrc*", "**/Dockerfile", "**/docker-compose*.yml", ".github/workflows/*"],
    lexicalThreshold: 1,
    vectorThreshold: 0.8,
    cooldownMs: 300_000,
    dedupeThreshold: 0.8
  }
};

export interface KnowledgeContextResult {
  section?: string;
  toolSection?: string;
  toolSystem?: string;
  candidates: Array<{ id: string; lexical: number; boost: number; score: number; filtered: boolean; reason: string }>;
  records: KnowledgeInjectionRecord[];
  activeFiles: string[];
  excludedByUser: string[];
  query: string;
  totalChars: number;
  estimatedInjectionTokens: number;
  config: KnowledgeProviderConfig;
  mode: string;
  reviewCards?: Array<{ id: string; title: string }>;
}

export interface KnowledgePostCheckHit {
  cardId: string;
  file: string;
  lines: { start: number; end: number };
  checkResult?: { passed: boolean; message: string };
}

export interface KnowledgePostCheckResult {
  hits: KnowledgePostCheckHit[];
}

interface ReuseMetric {
  cardId: string;
  knowledgeAt?: number;
  confirmedAt?: number;
  firstViewedByOtherAt?: number;
  firstInjectedByOtherAt?: number;
  firstToolHitByOtherAt?: number;
}

interface ProviderHooks {
  listRuns(projectId: string): Promise<AgentRun[]>;
  listTrace(projectId: string, runId: string): Promise<AgentTraceEvent[]>;
  appendTrace(projectId: string, runId: string, event: { type: string; summary?: string; data?: Record<string, unknown> }): Promise<void>;
  notify(memberId: string, message: ServerMessage): void;
  createSystemMessage(run: AgentRun, text: string): Promise<void>;
}

export interface KnowledgeProviderOptions {
  mode: "off" | "capture" | "inject" | "full";
  project: ProjectRecord;
  roomId: string;
  room: { members: RoomMember[] };
  knowledge: KnowledgeService;
  events: EventLog;
  metadataRoot: string;
  workspaceRoot: string;
  sensitiveValues?: string[];
  hooks?: ProviderHooks;
  onConfigUpdated?(config: KnowledgeProviderConfig): void;
}

export function createKnowledgeProvider(options: KnowledgeProviderOptions) {
  const root = path.join(options.metadataRoot, "knowledge");
  const configPath = path.join(root, "config.json");
  const metricsPath = path.join(root, "reuse-metrics.json");
  let config: KnowledgeProviderConfig = { ...defaultKnowledgeProviderConfig };
  let metrics = new Map<string, ReuseMetric>();
  let metricsWrite = Promise.resolve();
  let ready = false;
  let initialization: Promise<void> | undefined;
  let hooks = options.hooks;

  async function initialize() {
    if (ready) return;
    if (initialization) return initialization;
    initialization = initializeStorage();
    await initialization;
  }

  async function initializeStorage() {
    await fs.mkdir(root, { recursive: true, mode: 0o700 });
    const storedConfig = await readJsonFile<Partial<KnowledgeProviderConfig>>(configPath);
    if (storedConfig) config = normalizeConfig(storedConfig);
    await writeJsonFileAtomically(configPath, config);
    options.onConfigUpdated?.(config);
    const storedMetrics = await readJsonFile<ReuseMetric[]>(metricsPath);
    if (storedMetrics !== undefined) {
      if (!Array.isArray(storedMetrics)) throw new Error("Invalid knowledge reuse metrics");
      metrics = new Map(storedMetrics.map((metric) => [metric.cardId, metric]));
    }
    ready = true;
  }

  async function awaitReady() {
    if (!ready) await initialize();
  }

  function bind(nextHooks: ProviderHooks) {
    hooks = nextHooks;
  }

  async function getConfig() {
    await awaitReady();
    return { ...config, statuses: [...config.statuses], fixedCardIds: [...config.fixedCardIds], riskWarning: { ...config.riskWarning, files: [...config.riskWarning.files] } };
  }

  async function updateConfig(patch: Partial<KnowledgeProviderConfig>, actorMemberId?: string) {
    await awaitReady();
    config = normalizeConfig({ ...config, ...patch, ...(patch.riskWarning ? { riskWarning: { ...config.riskWarning, ...patch.riskWarning } } : {}) });
    await writeJsonFileAtomically(configPath, config);
    options.onConfigUpdated?.(config);
    options.events.append({ type: "knowledge_config_updated", roomId: options.roomId, memberId: actorMemberId, payload: { fields: Object.keys(patch) } });
    return getConfig();
  }

  async function buildContext(input: {
    project: ProjectRecord;
    run: AgentRun;
    initiator: RoomMember;
  }, buildOptions?: { recordUsage?: boolean }): Promise<KnowledgeContextResult> {
    await awaitReady();
    const recordUsage = buildOptions?.recordUsage ?? true;
    const query = [input.run.prompt, input.run.extraPrompt].filter(Boolean).join("\n\n").trim();
    const excludedByUser = input.run.knowledge?.excludeCardIds ?? [];
    const activeFiles = await collectActiveFiles(input.run, input.initiator);
    const toolSection = options.mode === "full" && config.toolEnabled
      ? `Project knowledge tools:\nknowledge_search searches confirmed team rules; knowledge_get reads a card in full. Before modifying code, query knowledge_search when project conventions or constraints are uncertain, then read relevant cards with knowledge_get. Pass workspace=${JSON.stringify(options.workspaceRoot)} to every knowledge tool call. These tools are available even when automatic knowledge injection is disabled.` : undefined;
    if (!isInjectionMode(options.mode) || !config.injectEnabled || input.run.knowledge?.disabled) {
      return { toolSection, toolSystem: config.toolInstructionPlacement === "system" ? toolSection : undefined, candidates: [], records: [], activeFiles, excludedByUser, query: redactKnowledgeText(query, options.sensitiveValues), totalChars: 0, estimatedInjectionTokens: 0, config: await getConfig(), mode: options.mode };
    }

    const visibleCards = await options.knowledge.list(
      { memberId: input.initiator.id, displayName: input.initiator.displayName },
      {}
    );
    const selection = await selectKnowledgeInjection({cards: visibleCards, viewerMemberId: input.initiator.id, query, activeFiles, config, excludedByUser, workspaceId: input.project.id, indexDir: path.join(root, "index"), sensitiveValues: options.sensitiveValues});
    const reviewCards = visibleCards.filter(card => ["needsReview", "orphaned"].includes(card.status) && (activeFiles.some(file => cardMatchesFile(card, file)) || selection.candidates.some(candidate => candidate.id === card.id))).map(card => ({ id: card.id, title: card.title }));
    const {records} = selection;
    const cardById = new Map(visibleCards.map(card => [card.id, card]));
    if (recordUsage) {
      for (const record of records) {
        const injectedAt = Date.now();
        await options.knowledge.recordInjection(record.id, input.initiator.id, injectedAt);
        const metric = metrics.get(record.id) ?? { cardId: record.id };
        const firstInjectionByOther = metric.firstInjectedByOtherAt === undefined;
        if (metric.firstInjectedByOtherAt === undefined) {
          const card = cardById.get(record.id);
          if (card && card.ownerMemberId !== input.initiator.id) metric.firstInjectedByOtherAt = injectedAt;
        }
        metrics.set(record.id, metric);
        options.events.append({
          type: "knowledge_reuse_injected",
          roomId: options.roomId,
          memberId: input.initiator.id,
          payload: { runId: input.run.id, cardId: record.id, ...(firstInjectionByOther && metric.firstInjectedByOtherAt !== undefined ? { firstInjectedByOtherAt: metric.firstInjectedByOtherAt } : {}) }
        });
      }
      await saveMetrics();
    }
    return { ...selection, reviewCards, toolSection, toolSystem: config.toolInstructionPlacement === "system" ? toolSection : undefined, activeFiles, excludedByUser, query: redactKnowledgeText(query, options.sensitiveValues), config: await getConfig(), mode: options.mode };
  }

  async function postRunCheck(run: AgentRun): Promise<KnowledgePostCheckResult> {
    await awaitReady();
    if (!isInjectionMode(options.mode) || !config.postRunCheck || !run.fileChanges?.length) return { hits: [] };
    const initiator = options.room.members.find((member) => member.id === (run.initiatorMemberId ?? run.memberId));
    if (!initiator) return { hits: [] };
    const cards = await options.knowledge.list({ memberId: initiator.id, displayName: initiator.displayName }, {});
    const candidates = cards.filter((card) => ["negative", "constraint", "risk"].includes(card.type) && (card.status === "reviewed" || (card.status === "needsReview" && card.check !== undefined)));
    const hits: KnowledgePostCheckHit[] = [];
    for (const change of run.fileChanges) {
      const lines = changedLines(change.patch, change.additions, change.deletions, change.beforeText, change.afterText);
      for (const lineRange of lines) for (const card of candidates) {
        const applies = card.appliesTo?.kind === "project" || (card.appliesTo?.kind === "glob" && card.appliesTo.patterns.some((pattern) => minimatch(change.file, pattern, { dot: true })));
        const resolution = (await options.knowledge.resolveAnchors({ memberId: initiator.id, displayName: initiator.displayName }, change.file)).find((item) => item.cardId === card.id && item.range && item.status !== "needsReview");
        const intersects = resolution?.range ? rangesIntersect(lineRange, { start: resolution.range.startLine, end: resolution.range.endLine }) : false;
        const checkMatchesFile = Boolean(card.check && minimatch(change.file, card.check.fileGlob, { dot: true }));
        if (!applies && !intersects && !checkMatchesFile) continue;
        let checkResult: KnowledgePostCheckHit["checkResult"];
        if (card.check && minimatch(change.file, card.check.fileGlob, { dot: true })) {
          const loaded = await readWorkspaceFile(options.workspaceRoot, change.file, true);
          if (loaded.status === "text") {
            const expression = new RegExp(card.check.pattern, card.check.flags);
            const present = expression.test(loaded.content);
            const passed = card.check.kind === "regex-present" ? present : !present;
            checkResult = { passed, message: passed ? "Check passed" : `Check failed: ${card.check.kind}` };
          }
        }
        hits.push({ cardId: card.id, file: change.file, lines: lineRange, ...(checkResult ? { checkResult } : {}) });
      }
    }
    for (const change of run.fileChanges) await options.knowledge.refreshExpired({ memberId: initiator.id, displayName: initiator.displayName }, change.file, config.orphanedAfterMs);
    return { hits };
  }

  async function onCardConfirmed(card: KnowledgeCard) {
    await awaitReady();
    if (!isInjectionMode(options.mode)) return;
    const confirmedAt = card.review?.confirmedAt ?? Date.now();
    const metric = metrics.get(card.id) ?? { cardId: card.id };
    metric.confirmedAt = confirmedAt;
    if (!metric.knowledgeAt) metric.knowledgeAt = findKnowledgeMoment(card);
    metrics.set(card.id, metric);
    options.events.append({
      type: "knowledge_reuse_confirmed",
      roomId: options.roomId,
      memberId: card.review?.confirmedBy.at(-1),
      payload: { cardId: card.id, knowledgeAt: metric.knowledgeAt, confirmedAt }
    });
    await saveMetrics();
    if (!config.inflightNotify || !hooks) return;
    const runs = await hooks.listRuns(options.project.id);
    const files = card.anchors.map((anchor) => anchor.file.workspaceRelativePath);
    for (const run of runs.filter((candidate) => candidate.status === "running")) {
      const trace = await hooks.listTrace(options.project.id, run.id);
      if (!runInitiatesCard(run, files, card, trace)) continue;
      const memberId = run.initiatorMemberId ?? run.memberId;
      if (card.scope !== "team" && card.ownerMemberId !== memberId) continue;
      const message: ServerMessage = { type: "knowledge_update_available", runId: run.id, cardId: card.id };
      hooks.notify(memberId, message);
      await hooks.appendTrace(options.project.id, run.id, { type: "knowledge_update_available", data: { cardId: card.id } });
      if (run.source === "chat") await hooks.createSystemMessage(run, `Knowledge card ${redactKnowledgeText(card.title, options.sensitiveValues)} is available for the next task.`);
    }
  }

  async function markViewed(cardId: string, viewerMemberId: string) {
    await awaitReady();
    const card = await options.knowledge.get({ memberId: viewerMemberId, displayName: viewerMemberId }, cardId);
    if (!card) return;
    const metric = metrics.get(cardId) ?? { cardId };
    if (card.ownerMemberId !== viewerMemberId && !metric.firstViewedByOtherAt) {
      metric.firstViewedByOtherAt = Date.now();
      options.events.append({ type: "knowledge_reuse_viewed", roomId: options.roomId, memberId: viewerMemberId, payload: { cardId, firstViewedByOtherAt: metric.firstViewedByOtherAt } });
    }
    metrics.set(cardId, metric);
    await saveMetrics();
  }

  async function reuseMetrics() {
    await awaitReady();
    return [...metrics.values()].sort((left, right) => left.cardId.localeCompare(right.cardId));
  }

  function findKnowledgeMoment(card: KnowledgeCard) {
    const suggestionId = card.provenance?.trigger?.suggestionId;
    if (suggestionId) {
      const event = options.events.list().find((candidate) => candidate.type === "knowledge_suggestion_created" && candidate.payload?.suggestionId === suggestionId);
      const timestamp = event ? Date.parse(event.timestamp) : Number.NaN;
      if (Number.isFinite(timestamp)) return timestamp;
    }
    return card.createdAt;
  }

  async function toolSearch(query: string, activeFiles: string[], limit = 5, types?: string[]) {
    await awaitReady();
    const member = options.room.members[0] ?? { id: "mcp", displayName: "MCP" };
    const cards = (await options.knowledge.list({ memberId: member.id, displayName: member.displayName }, { scope: "team", status: "reviewed" }))
      .filter((card) => !types?.length || types.includes(card.type));
    const results = (await searchRankedKnowledgeCards({ cards, workspaceId: options.project.id, indexDir: path.join(root, "index"), query, lexicalScoring: config.lexicalScoring, activeFiles, ranking: config.ranking, useActiveFiles: config.useActiveFiles, filters: { statuses: ["reviewed"] } })).slice(0, Math.min(10, Math.max(1, limit)));
    const cardById = new Map(cards.map((card) => [card.id, card]));
    return Promise.all(results.map(async (result) => {
      const card = cardById.get(result.cardId)!;
      const item = { id: card.id, type: card.type, title: card.title, summary: card.summary, anchors: await toolAnchors(card), score: result.score };
      return redactSensitive(item, options.sensitiveValues) as typeof item;
    }));
  }

  async function toolAnchors(card: KnowledgeCard) {
    const viewer = { memberId: "mcp", displayName: "MCP" };
    return Promise.all(card.anchors.map(async (anchor, index) => {
      const resolved = (await options.knowledge.resolveAnchors(viewer, anchor.file.workspaceRelativePath)).find((item) => item.cardId === card.id && item.anchorIndex === index);
      return { file: anchor.file.workspaceRelativePath, startLine: resolved?.range?.startLine, endLine: resolved?.range?.endLine, status: resolved?.status };
    }));
  }

  async function toolGet(id: string) {
    await awaitReady();
    const member = options.room.members[0] ?? { id: "mcp", displayName: "MCP" };
    const card = await options.knowledge.get({ memberId: member.id, displayName: member.displayName }, id);
    if (!card || card.scope !== "team" || card.status !== "reviewed") return undefined;
    const team = await options.knowledge.list({ memberId: member.id, displayName: member.displayName }, { scope: "team", status: "reviewed" });
    const relations = (card.relations ?? []).filter((relation) => team.some((other) => other.id === relation.cardId));
    const result = { ...card, anchors: await toolAnchors(card), relations, contradiction: relations.some((relation) => relation.kind === "contradicts") ? "这些知识互相矛盾，尚未裁决" : undefined };
    return redactSensitive(result, options.sensitiveValues) as typeof result;
  }

  async function recordToolCall(input: { tool: string; query?: string; files?: string[]; resultIds?: string[]; latencyMs: number; workspace: string; error?: string; startedAt?: number }) {
    await awaitReady();
    const activeRuns = hooks ? await hooks.listRuns(options.project.id) : [];
    const at = input.startedAt ?? Date.now();
    const running = knowledgeRunsAt(activeRuns, at);
    const association = running.length === 1 ? running[0]!.id : running.length > 1 ? "ambiguous" : undefined;
    if (input.resultIds?.length && input.tool !== "knowledge_propose") options.events.append({ type: "knowledge_tool_used", roomId: options.roomId, memberId: running.length === 1 ? running[0]!.initiatorMemberId ?? running[0]!.memberId : undefined, payload: { runId: association, cardIds: input.resultIds } });
    const call = redactSensitive({ at: input.startedAt ?? Date.now(), ...input, runId: association, ...(association === "ambiguous" ? { candidates: running.map((run) => run.id) } : {}) }, options.sensitiveValues) as Record<string, unknown>;
    await fs.appendFile(path.join(root, "tool-calls.jsonl"), `${JSON.stringify(call)}\n`, { encoding: "utf8", mode: 0o600 });
    if (input.tool !== "knowledge_propose") for (const id of input.resultIds ?? []) {
      const at = Number(call.at);
      const card = await options.knowledge.recordToolHit(id, at);
      if (card && running.length === 1 && card.ownerMemberId !== (running[0]!.initiatorMemberId ?? running[0]!.memberId)) {
        const metric = metrics.get(id) ?? { cardId: id };
        if (metric.firstToolHitByOtherAt === undefined) {
          metric.firstToolHitByOtherAt = at;
          options.events.append({ type: "knowledge_reuse_tool_hit", roomId: options.roomId, memberId: running[0]!.initiatorMemberId ?? running[0]!.memberId, payload: { cardId: id, runId: association, firstToolHitByOtherAt: at } });
          metrics.set(id, metric);
          await saveMetrics();
        }
      }
    }
    if (association && association !== "ambiguous") {
      await hooks?.appendTrace(options.project.id, association, { type: "knowledge_tool_call", data: { ...call, runId: association } });
    } else if (association === "ambiguous") {
      await Promise.all(running.map((run) => hooks?.appendTrace(options.project.id, run.id, { type: "knowledge_tool_call", data: { ...call, runId: "ambiguous", candidates: running.map((candidate) => candidate.id) } })));
    }
    return association;
  }

  return { mode: options.mode, initialize, awaitIdle: awaitReady, bind, getConfig, updateConfig, buildContext, postRunCheck, onCardConfirmed, markViewed, reuseMetrics, toolSearch, toolGet, recordToolCall };

  async function collectActiveFiles(run: AgentRun, initiator: RoomMember) {
    const files = new Set<string>();
    for (const context of run.contexts ?? []) files.add(context.path);
    if (config.useActiveFiles && initiator.currentFile) files.add(initiator.currentFile);
    const workspaceFiles = await collectFiles(options.workspaceRoot);
    const text = `${run.prompt}\n${run.extraPrompt ?? ""}`;
    for (const file of workspaceFiles) if (text.includes(file)) files.add(file);
    return [...files];
  }

  async function saveMetrics() {
    const next = metricsWrite.then(() => writeJsonFileAtomically(metricsPath, [...metrics.values()]));
    metricsWrite = next.then(() => undefined, () => undefined);
    await next;
  }
}

export function knowledgeRunsAt(runs: AgentRun[], at: number) {
  return runs.filter(run => run.startedAt && Date.parse(run.startedAt) <= at && (!run.finishedAt || Date.parse(run.finishedAt) >= at));
}

function normalizeConfig(value: Partial<KnowledgeProviderConfig>): KnowledgeProviderConfig {
  if (value.toolInstructionPlacement !== undefined && !["prompt", "system"].includes(value.toolInstructionPlacement)) throw new Error("Invalid tool instruction placement");
  const numberValue = (input: unknown, fallback: number, min: number, max: number) => typeof input === "number" && Number.isFinite(input) ? Math.max(min, Math.min(max, Math.floor(input))) : fallback;
  const allowedStatuses = new Set<KnowledgeCardStatus>(["draft", "reviewed", "needsReview", "archived", "orphaned", "superseded"]);
  if (value.statuses !== undefined && (!Array.isArray(value.statuses) || value.statuses.some((status) => !allowedStatuses.has(status as KnowledgeCardStatus)))) throw new Error("Knowledge statuses are invalid");
  const statuses = value.statuses as KnowledgeCardStatus[] | undefined ?? defaultKnowledgeProviderConfig.statuses;
  for (const key of ["injectEnabled", "toolEnabled", "proposeEnabled", "useActiveFiles", "postRunCheck", "inflightNotify", "requireSecondConfirmForTeam"] as const) if (value[key] !== undefined && typeof value[key] !== "boolean") throw new Error(`Knowledge ${key} must be boolean`);
  if (value.recapLanguage !== undefined && value.recapLanguage !== "zh" && value.recapLanguage !== "en") throw new Error("Knowledge recapLanguage is invalid");
  if (value.recapMode !== undefined && value.recapMode !== "server" && value.recapMode !== "agent-self") throw new Error("Knowledge recapMode is invalid");
  if (value.lexicalScoring !== undefined && value.lexicalScoring !== "legacy" && value.lexicalScoring !== "exact-boost") throw new Error("Knowledge lexical scoring is invalid");
  if (value.ranking !== undefined && value.ranking !== "legacy" && value.ranking !== "bounded") throw new Error("Knowledge ranking is invalid");
  return {
    injectEnabled: value.injectEnabled ?? defaultKnowledgeProviderConfig.injectEnabled,
    toolEnabled: value.toolEnabled ?? defaultKnowledgeProviderConfig.toolEnabled,
    toolInstructionPlacement: value.toolInstructionPlacement ?? defaultKnowledgeProviderConfig.toolInstructionPlacement,
    proposeEnabled: value.proposeEnabled ?? defaultKnowledgeProviderConfig.proposeEnabled,
    recapLanguage: value.recapLanguage ?? defaultKnowledgeProviderConfig.recapLanguage,
    topK: numberValue(value.topK, defaultKnowledgeProviderConfig.topK, 1, 25),
    maxCharsPerCard: numberValue(value.maxCharsPerCard, defaultKnowledgeProviderConfig.maxCharsPerCard, 1, 20_000),
    maxTotalChars: numberValue(value.maxTotalChars, defaultKnowledgeProviderConfig.maxTotalChars, 1, 100_000),
    lexicalScoring: value.lexicalScoring ?? defaultKnowledgeProviderConfig.lexicalScoring,
    ranking: value.ranking === "legacy" ? "legacy" : "bounded",
    useActiveFiles: value.useActiveFiles ?? defaultKnowledgeProviderConfig.useActiveFiles,
    statuses,
    fixedCardIds: Array.isArray(value.fixedCardIds) ? value.fixedCardIds.filter((id): id is string => typeof id === "string") : [],
    postRunCheck: value.postRunCheck ?? defaultKnowledgeProviderConfig.postRunCheck,
    inflightNotify: value.inflightNotify ?? defaultKnowledgeProviderConfig.inflightNotify,
    requireSecondConfirmForTeam: value.requireSecondConfirmForTeam ?? defaultKnowledgeProviderConfig.requireSecondConfirmForTeam,
    recapMode: value.recapMode ?? defaultKnowledgeProviderConfig.recapMode,
    orphanedAfterMs: numberValue(value.orphanedAfterMs, defaultKnowledgeProviderConfig.orphanedAfterMs, 1, 365 * 24 * 60 * 60_000),
    riskWarning: normalizeRiskWarningConfig(value.riskWarning)
  };
}

function normalizeRiskWarningConfig(value: unknown): KnowledgeRiskWarningConfig {
  const input = value && typeof value === "object" && !Array.isArray(value) ? value as Partial<KnowledgeRiskWarningConfig> : {};
  const files = input.files ?? defaultKnowledgeProviderConfig.riskWarning.files;
  if (!Array.isArray(files) || files.some((file) => typeof file !== "string" || !file)) throw new Error("Knowledge risk warning files are invalid");
  const numberValue = (candidate: unknown, fallback: number, min: number, max: number) => typeof candidate === "number" && Number.isFinite(candidate) ? Math.max(min, Math.min(max, candidate)) : fallback;
  return {
    files: [...files],
    lexicalThreshold: numberValue(input.lexicalThreshold, defaultKnowledgeProviderConfig.riskWarning.lexicalThreshold, 0, 100),
    vectorThreshold: numberValue(input.vectorThreshold, defaultKnowledgeProviderConfig.riskWarning.vectorThreshold, 0, 1),
    cooldownMs: numberValue(input.cooldownMs, defaultKnowledgeProviderConfig.riskWarning.cooldownMs, 0, 365 * 24 * 60 * 60_000),
    dedupeThreshold: numberValue(input.dedupeThreshold, defaultKnowledgeProviderConfig.riskWarning.dedupeThreshold, 0, 1)
  };
}

function changedLines(patch: string | undefined, additions: number, deletions: number, beforeText?: string, afterText?: string) {
  if (!patch && beforeText !== undefined && afterText !== undefined) {
    const ranges: Array<{ start: number; end: number }> = [];
    let afterOffset = 0;
    for (const [operation, value] of diff(beforeText, afterText)) {
      if (operation === diff.EQUAL) {
        afterOffset += value.length;
        continue;
      }
      const start = lineNumber(afterText, afterOffset);
      const end = lineNumber(afterText, operation === diff.INSERT ? afterOffset + value.length : afterOffset);
      ranges.push({ start, end });
      if (operation === diff.INSERT) afterOffset += value.length;
    }
    return mergeLineRanges(ranges);
  }
  if (!patch) return [{ start: 1, end: Math.max(1, additions + deletions) }];
  const matches = [...patch.matchAll(/^@@ [^\n]*? \+(\d+)(?:,(\d+))? @@/gm)];
  if (!matches.length) return [{ start: 1, end: Math.max(1, additions + deletions) }];
  const ranges = matches.map((match) => {
    const start = Math.max(1, Number(match[1] ?? 1));
    const count = Math.max(1, Number(match[2] ?? 1));
    return { start, end: start + count - 1 };
  });
  return ranges;
}
function lineNumber(text: string, offset: number) { return text.slice(0, Math.max(0, Math.min(offset, text.length))).split("\n").length; }
function mergeLineRanges(ranges: Array<{ start: number; end: number }>) {
  const merged: Array<{ start: number; end: number }> = [];
  for (const range of ranges.sort((left, right) => left.start - right.start)) {
    const previous = merged.at(-1);
    if (previous && range.start <= previous.end + 1) previous.end = Math.max(previous.end, range.end);
    else merged.push({ ...range });
  }
  return merged.length ? merged : [{ start: 1, end: 1 }];
}
function rangesIntersect(left: { start: number; end: number }, right: { start: number; end: number }) { return left.start <= right.end && right.start <= left.end; }
function runInitiatesCard(run: AgentRun, files: string[], card: KnowledgeCard, trace: AgentTraceEvent[]) {
  const text = `${run.prompt}\n${run.extraPrompt ?? ""}`;
  const changedFiles = new Set(run.fileChanges?.map((change) => change.file) ?? []);
  for (const event of trace) {
    if (event.type === "concurrent_change" && typeof event.data?.path === "string") changedFiles.add(event.data.path);
    if (event.type === "file_changes" && Array.isArray(event.data?.files)) {
      for (const file of event.data.files) {
        if (file && typeof file === "object" && typeof (file as { file?: unknown }).file === "string") changedFiles.add((file as { file: string }).file);
      }
    }
    if (event.type.startsWith("opencode.")) {
      const values = collectTraceStrings(event.data);
      for (const file of files) if (values.some((value) => value.includes(file))) changedFiles.add(file);
    }
  }
  if (files.some((file) => run.contexts?.some((context) => context.path === file) || changedFiles.has(file) || text.includes(file))) return true;
  if (card.appliesTo?.kind === "project") return true;
  const contextFiles = (run.contexts ?? []).map((context) => context.path);
  const candidateFiles = [...new Set([...files, ...changedFiles, ...contextFiles])];
  return card.appliesTo?.kind === "glob" && candidateFiles.some((file) => card.appliesTo?.kind === "glob" && card.appliesTo.patterns.some((pattern) => minimatch(file, pattern, { dot: true })));
}

function collectTraceStrings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(collectTraceStrings);
  if (value && typeof value === "object") return Object.values(value).flatMap(collectTraceStrings);
  return [];
}

function isInjectionMode(mode: KnowledgeProviderOptions["mode"]) {
  return mode === "inject" || mode === "full";
}

function redactKnowledgeText(value: string, sensitiveValues?: string[]) {
  return redactSensitive(value, sensitiveValues) as string;
}

async function collectFiles(root: string) {
  const files: string[] = [];
  async function visit(directory: string, relative: string) {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const child = relative ? path.posix.join(relative, entry.name) : entry.name;
      if (isIgnoredPath(child) || entry.isSymbolicLink()) continue;
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(absolute, child);
      else if (entry.isFile()) files.push(child);
    }
  }
  await visit(root, "");
  return files;
}

export type KnowledgeProvider = ReturnType<typeof createKnowledgeProvider>;
