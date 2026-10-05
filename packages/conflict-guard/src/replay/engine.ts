import type { ActorRef, ConflictGuardEvent, TextEditOp } from "../model/types.js";
import { createSemanticIndex } from "../semantic/index.js";
import type { CandidatePair } from "../routing/candidates.js";
import { SemanticChangeTracker } from "../routing/candidates.js";
import { createPairCoordinator, type PairRecord } from "../coordination/pairState.js";
import { ConflictGuardTracker, type ConflictGuardClock } from "../tracking/tracker.js";
import type { TraceEvent } from "../trace/trace.js";
import type { ZoneVerdict } from "../routing/classifier.js";
import { MemoryFileProvider } from "./files.js";
import { VirtualClock } from "./clock.js";
import { policyFor, type ActiveFileChange, type ZoningPolicy } from "./policies.js";
import { transformRanges } from "../tracking/rangeTransform.js";
import { textDiffOps } from "../tracking/textDiff.js";

export interface ReplayOptions {
  policy: ZoningPolicy | ZoningPolicy["id"];
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
  verdict: ZoneVerdict;
  pair: CandidatePair;
}

export interface ReplayResult {
  policy: ZoningPolicy["id"];
  seed: number;
  events: TraceEvent[];
  judgements: ReplayJudgement[];
  pairs: Array<{ id: string; records: PairRecord[]; final?: PairRecord }>;
  freezeIntervals: Array<{ pairId: string; symbol: string; file: string; actor: ActorRef; startOffset: number; endOffset: number; start: number; end?: number }>;
  gateIntervals: Array<{ file: string; start: number; end?: number; reason: string }>;
  blockedEdits: Array<{ seq: number; file: string; actor: ActorRef; shouldHaveBeenBlocked: boolean }>;
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
  const tracker = new ConflictGuardTracker({ clock: trackerClock, idleMs: options.idleMs ?? config.idleMs ?? 1_500, cursorLeaveLines: options.cursorLeaveLines ?? config.cursorLeaveLines ?? 3, maxBatchDurationMs: options.maxBatchDurationMs ?? config.maxBatchDurationMs ?? 5_000, activeIdleMs: options.activeIdleMs ?? config.activeIdleMs ?? 600_000, createId: (() => { let count = 0; return () => `replay-batch-${++count}`; })() });
  const index = createSemanticIndex({ files, now: () => clock.now() });
  const semantic = new SemanticChangeTracker({ index, readFile: (file) => files.readFile(file), now: () => clock.now() });
  const policy = typeof options.policy === "string" ? policyFor(options.policy) : options.policy;
  const judgements: ReplayJudgement[] = [];
  const recordMap = new Map<string, PairRecord[]>();
  const freezeIntervals: ReplayResult["freezeIntervals"] = [];
  const gateIntervals: ReplayResult["gateIntervals"] = [];
  const blockedEdits: ReplayResult["blockedEdits"] = [];
  const openGates = new Map<string, { start: number; reason: string }>();
  const persisted: ReplayResult["persisted"] = [];
  const persistTimers = new Map<string, unknown>();
  const dirtyFiles = new Set<string>();
  const counterfactualFiles = new Set<string>();
  const changedFiles = new Set<string>();
  let persistBlockedCount = 0;
  let currentText = new Map<string, string>();
  let candidatePairs: CandidatePair[] = [];
  const semanticRelations = new Set<string>();
  const errors: ReplayResult["errors"] = [];
  let degradedReason: string | undefined;
  const coordinator = createPairCoordinator({ now: () => clock.now(), classify: (pair) => {
    if (degradedReason) return errorVerdict();
    try { return policy.decide({ pair, activeFiles: activeFiles(), project: index, symbols: (side) => symbolFor(side.actor, side.symbol) }); }
    catch (error) {
      errors.push({ at: clock.now(), pairId: pair.id, message: error instanceof Error ? error.message : String(error) });
      return errorVerdict();
    }
  } });
  let updateTimer: unknown;
  const closedBatches: Array<{ batch: import("../model/types.js").EditBatch; change?: import("../model/types.js").FileChange }> = [];
  function scheduleRefresh() {
    if (updateTimer !== undefined) return;
    updateTimer = clock.setTimeout(() => {
      updateTimer = undefined;
      try {
        semantic.captureStaleEdges(tracker.getActiveChangeSets());
        index.update([...changedFiles]);
        changedFiles.clear();
        if (degradedReason) for (const pair of candidatePairs) coordinator.markChanged(pair.id);
        degradedReason = undefined;
        refresh(closedBatches.splice(0));
      } catch (error) {
        degradedReason = error instanceof Error ? error.message : String(error);
        errors.push({ at: clock.now(), pairId: "", message: degradedReason });
        for (const pair of candidatePairs) coordinator.markChanged(pair.id);
        coordinator.update(candidatePairs);
        updateFreezeIntervals(); updateGateIntervals();
      }
    }, 25);
  }

  const refresh = (batches: Array<{ batch: import("../model/types.js").EditBatch; change?: import("../model/types.js").FileChange }> = []) => {
    semantic.update(tracker.getActiveChangeSets(), batches);
    for (const pair of semantic.getCandidatePairs()) semanticRelations.add(pair.id);
    candidatePairs = policy.id === "P1" ? withSameFilePairs(semantic.getCandidatePairs()) : semantic.getCandidatePairs();
    coordinator.update(candidatePairs);
    updateFreezeIntervals();
    updateGateIntervals();
  };

  tracker.onEvent((event: ConflictGuardEvent) => {
    if (event.type === "batch_closed") {
      closedBatches.push({ batch: event.batch, change: tracker.getActiveChangeSets().find((set) => actorKey(set.actor) === actorKey(event.batch.actor))?.files.get(event.batch.file) });
      scheduleRefresh();
    } else if (event.type === "change_set_file_closed" || event.type === "change_set_closed") scheduleRefresh();
  });
  semantic.onEvent(() => undefined);
  coordinator.onEvent((event) => {
    const list = recordMap.get(event.record.pair.id) ?? [];
    list.push(cloneRecord(event.record));
    recordMap.set(event.record.pair.id, list);
    if (event.type === "pair_judged" && event.record.verdict) judgements.push({ pairId: event.record.pair.id, revision: event.record.revision, at: clock.now(), verdict: event.record.verdict, pair: event.record.pair });
  });

  const ordered = [...events].sort((left, right) => left.seq - right.seq);
  for (const event of ordered) {
    clock.advanceTo(Math.max(clock.now(), event.at));
    if (event.type === "doc_open") {
      if (event.skipped === "sensitive") continue;
      const file = String(event.file);
      const text = String(event.text ?? "");
      files.open(file, text);
      changedFiles.add(file);
      currentText.set(file, text);
      tracker.openDocument(file, text);
      scheduleRefresh();
      continue;
    }
    if (event.type === "edit") {
      const file = String(event.file);
      const before = currentText.get(file) ?? files.readFile(file);
      const ops = event.ops as TextEditOp[];
      const after = applyOps(before, ops);
      const origin = event.origin as ActorRef;
      const shouldBlock = isFrozen(file, origin, ops, index, freezeIntervals, clock.now());
      if (shouldBlock) counterfactualFiles.add(file);
      blockedEdits.push({ seq: event.seq, file, actor: origin, shouldHaveBeenBlocked: shouldBlock });
      currentText.set(file, after);
      files.set(file, after);
      changedFiles.add(file);
      tracker.edit({ file, origin, at: event.at, ops, revisionAfter: Number(event.revisionAfter ?? 0), textBefore: before, textAfter: after });
      for (const region of freezeIntervals.filter((region) => region.file === file && region.end === undefined)) {
        const range = transformRanges([{ start: region.startOffset, end: region.endOffset }], ops)[0];
        if (range) { region.startOffset = range.start; region.endOffset = range.end; }
      }
      if (origin.kind === "filesystem" || origin.kind === "guard-revert") scheduleRefresh();
      updateGateIntervals();
      if (origin.kind !== "filesystem") {
        dirtyFiles.add(file);
        clock.clearTimeout(persistTimers.get(file));
        persistTimers.set(file, clock.setTimeout(() => persist(file), 300));
      }
      continue;
    }
    if (event.type === "cursor") {
      const position = event.position as { lineNumber: number; column: number };
      tracker.cursorChanged({ actor: { kind: "human", memberId: String(event.memberId) }, file: String(event.file), lineNumber: Number(position.lineNumber), column: Number(position.column), at: event.at });
    }
    if (event.type === "doc_retired") { tracker.retireFile(String(event.file)); files.remove(String(event.file)); currentText.delete(String(event.file)); changedFiles.add(String(event.file)); scheduleRefresh(); }
    if (event.type === "mirror_resync") {
      const file = String(event.file); const before = currentText.get(file) ?? ""; const after = String(event.text);
      if (before !== after) { tracker.edit({ file, origin: { kind: "filesystem" }, at: event.at, ops: textDiffOps(before, after), revisionAfter: 0, textBefore: before, textAfter: after }); files.set(file, after); currentText.set(file, after); changedFiles.add(file); scheduleRefresh(); }
    }
    if (event.type === "ui_action") {
      if (event.action === "change_set_done") tracker.markDone({ kind: "human", memberId: String(event.memberId) });
      if (event.action === "revert_pair") {
        coordinator.resolve(String(event.pairId), "reverted");
        updateFreezeIntervals(); updateGateIntervals();
      }
      if (event.action === "confirm_pair") {
        const record = coordinator.get(String(event.pairId));
        if (record) coordinator.confirm(record.pair.id, actorKey(record.pair.left.actor) === `human:${event.memberId}` ? "left" : "right");
        updateFreezeIntervals(); updateGateIntervals();
      }
    }
  }
  clock.advanceTo(options.endAt ?? clock.now() + (options.idleMs ?? config.idleMs ?? 1_500) + 25);
  for (const [file, gate] of openGates) gateIntervals.push({ file, start: gate.start, end: clock.now(), reason: gate.reason });
  for (const interval of freezeIntervals) if (interval.end === undefined) interval.end = clock.now();
  const pairs = [...recordMap.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([id, records]) => ({ id, records, final: records.at(-1) }));
  const decisions = pairs.flatMap((pair) => pair.final?.verdict ? [pair.final.verdict.decision] : []);
  const finalDecision = decisions.includes("lock") ? "lock" : decisions.includes("warn") ? "warn" : "allow";
  return { policy: policy.id, seed: options.seed ?? 0, events, judgements, pairs, freezeIntervals, gateIntervals, blockedEdits, endedAt: clock.now(), errors, semanticRelations: semanticRelations.size, persisted, persistBlockedCount, finalDecision, finalTexts: Object.fromEntries([...currentText.entries()].sort(([left], [right]) => left.localeCompare(right))) };

  function persist(file: string) {
    persistTimers.delete(file);
    if (openGates.has(file)) { persistBlockedCount += 1; return; }
    if (dirtyFiles.delete(file)) persisted.push({ at: clock.now(), file, text: files.readFile(file), counterfactual: counterfactualFiles.has(file) });
  }

  function errorVerdict(): ZoneVerdict {
    return { zone: "grey", decision: "warn", ruleId: "policy-error", summary: "判定计算失败，请共同检查修改。", evidence: [], contractChanged: { left: false, right: false } };
  }

  function activeFiles(): ActiveFileChange[] {
    return semantic.getActiveChangeSets().flatMap((set) => [...set.files.values()].map((file) => ({ actor: set.actor, file: file.file, symbols: file.symbols ?? [] })));
  }

  function symbolFor(actor: ActorRef, key: string) {
    return semantic.getActiveChangeSets().find((set) => actorKey(set.actor) === actorKey(actor))?.files && [...(semantic.getActiveChangeSets().find((set) => actorKey(set.actor) === actorKey(actor))?.files.values() ?? [])].flatMap((file) => file.symbols ?? []).find((symbol) => symbol.key === key);
  }

  function updateFreezeIntervals() {
    for (const pair of coordinator.records()) {
      const locked = pair.verdict?.decision === "lock" && pair.status === "judged";
      for (const side of [pair.pair.left, pair.pair.right]) {
        const key = side.symbol;
        const file = key.slice(0, key.indexOf("#"));
        const interval = freezeIntervals.find((item) => item.pairId === pair.pair.id && item.symbol === key && actorKey(item.actor) === actorKey(side.actor) && item.end === undefined);
        const symbol = index.symbolsInFile(file).find((item) => item.key === key) ?? (policy.id === "P1" ? { start: 0, end: files.readFile(file).length } : undefined);
        if (locked && !interval && symbol) freezeIntervals.push({ pairId: pair.pair.id, symbol: key, file, actor: side.actor, startOffset: symbol.start, endOffset: symbol.end, start: clock.now() });
        if (locked && interval && symbol) { interval.startOffset = symbol.start; interval.endOffset = symbol.end; }
        if (!locked && interval) interval.end = clock.now();
      }
    }
  }

  function withSameFilePairs(pairs: CandidatePair[]) {
    const result = new Map<string, CandidatePair>();
    const byFile = new Map<string, ActiveFileChange[]>();
    for (const file of activeFiles()) {
      const entries = byFile.get(file.file) ?? [];
      entries.push(file);
      byFile.set(file.file, entries);
    }
    for (const [file, entries] of byFile) {
      for (let index = 0; index < entries.length; index += 1) for (const right of entries.slice(index + 1)) {
        const left = entries[index]!;
        if (actorKey(left.actor) === actorKey(right.actor)) continue;
        const actors = [actorKey(left.actor), actorKey(right.actor)].sort();
        const id = `p1:${file}:${actors.join(":")}`;
        const previous = candidatePairs.find((pair) => pair.id === id);
        const updatedAt = Math.max(...left.symbols.map((symbol) => symbol.lastTouchedAt), ...right.symbols.map((symbol) => symbol.lastTouchedAt), previous?.updatedAt ?? 0);
        if (!result.has(id)) result.set(id, { id, left: { actor: left.actor, symbol: `${file}#file`, status: "modified" }, right: { actor: right.actor, symbol: `${file}#file`, status: "modified" }, distance: 0, path: null, firstSeenAt: previous?.firstSeenAt ?? clock.now(), updatedAt });
      }
    }
    return [...result.values()];
  }

  function updateGateIntervals() {
    const next = new Map<string, string>();
    if (policy.id !== "P0") for (const set of tracker.getActiveChangeSets()) if (set.status === "editing") for (const file of set.files.values()) {
      if (candidatePairs.some((pair) => [pair.left, pair.right].some((side) => actorKey(side.actor) === actorKey(set.actor) && side.symbol.startsWith(`${file.file}#`)))) next.set(file.file, "pending-judgement");
    }
    for (const record of coordinator.records()) {
      if (record.status !== "judged" || record.verdict?.decision !== "lock") continue;
      for (const key of [record.pair.left.symbol, record.pair.right.symbol]) next.set(key.slice(0, key.indexOf("#")), `pair:${record.pair.id}`);
    }
    for (const [file, reason] of next) if (!openGates.has(file)) openGates.set(file, { start: clock.now(), reason });
    for (const [file, gate] of openGates) if (!next.has(file)) {
      gateIntervals.push({ file, start: gate.start, end: clock.now(), reason: gate.reason });
      openGates.delete(file);
      persist(file);
    }
  }
}

function applyOps(text: string, ops: TextEditOp[]) {
  let result = text;
  let offset = 0;
  for (const op of ops) {
    const from = op.from + offset;
    if (result.slice(from, from + op.deleted.length) !== op.deleted) throw new Error(`回放编辑与文件文本不一致：${from}`);
    result = result.slice(0, from) + op.inserted + result.slice(from + op.deleted.length);
    offset += op.inserted.length - op.deleted.length;
  }
  return result;
}

function actorKey(actor: ActorRef) {
  if (actor.kind === "human") return `human:${actor.memberId}`;
  if (actor.kind === "agent") return `agent:${actor.runId}`;
  if (actor.kind === "guard-revert") return `guard-revert:${actor.memberId}`;
  return actor.kind;
}

function isFrozen(file: string, actor: ActorRef, ops: TextEditOp[], index: import("../semantic/types.js").SemanticIndex, intervals: ReplayResult["freezeIntervals"], at: number) {
  return actor.kind === "human" && intervals.some((interval) => interval.file === file && interval.end === undefined && interval.start <= at && ops.some((op) => op.from <= interval.endOffset && op.from + op.deleted.length >= interval.startOffset));
}

function cloneRecord(record: PairRecord): PairRecord {
  return JSON.parse(JSON.stringify(record)) as PairRecord;
}
