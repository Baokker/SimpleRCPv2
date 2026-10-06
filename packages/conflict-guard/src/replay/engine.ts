import { createHash } from "node:crypto";
import type { ActorRef, ConflictGuardEvent, EditBatch, FileChange, TextEditOp } from "../model/types.js";
import { createSemanticIndex } from "../semantic/index.js";
import { SemanticChangeTracker, type CandidatePair } from "../routing/candidates.js";
import type { PairRecord } from "../coordination/pairState.js";
import { createSessionCoordinator, type FrozenRegion } from "../coordination/session.js";
import { ConflictGuardTracker, type ConflictGuardClock } from "../tracking/tracker.js";
import type { TraceEvent } from "../trace/trace.js";
import type { ZoneVerdict } from "../routing/classifier.js";
import { MemoryFileProvider } from "./files.js";
import { VirtualClock } from "./clock.js";
import { policyFor, type ActiveFileChange, type ZoningPolicy } from "./policies.js";
import { textDiffOps } from "../tracking/textDiff.js";
import { innermostSymbols, parseSymbols } from "../semantic/symbols.js";

export interface ReplayOptions {
  policy: ZoningPolicy | ZoningPolicy["id"];
  oracleTruth?: "allow" | "warn" | "lock";
  seed?: number;
  idleMs?: number;
  cursorLeaveLines?: number;
  maxBatchDurationMs?: number;
  activeIdleMs?: number;
  initialFiles?: Record<string, string>;
  libs?: Record<string, string>;
  endAt?: number;
}

export interface ReplayJudgement {
  pairId: string;
  revision: number;
  at: number;
  triggerAt: number;
  verdict: ZoneVerdict;
  pair: CandidatePair;
}

export interface ReplayResult {
  policy: ZoningPolicy["id"];
  seed: number;
  events: TraceEvent[];
  judgements: ReplayJudgement[];
  coordinationEvents: Array<Record<string, unknown> & { at: number; type: string }>;
  timeoutSimulation: "recorded" | "unavailable";
  pairs: Array<{ id: string; records: PairRecord[]; final?: PairRecord }>;
  freezeIntervals: Array<{ pairId: string; symbol: string; file: string; actor: ActorRef; startOffset: number; endOffset: number; start: number; end?: number }>;
  gateIntervals: Array<{ file: string; start: number; end?: number; reason: string }>;
  blockedEdits: Array<{ seq: number; at: number; file: string; actor: ActorRef; shouldHaveBeenBlocked: boolean }>;
  finalTexts: Record<string, string>;
  endedAt: number;
  errors: Array<{ at: number; pairId: string; message: string }>;
  semanticRelations: number;
  persisted: Array<{ at: number; file: string; text: string; counterfactual: boolean }>;
  persistBlockedCount: number;
  finalDecision: "allow" | "warn" | "lock";
}

export function replayTrace(events: TraceEvent[], options: ReplayOptions): ReplayResult {
  if (events.some((event) => event.redacted || event.skipped === "sensitive")) throw new Error("脱敏轨迹不能执行语义回放");
  const clock = new VirtualClock(events[0]?.at ?? 0);
  const files = new MemoryFileProvider(options.initialFiles, options.libs);
  const config = (events.find((event) => event.type === "session_start")?.config ?? {}) as ReplayOptions;
  const trackerClock: ConflictGuardClock = { now: () => clock.now(), setTimeout: (callback, delay) => clock.setTimeout(callback, delay), clearTimeout: (handle) => clock.clearTimeout(handle) };
  let batchCount = 0;
  const tracker = new ConflictGuardTracker({ clock: trackerClock, idleMs: options.idleMs ?? config.idleMs ?? 1500, cursorLeaveLines: options.cursorLeaveLines ?? config.cursorLeaveLines ?? 3, maxBatchDurationMs: options.maxBatchDurationMs ?? config.maxBatchDurationMs ?? 5000, activeIdleMs: options.activeIdleMs ?? config.activeIdleMs ?? 600000, createId: () => `replay-batch-${++batchCount}` });
  const index = createSemanticIndex({ files, now: () => clock.now() });
  const semantic = new SemanticChangeTracker({ index, readFile: (file) => files.readFile(file), now: () => clock.now() });
  const policy = typeof options.policy === "string" ? policyFor(options.policy, { oracleTruth: options.oracleTruth }) : options.policy;
  const intervene = policy.id !== "P0" && !(policy.id === "P3" && events.find((event) => event.type === "session_start")?.mode === "observe");
  const judgements: ReplayJudgement[] = [];
  const coordinationEvents: ReplayResult["coordinationEvents"] = [];
  const recordMap = new Map<string, PairRecord[]>();
  const freezeIntervals: ReplayResult["freezeIntervals"] = [];
  const gateIntervals: ReplayResult["gateIntervals"] = [];
  const blockedEdits: ReplayResult["blockedEdits"] = [];
  const errors: ReplayResult["errors"] = [];
  const openGates = new Map<string, { start: number; reason: string }>();
  const persisted: ReplayResult["persisted"] = [];
  const persistTimers = new Map<string, unknown>();
  const dirtyFiles = new Set<string>();
  const counterfactualFiles = new Set<string>();
  const changedFiles = new Set<string>();
  const currentText = new Map<string, string>();
  const owners = new Map<string, { actor: ActorRef; file: string; symbol: string }>();
  const actors = [...new Map(events.filter((event) => event.type === "edit" && (event.origin as ActorRef).kind === "human").map((event) => { const actor = event.origin as ActorRef; return [actorKey(actor), actor] as const; })).values()];
  const semanticRelations = new Set<string>();
  let judgementBatches: Array<{ batch: EditBatch; symbols: string[] }> = [];
  let persistBlockedCount = 0;
  let updateTimer: unknown;
  let candidatePairs: CandidatePair[] = [];
  const closedBatches: Array<{ batch: EditBatch; change?: FileChange }> = [];
  const recordedChecks = events.filter((event) => event.type === "pair_judged" && (event.verdict as ZoneVerdict | undefined)?.typecheck);
  const session = createSessionCoordinator({ tracker, semantic, index, now: () => clock.now(), intervene, enableT0: policy.id === "P3", enableSemanticPending: policy.id !== "P1", onError(error, pairId) { errors.push({ at: clock.now(), pairId, message: error instanceof Error ? error.message : String(error) }); }, classify(pair) {
    const revision = session.coordinator.get(pair.id)?.revision ?? 0;
    const recorded = recordedChecks.find((event) => event.pairId === pair.id && event.revision === revision);
    const recordedCheck = (recorded?.verdict as ZoneVerdict | undefined)?.typecheck;
    const project = recordedCheck && !recordedCheck.ran && recordedCheck.skipped ? { ...index, checkFourStates: () => ({ ...recordedCheck }) } : index;
    return policy.decide({ pair, activeFiles: activeFiles(), project, symbols: (side) => session.symbolFor(side.actor, side.symbol) });
  }, onEvent(event) {
    coordinationEvents.push(event as ReplayResult["coordinationEvents"][number]);
    if (event.type === "freeze" && !["P1", "P2"].includes(policy.id)) updateFreezeIntervals(event.regions as FrozenRegion[]);
    if (event.type === "persist_gate") updateGate(String(event.file), Boolean(event.allowed), String(event.reason ?? ""));
  } });
  const coordinator = session.coordinator;
  coordinator.onEvent((event) => {
    const list = recordMap.get(event.record.pair.id) ?? [];
    list.push(cloneRecord(event.record));
    recordMap.set(event.record.pair.id, list);
    if (event.type === "pair_judged" && event.record.verdict) {
      const keys = [event.record.pair.left.symbol, event.record.pair.right.symbol].map((key) => key.slice(0, key.indexOf("#")));
      const batchTriggers = judgementBatches.filter(({ batch, symbols }) => [event.record.pair.left, event.record.pair.right].some((side) => {
        if (actorKey(batch.actor) !== actorKey(side.actor) || !side.symbol.startsWith(`${batch.file}#`)) return false;
        return side.symbol === `${batch.file}#file` || symbols.some((key) => key === side.symbol || key.startsWith(`${side.symbol}.`) || side.symbol.startsWith(`${key}.`));
      })).map(({ batch }) => batch.endedAt);
      const pendingTriggers = keys.flatMap((file) => {
        const gate = openGates.get(file);
        return gate?.reason === "pending-judgement" ? [gate.start] : [];
      });
      const triggers = batchTriggers.length > 0 ? batchTriggers : pendingTriggers;
      const triggerAt = triggers.length > 0 ? Math.max(...triggers) : clock.now();
      judgements.push({ pairId: event.record.pair.id, revision: event.record.revision, at: clock.now(), triggerAt, verdict: event.record.verdict, pair: event.record.pair });
    }
  });
  tracker.onEvent((event: ConflictGuardEvent) => {
    if (event.type === "batch_opened") session.batchOpened(event.batch);
    if (event.type === "batch_closed") {
      session.batchClosed(event.batch);
      closedBatches.push({ batch: event.batch, change: tracker.getActiveChangeSets().find((set) => actorKey(set.actor) === actorKey(event.batch.actor))?.files.get(event.batch.file) });
      scheduleRefresh();
    }
    if (event.type === "change_set_file_closed" || event.type === "change_set_closed") scheduleRefresh();
  });
  function scheduleRefresh() {
    if (updateTimer !== undefined) return;
    updateTimer = clock.setTimeout(() => { updateTimer = undefined; refresh(); }, 25);
  }
  function refresh() {
    try {
      if (changedFiles.size > 0) {
        semantic.captureStaleEdges(tracker.getActiveChangeSets());
        index.update([...changedFiles]);
        changedFiles.clear();
      }
      const batches = closedBatches.splice(0);
      judgementBatches = batches.map(({ batch }) => {
        const symbols = [...parseSymbols(batch.file, batch.textBefore), ...parseSymbols(batch.file, batch.textAfter)];
        return { batch, symbols: [...new Set(batch.ranges.flatMap((range) => innermostSymbols(symbols, range.start, range.end)).map((symbol) => symbol.key))] };
      });
      session.refresh(batches, (pairs) => {
        for (const pair of pairs) semanticRelations.add(pair.id);
        candidatePairs = policy.id === "P1" ? sameFilePairs() : pairs;
        return candidatePairs;
      });
      refreshOwners();
    } catch (error) {
      errors.push({ at: clock.now(), pairId: "", message: error instanceof Error ? error.message : String(error) });
    } finally {
      judgementBatches = [];
    }
  }
  for (const event of [...events].sort((left, right) => left.seq - right.seq)) {
    clock.advanceTo(Math.max(clock.now(), event.at));
    if (event.type === "doc_open") {
      const file = String(event.file);
      if (!currentText.has(file)) { const text = String(event.text ?? ""); files.open(file, text); currentText.set(file, text); tracker.openDocument(file, text); changedFiles.add(file); scheduleRefresh(); }
    }
    if (event.type === "edit") {
      const file = String(event.file);
      const before = currentText.get(file) ?? files.readFile(file);
      const ops = event.ops as TextEditOp[];
      const origin = event.origin as ActorRef;
      if (policy.id === "P2" && changedFiles.size > 0) {
        semantic.captureStaleEdges(tracker.getActiveChangeSets());
        index.update([...changedFiles]);
        changedFiles.clear();
      }
      const prelocked = ["P1", "P2"].includes(policy.id);
      const shouldBlock = prelocked ? isPrelocked(file, origin, ops) : isFrozen(file, origin, ops);
      if (shouldBlock) counterfactualFiles.add(file);
      blockedEdits.push({ seq: event.seq, at: clock.now(), file, actor: origin, shouldHaveBeenBlocked: shouldBlock });
      const after = applyOps(before, ops);
      currentText.set(file, after); files.set(file, after); changedFiles.add(file);
      tracker.edit({ file, origin, at: event.at, ops, revisionAfter: Number(event.revisionAfter ?? 0), textBefore: before, textAfter: after });
      session.edit(file, ops, origin.kind === "human");
      if (!shouldBlock) recordPrelock(file, origin, ops);
      scheduleRefresh();
      if (origin.kind !== "filesystem") {
        dirtyFiles.add(file);
        clock.clearTimeout(persistTimers.get(file));
        persistTimers.set(file, clock.setTimeout(() => persist(file), 300));
      }
    }
    if (event.type === "cursor") {
      const position = event.position as { lineNumber: number; column: number };
      tracker.cursorChanged({ actor: { kind: "human", memberId: String(event.memberId) }, file: String(event.file), lineNumber: position.lineNumber, column: position.column, at: event.at });
    }
    if (event.type === "doc_retired") { tracker.retireFile(String(event.file)); files.remove(String(event.file)); currentText.delete(String(event.file)); changedFiles.add(String(event.file)); scheduleRefresh(); }
    if (event.type === "mirror_resync") {
      const file = String(event.file); const before = currentText.get(file) ?? ""; const after = String(event.text);
      if (before !== after) {
        const ops = textDiffOps(before, after);
        files.set(file, after); currentText.set(file, after); changedFiles.add(file);
        tracker.edit({ file, origin: { kind: "filesystem" }, at: event.at, ops, revisionAfter: 0, textBefore: before, textAfter: after });
        session.edit(file, ops, false); scheduleRefresh();
      }
    }
    if (event.type === "ui_action") {
      if (event.action === "change_set_done") { tracker.markDone({ kind: "human", memberId: String(event.memberId) }); refresh(); }
      else if (["revert_pair", "confirm_pair", "chat_pair"].includes(String(event.action))) {
        const pairId = String(event.pairId); const record = coordinator.get(pairId);
        if (!record) { errors.push({ at: clock.now(), pairId, message: "ui_action 没有对应变更对" }); continue; }
        if (event.action === "revert_pair") {
          coordinator.requestResolution(pairId, "reverted");
          const side = [record.pair.left, record.pair.right].find((side) => actorKey(side.actor) === `human:${event.memberId}`);
          if (side) tracker.closeMemberFile(side.actor as Extract<ActorRef, { kind: "human" }>, side.symbol.slice(0, side.symbol.indexOf("#")));
          refresh();
        }
        if (event.action === "confirm_pair") coordinator.confirm(pairId, actorKey(record.pair.left.actor) === `human:${event.memberId}` ? "left" : "right");
      }
    }
  }
  clock.advanceTo(options.endAt ?? clock.now() + (options.idleMs ?? config.idleMs ?? 1500) + 25);
  for (const [file, gate] of openGates) gateIntervals.push({ file, start: gate.start, end: clock.now(), reason: gate.reason });
  for (const interval of freezeIntervals) if (interval.end === undefined) interval.end = clock.now();
  const pairs = [...recordMap].sort(([left], [right]) => left.localeCompare(right)).map(([id, records]) => ({ id, records, final: records.at(-1) }));
  const decisions = pairs.flatMap((pair) => pair.final?.verdict ? [pair.final.verdict.decision] : []);
  return { policy: policy.id, seed: options.seed ?? 0, events, judgements, coordinationEvents, timeoutSimulation: recordedChecks.length > 0 ? "recorded" : "unavailable", pairs, freezeIntervals, gateIntervals, blockedEdits, endedAt: clock.now(), errors, semanticRelations: semanticRelations.size, persisted, persistBlockedCount, finalDecision: decisions.includes("lock") ? "lock" : decisions.includes("warn") ? "warn" : "allow", finalTexts: Object.fromEntries([...currentText].sort(([left], [right]) => left.localeCompare(right))) };

  function persist(file: string) {
    persistTimers.delete(file);
    if (!session.gate(file).allowed) { persistTimers.set(file, clock.setTimeout(() => persist(file), 300)); return; }
    if (!dirtyFiles.delete(file)) return;
    const text = files.readFile(file);
    persisted.push({ at: clock.now(), file, text, counterfactual: counterfactualFiles.has(file) });
    coordinationEvents.push({ type: "persist", at: clock.now(), file, textHash: createHash("sha256").update(text).digest("hex") });
  }
  function updateGate(file: string, allowed: boolean, reason: string) {
    const previous = openGates.get(file);
    if (!allowed && !previous) { openGates.set(file, { start: clock.now(), reason }); persistBlockedCount += 1; }
    if (!allowed && previous && previous.reason !== reason) { gateIntervals.push({ file, start: previous.start, end: clock.now(), reason: previous.reason }); openGates.set(file, { start: clock.now(), reason }); }
    if (allowed && previous) { gateIntervals.push({ file, start: previous.start, end: clock.now(), reason: previous.reason }); openGates.delete(file); persist(file); }
  }
  function updateFreezeIntervals(regions: FrozenRegion[]) {
    for (const interval of freezeIntervals.filter((interval) => interval.end === undefined)) {
      const region = regions.find((region) => region.pairId === interval.pairId && region.symbol === interval.symbol && actorKey(region.actor) === actorKey(interval.actor));
      if (!region) interval.end = clock.now(); else { interval.startOffset = region.start; interval.endOffset = region.end; }
    }
    for (const region of regions) if (!freezeIntervals.some((interval) => interval.end === undefined && interval.pairId === region.pairId && interval.symbol === region.symbol && actorKey(interval.actor) === actorKey(region.actor))) freezeIntervals.push({ pairId: region.pairId, symbol: region.symbol, file: region.file, actor: region.actor, startOffset: region.start, endOffset: region.end, start: clock.now() });
  }
  function isFrozen(file: string, actor: ActorRef, ops: TextEditOp[]) { return actor.kind === "human" && session.regions().some((region) => region.file === file && ops.some((op) => op.from < region.end && op.from + op.deleted.length >= region.start)); }
  function isPrelocked(file: string, actor: ActorRef, ops: TextEditOp[]) {
    if (actor.kind !== "human" || !["P1", "P2"].includes(policy.id)) return false;
    const keys = ops.flatMap((op) => index.symbolsInRange(file, op.from, op.from + Math.max(op.deleted.length, 1)).map((symbol) => symbol.key));
    return [...owners.values()].some((owner) => actorKey(owner.actor) !== actorKey(actor) && (policy.id === "P1" ? owner.file === file : semantic.findPaths(keys, [owner.symbol], 2).length > 0));
  }
  function recordPrelock(file: string, actor: ActorRef, ops: TextEditOp[]) {
    if (actor.kind !== "human" || !["P1", "P2"].includes(policy.id)) return;
    const symbols = policy.id === "P1" ? [`${file}#file`] : [...new Set(ops.flatMap((op) => index.symbolsInRange(file, op.from, op.from + Math.max(op.inserted.length, 1)).map((symbol) => symbol.key)))];
    for (const symbol of symbols) {
      const key = policy.id === "P1" ? file : symbol;
      if (owners.has(key)) continue;
      owners.set(key, { actor, file, symbol });
      const targets = policy.id === "P1" ? [{ key: `${file}#file`, file, start: 0, end: files.readFile(file).length }] : files.listFiles().flatMap((name) => index.symbolsInFile(name)).filter((entry) => semantic.findPaths([symbol], [entry.key], 2).length > 0);
      for (const target of targets) for (const other of actors.filter((other) => actorKey(other) !== actorKey(actor))) freezeIntervals.push({ pairId: `prelock:${key}`, actor: other, symbol: target.key, file: target.file, startOffset: target.start, endOffset: target.end, start: clock.now() });
    }
  }
  function refreshOwners() {
    for (const [key, owner] of owners) if (!tracker.getActiveChangeSets().some((set) => actorKey(set.actor) === actorKey(owner.actor) && set.files.has(owner.file))) {
      owners.delete(key);
      for (const interval of freezeIntervals) if (interval.pairId === `prelock:${key}` && interval.end === undefined) interval.end = clock.now();
    }
  }
  function activeFiles(): ActiveFileChange[] { return semantic.getActiveChangeSets().flatMap((set) => [...set.files.values()].map((file) => ({ actor: set.actor, file: file.file, symbols: file.symbols ?? [] }))); }
  function sameFilePairs() {
    const result = new Map<string, CandidatePair>(); const entries = activeFiles();
    for (let index = 0; index < entries.length; index += 1) for (const right of entries.slice(index + 1)) {
      const left = entries[index]!; if (left.file !== right.file || actorKey(left.actor) === actorKey(right.actor)) continue;
      const id = `p1:${left.file}:${[actorKey(left.actor), actorKey(right.actor)].sort().join(":")}`;
      const previous = candidatePairs.find((pair) => pair.id === id);
      result.set(id, { id, left: { actor: left.actor, symbol: `${left.file}#file`, status: "modified" }, right: { actor: right.actor, symbol: `${right.file}#file`, status: "modified" }, distance: 0, path: null, firstSeenAt: previous?.firstSeenAt ?? clock.now(), updatedAt: clock.now(), revisionKey: [...left.symbols, ...right.symbols].map((symbol) => symbol.before + symbol.after).join("|") });
    }
    return [...result.values()];
  }
}

function applyOps(text: string, ops: TextEditOp[]) {
  let result = text; let offset = 0;
  for (const op of ops) { const from = op.from + offset; if (result.slice(from, from + op.deleted.length) !== op.deleted) throw new Error(`回放编辑与文件文本不一致：${from}`); result = result.slice(0, from) + op.inserted + result.slice(from + op.deleted.length); offset += op.inserted.length - op.deleted.length; }
  return result;
}
function actorKey(actor: ActorRef) { return actor.kind === "human" ? `human:${actor.memberId}` : actor.kind === "agent" ? `agent:${actor.runId}` : actor.kind; }
function cloneRecord(record: PairRecord): PairRecord { return JSON.parse(JSON.stringify(record)) as PairRecord; }
