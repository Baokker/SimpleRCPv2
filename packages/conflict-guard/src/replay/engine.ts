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

export interface ReplayOptions {
  policy: ZoningPolicy | ZoningPolicy["id"];
  seed?: number;
  idleMs?: number;
  cursorLeaveLines?: number;
  maxBatchDurationMs?: number;
  activeIdleMs?: number;
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
  freezeIntervals: Array<{ pairId: string; file: string; actor: ActorRef; start: number; end?: number }>;
  gateIntervals: Array<{ file: string; start: number; end?: number; reason: string }>;
  blockedEdits: Array<{ seq: number; file: string; actor: ActorRef; shouldHaveBeenBlocked: boolean }>;
  finalTexts: Record<string, string>;
}

export function replayTrace(events: TraceEvent[], options: ReplayOptions): ReplayResult {
  const clock = new VirtualClock(events[0]?.at ?? 0);
  const files = new MemoryFileProvider();
  const trackerClock: ConflictGuardClock = { now: () => clock.now(), setTimeout: (callback, delay) => clock.setTimeout(callback, delay), clearTimeout: (handle) => clock.clearTimeout(handle) };
  const tracker = new ConflictGuardTracker({ clock: trackerClock, idleMs: options.idleMs ?? 1_500, cursorLeaveLines: options.cursorLeaveLines ?? 3, maxBatchDurationMs: options.maxBatchDurationMs ?? 5_000, activeIdleMs: options.activeIdleMs ?? 600_000, createId: (() => { let count = 0; return () => `replay-batch-${++count}`; })() });
  const index = createSemanticIndex({ files, now: () => clock.now() });
  const semantic = new SemanticChangeTracker({ index, readFile: (file) => files.readFile(file), now: () => clock.now() });
  const policy = typeof options.policy === "string" ? policyFor(options.policy) : options.policy;
  const judgements: ReplayJudgement[] = [];
  const recordMap = new Map<string, PairRecord[]>();
  const freezeIntervals: ReplayResult["freezeIntervals"] = [];
  const gateIntervals: ReplayResult["gateIntervals"] = [];
  const blockedEdits: ReplayResult["blockedEdits"] = [];
  const openGates = new Map<string, { start: number; reason: string }>();
  let currentText = new Map<string, string>();
  let candidatePairs: CandidatePair[] = [];
  const coordinator = createPairCoordinator({ now: () => clock.now(), classify: (pair) => policy.decide({ pair, activeFiles: activeFiles(), project: index, symbols: (side) => symbolFor(side.actor, side.symbol) }) });

  const refresh = (batches: Array<{ batch: import("../model/types.js").EditBatch; change?: import("../model/types.js").FileChange }> = []) => {
    const changed = [...new Set(batches.map(({ batch }) => batch.file))];
    if (changed.length > 0) index.update(changed);
    semantic.update(tracker.getActiveChangeSets(), batches);
    candidatePairs = policy.id === "P1" ? withSameFilePairs(semantic.getCandidatePairs()) : semantic.getCandidatePairs();
    coordinator.update(candidatePairs);
    updateFreezeIntervals();
    updateGateIntervals();
  };

  tracker.onEvent((event: ConflictGuardEvent) => {
    if (event.type === "batch_closed") refresh([{ batch: event.batch, change: tracker.getActiveChangeSets().find((set) => actorKey(set.actor) === actorKey(event.batch.actor))?.files.get(event.batch.file) }]);
    else if (event.type === "change_set_file_closed" || event.type === "change_set_closed") refresh();
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
    clock.advanceTo(event.at);
    if (event.type === "doc_open") {
      if (event.skipped === "sensitive") continue;
      const file = String(event.file);
      const text = String(event.text ?? "");
      files.open(file, text);
      currentText.set(file, text);
      tracker.openDocument(file, text);
      index.update([file]);
      refresh();
      continue;
    }
    if (event.type === "edit") {
      const file = String(event.file);
      const before = currentText.get(file) ?? files.readFile(file);
      const ops = event.ops as TextEditOp[];
      const after = applyOps(before, ops);
      const origin = event.origin as ActorRef;
      const shouldBlock = isFrozen(file, origin, freezeIntervals, clock.now());
      blockedEdits.push({ seq: event.seq, file, actor: origin, shouldHaveBeenBlocked: shouldBlock });
      currentText.set(file, after);
      files.set(file, after);
      tracker.edit({ file, origin, at: event.at, ops, revisionAfter: Number(event.revisionAfter ?? 0), textBefore: before, textAfter: after });
      index.update([file]);
      refresh();
      continue;
    }
    if (event.type === "cursor") {
      const position = event.position as { lineNumber: number; column: number };
      tracker.cursorChanged({ actor: { kind: "human", memberId: String(event.memberId) }, file: String(event.file), lineNumber: Number(position.lineNumber), column: Number(position.column), at: event.at });
      refresh();
    }
  }
  clock.flush();
  tracker.flush();
  refresh();
  for (const [file, gate] of openGates) gateIntervals.push({ file, start: gate.start, end: clock.now(), reason: gate.reason });
  for (const interval of freezeIntervals) if (interval.end === undefined) interval.end = clock.now();
  const pairs = [...recordMap.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([id, records]) => ({ id, records, final: records.at(-1) }));
  return { policy: policy.id, seed: options.seed ?? 0, events, judgements, pairs, freezeIntervals, gateIntervals, blockedEdits, finalTexts: Object.fromEntries([...currentText.entries()].sort(([left], [right]) => left.localeCompare(right))) };

  function activeFiles(): ActiveFileChange[] {
    return semantic.getActiveChangeSets().flatMap((set) => [...set.files.values()].map((file) => ({ actor: set.actor, file: file.file, symbols: file.symbols ?? [] })));
  }

  function symbolFor(actor: ActorRef, key: string) {
    return semantic.getActiveChangeSets().find((set) => actorKey(set.actor) === actorKey(actor))?.files && [...(semantic.getActiveChangeSets().find((set) => actorKey(set.actor) === actorKey(actor))?.files.values() ?? [])].flatMap((file) => file.symbols ?? []).find((symbol) => symbol.key === key);
  }

  function updateFreezeIntervals() {
    for (const pair of coordinator.records()) {
      const locked = pair.verdict?.decision === "lock" && pair.status === "judged";
      const keys = [pair.pair.left.symbol, pair.pair.right.symbol];
      for (const key of keys) {
        const file = key.slice(0, key.indexOf("#"));
        const interval = freezeIntervals.find((item) => item.pairId === pair.pair.id && item.file === file && actorKey(item.actor) === actorKey(key === pair.pair.left.symbol ? pair.pair.left.actor : pair.pair.right.actor) && item.end === undefined);
        if (locked && !interval) freezeIntervals.push({ pairId: pair.pair.id, file, actor: key === pair.pair.left.symbol ? pair.pair.left.actor : pair.pair.right.actor, start: clock.now() });
        if (!locked && interval) interval.end = clock.now();
      }
    }
  }

  function withSameFilePairs(pairs: CandidatePair[]) {
    const result = new Map(pairs.map((pair) => [pair.id, pair]));
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
        const leftSymbol = left.symbols[0];
        const rightSymbol = right.symbols[0];
        if (!leftSymbol || !rightSymbol) continue;
        const actors = [actorKey(left.actor), actorKey(right.actor)].sort();
        const symbols = [leftSymbol.key, rightSymbol.key].sort();
        const id = `p1:${file}:${actors.join(":")}\u003a${symbols.join(":")}`;
        if (!result.has(id)) result.set(id, { id, left: { actor: left.actor, symbol: leftSymbol.key, status: leftSymbol.status }, right: { actor: right.actor, symbol: rightSymbol.key, status: rightSymbol.status }, distance: 0, path: null, firstSeenAt: clock.now(), updatedAt: clock.now() });
      }
    }
    return [...result.values()];
  }

  function updateGateIntervals() {
    const next = new Map<string, string>();
    for (const record of coordinator.records()) {
      if (record.status !== "judged" || record.verdict?.decision !== "lock") continue;
      for (const key of [record.pair.left.symbol, record.pair.right.symbol]) next.set(key.slice(0, key.indexOf("#")), `pair:${record.pair.id}`);
    }
    for (const [file, reason] of next) if (!openGates.has(file)) openGates.set(file, { start: clock.now(), reason });
    for (const [file, gate] of openGates) if (!next.has(file)) {
      gateIntervals.push({ file, start: gate.start, end: clock.now(), reason: gate.reason });
      openGates.delete(file);
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

function isFrozen(file: string, actor: ActorRef, intervals: ReplayResult["freezeIntervals"], at: number) {
  return actor.kind === "human" && intervals.some((interval) => interval.file === file && interval.end === undefined && interval.start <= at);
}

function cloneRecord(record: PairRecord): PairRecord {
  return JSON.parse(JSON.stringify(record)) as PairRecord;
}
