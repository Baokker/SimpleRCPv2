import { createHash } from "node:crypto";
import type { ActorRef, EditBatch, FileChange, TextEditOp } from "../model/types.js";
import type { ConflictGuardTracker } from "../tracking/tracker.js";
import type { SemanticChangeTracker, CandidatePair } from "../routing/candidates.js";
import type { SemanticIndex } from "../semantic/types.js";
import type { RelationPath } from "../semantic/types.js";
import { innermostSymbols, parseSymbols } from "../semantic/symbols.js";
import { transformRanges } from "../tracking/rangeTransform.js";
import { symbolContractChanged, type ZoneVerdict } from "../routing/classifier.js";
import { createPairCoordinator, type PairEvent, type PairAdjudicator, type PairRevisionMode } from "./pairState.js";
import type { ConflictGuardClock } from "../tracking/tracker.js";

export interface FrozenRegion {
  pairId: string;
  actor: ActorRef;
  symbol: string;
  file: string;
  start: number;
  end: number;
  summary: string;
}

export function createSessionCoordinator(options: {
  tracker: ConflictGuardTracker;
  semantic: SemanticChangeTracker;
  index: SemanticIndex;
  now(): number;
  intervene: boolean;
  arbitrationMode?: "owner" | "all-human" | "all-auto";
  enableT0?: boolean;
  enableSemanticPending?: boolean;
  classify(pair: CandidatePair): ZoneVerdict;
  adjudicate?: PairAdjudicator;
  clock?: ConflictGuardClock;
  softDeadlineMs?: number;
  revisionMode?: PairRevisionMode;
  onError(error: unknown, pairId: string): void;
  onEvent?(event: Record<string, unknown>): void;
}) {
  const frozen = new Map<string, FrozenRegion>();
  const analyzing = new Map<string, FrozenRegion>();
  const analysisTimers = new Map<string, unknown>();
  const gates = new Map<string, string>();
  const contracts = new Map<string, { actor: ActorRef; symbol: string }>();
  const warnings = new Set<string>();
  const awaitingBatches = new Map<string, EditBatch>();
  const batchSymbols = new Map<string, Set<string>>();
  const batchPaths = new Map<string, Array<{ actor: string; path: RelationPath }>>();
  let lastFrozen = "[]";
  const coordinator = createPairCoordinator({ now: options.now, adjudicate: options.adjudicate, revisionMode: options.revisionMode, classify(pair) {
    try { return options.classify(pair); }
    catch (error) {
      options.onError(error, pair.id);
      return { zone: "grey", decision: "warn", ruleId: "policy-error", summary: "判定计算失败，请共同检查修改。", evidence: [], contractChanged: { left: false, right: false }, typecheck: { ran: false, skipped: "规则判定异常" } };
    }
  } });
  const emit = (event: Record<string, unknown>) => options.onEvent?.({ at: options.now(), ...event });
  coordinator.onEvent((event: PairEvent) => {
    const record = event.record;
    if (event.type === "pair_analyzing" && options.clock) analysisTimers.set(record.pair.id, options.clock.setTimeout(() => coordinator.showAnalysis(record.pair.id, record.revision), options.softDeadlineMs ?? 2000));
    if (event.type !== "pair_analyzing" && event.type !== "pair_analysis_progress") { options.clock?.clearTimeout(analysisTimers.get(record.pair.id)); analysisTimers.delete(record.pair.id); }
    const sides = [record.pair.left, record.pair.right].map((side) => {
      const symbol = symbolFor(side.actor, side.symbol);
      return { key: side.symbol, beforeHash: symbol ? hash(symbol.before) : undefined, afterHash: symbol ? hash(symbol.after) : undefined };
    });
    emit({ type: event.type, pairId: record.pair.id, revision: record.revision, status: record.status, verdict: record.verdict, resolution: record.resolution, pair: record.pair, symbols: sides });
    syncFrozen();
    refreshGates();
  });

  function symbolFor(actor: ActorRef, key: string) {
    return options.semantic.getActiveChangeSets().find((set) => actorKey(set.actor) === actorKey(actor))?.files && [...(options.semantic.getActiveChangeSets().find((set) => actorKey(set.actor) === actorKey(actor))?.files.values() ?? [])].flatMap((file) => file.symbols ?? []).find((symbol) => symbol.key === key);
  }
  function touchedKeys(batch: { file: string; ranges: Array<{ start: number; end: number }> }) {
    const cached = "actor" in batch ? batchSymbols.get(`${actorKey(batch.actor as ActorRef)}:${batch.file}`) : undefined;
    return [...new Set([...(cached ?? []), ...batch.ranges.flatMap((range) => options.index.symbolsInRange(batch.file, range.start, range.end)).map((symbol) => symbol.key)])];
  }
  function relevantBatch(pair: CandidatePair) {
    return options.tracker.getOpenBatches().some((batch) => [pair.left, pair.right].some((side) => actorKey(batch.actor) === actorKey(side.actor) && touchedKeys(batch).some((key) => nested(key, side.symbol))));
  }
  function refresh(batches: Array<{ batch: EditBatch; change?: FileChange }> = [], pairs?: (pairs: CandidatePair[]) => CandidatePair[]) {
    options.semantic.update(options.tracker.getActiveChangeSets(), batches);
    for (const { batch } of batches) recordContracts(batch);
    for (const [key, entry] of contracts) if (!symbolFor(entry.actor, entry.symbol)) contracts.delete(key);
    coordinator.update(pairs ? pairs(options.semantic.getCandidatePairs()) : options.semantic.getCandidatePairs(), (pair) => !relevantBatch(pair));
    for (const { batch } of batches) {
      awaitingBatches.delete(batch.id);
      if (!options.tracker.getOpenBatches().some((open) => open.file === batch.file && actorKey(open.actor) === actorKey(batch.actor))) {
        const key = `${actorKey(batch.actor)}:${batch.file}`;
        batchSymbols.delete(key);
        batchPaths.delete(key);
      }
    }
    syncFrozen(true);
    refreshGates();
  }
  function pending(file: string) {
    const sets = options.semantic.getActiveChangeSets();
    for (const batch of [...options.tracker.getOpenBatches(), ...awaitingBatches.values()].filter((entry) => entry.file === file && entry.actor.kind === "human")) {
      const keys = touchedKeys(batch);
      for (const other of sets.filter((set) => set.actor.kind === "human" && actorKey(set.actor) !== actorKey(batch.actor))) {
        const otherKeys = [...other.files.values()].flatMap((change) => (change.symbols ?? []).map((symbol) => symbol.key));
        const paths = [...options.semantic.findPaths(keys, otherKeys, 2), ...(batchPaths.get(`${actorKey(batch.actor)}:${batch.file}`) ?? []).filter((entry) => entry.actor === actorKey(other.actor) && otherKeys.includes(entry.path.to)).map((entry) => entry.path)];
        for (const from of keys) for (const to of otherKeys) if (nested(from, to)) paths.push({ from, to, hops: [], typeOnly: false });
        for (const path of paths) {
          const record = coordinator.records().find((record) => [record.pair.left, record.pair.right].some((side) => actorKey(side.actor) === actorKey(batch.actor) && side.symbol === path.from) && [record.pair.left, record.pair.right].some((side) => actorKey(side.actor) === actorKey(other.actor) && side.symbol === path.to));
          if (!record || record.status === "pending" || record.status === "stale" || record.status === "closed" || record.status === "analyzing") return true;
          const current = symbolFor(batch.actor, path.from);
          const text = options.index.readFile?.(file);
          const symbol = options.index.symbolsInFile(file).find((symbol) => symbol.key === path.from);
          if (current && text !== undefined && symbol && current.after !== text.slice(symbol.start, symbol.end)) return true;
        }
      }
    }
    return false;
  }
  function gate(file: string) {
    if (!options.intervene) return { allowed: true, reason: undefined };
    const records = coordinator.records().filter((record) => coordinateHumans(record.pair));
    if (records.some((record) => record.status === "analyzing" && [record.pair.left.symbol, record.pair.right.symbol].some((key) => key.startsWith(`${file}#`)))) return { allowed: false, reason: "analyzing" };
    if (records.some((record) => ["judged", "stale"].includes(record.status) && record.verdict?.decision === "lock" && [record.pair.left.symbol, record.pair.right.symbol].some((key) => key.startsWith(`${file}#`)))) return { allowed: false, reason: "lock" };
    if (records.some((record) => ["pending", "stale"].includes(record.status) && [record.pair.left.symbol, record.pair.right.symbol].some((key) => key.startsWith(`${file}#`)))) return { allowed: false, reason: "pending-judgement" };
    if (options.enableSemanticPending !== false && pending(file)) return { allowed: false, reason: "pending-judgement" };
    return { allowed: true, reason: undefined };
  }
  function refreshGates() {
    const files = new Set([...gates.keys(), ...options.tracker.getActiveChangeSets().flatMap((set) => [...set.files.keys()])]);
    for (const file of files) {
      const result = gate(file);
      const previous = gates.get(file);
      if (result.allowed) gates.delete(file); else gates.set(file, result.reason!);
      if (previous !== result.reason) emit({ type: "persist_gate", file, allowed: result.allowed, reason: result.reason });
    }
  }
  function syncFrozen(reconcile = false) {
    const active = new Set<string>();
    const activeAnalysis = new Set<string>();
    if (options.intervene) for (const record of coordinator.records()) {
      if (!coordinateHumans(record.pair) || options.arbitrationMode === "all-auto") continue;
      const isAnalyzing = record.status === "analyzing";
      if (!isAnalyzing && (!["judged", "stale"].includes(record.status) || record.verdict?.decision !== "lock")) continue;
      for (const side of [record.pair.left, record.pair.right]) {
        if (side.actor.kind !== "human") continue;
        const key = `${record.pair.id}:${actorKey(side.actor)}:${side.symbol}`;
        const target = isAnalyzing ? analyzing : frozen;
        (isAnalyzing ? activeAnalysis : active).add(key);
        if (target.has(key) && !reconcile) continue;
        const file = side.symbol.slice(0, side.symbol.indexOf("#"));
        const symbol = options.index.symbolsInFile(file).find((entry) => entry.key === side.symbol);
        if (!symbol) continue;
        target.set(key, { pairId: record.pair.id, actor: side.actor, symbol: side.symbol, file, start: symbol.start, end: symbol.end, summary: isAnalyzing ? "分析中，文本继续同步。" : record.verdict!.summary });
      }
    }
    for (const key of frozen.keys()) if (!active.has(key)) frozen.delete(key);
    for (const key of analyzing.keys()) if (!activeAnalysis.has(key)) analyzing.delete(key);
    emitFrozen();
  }
  function edit(file: string, ops: TextEditOp[], human: boolean) {
    const violations = regions().filter((region) => region.file === file && ops.some((op) => op.from < region.end && op.from + op.deleted.length >= region.start));
    if (human && violations.length > 0) emit({ type: "freeze_violation", file, pairIds: [...new Set(violations.map((region) => region.pairId))] });
    let changed = false;
    const replacements: TextEditOp[] = [];
    for (const op of ops) {
      const previous = replacements.at(-1);
      if (previous && op.from === previous.from + previous.deleted.length) {
        previous.deleted += op.deleted;
        previous.inserted += op.inserted;
      } else replacements.push({ ...op });
    }
    for (const region of [...frozen.values(), ...analyzing.values()]) if (region.file === file) {
      const range = transformRanges([{ start: region.start, end: region.end }], replacements)[0];
      if (range) { changed ||= region.start !== range.start || region.end !== range.end; region.start = range.start; region.end = range.end; }
    }
    if (changed) emitFrozen();
    refreshGates();
  }
  function batchOpened(batch: EditBatch) {
    if (batch.actor.kind !== "human") return;
    const beforeRanges = batch.deletionEdits?.flatMap((edit) => edit.ops.filter((op) => op.deleted.length > 0).map((op) => ({ start: op.from, end: op.from + op.deleted.length }))) ?? [];
    const touched = [...new Set([...batch.ranges, ...beforeRanges].flatMap((range) => options.index.symbolsInRange(batch.file, range.start, range.end)).map((symbol) => symbol.key))];
    const batchKey = `${actorKey(batch.actor)}:${batch.file}`;
    batchSymbols.set(batchKey, new Set(touched));
    batchPaths.set(batchKey, options.semantic.getActiveChangeSets().filter((set) => actorKey(set.actor) !== actorKey(batch.actor)).flatMap((set) => {
      const otherKeys = [...set.files.values()].flatMap((file) => (file.symbols ?? []).map((symbol) => symbol.key));
      return options.semantic.findPaths(touched, otherKeys, 2).map((path) => ({ actor: actorKey(set.actor), path }));
    }));
    if (options.enableT0 === false) return;
    const symbols = parseSymbols(batch.file, batch.textAfter);
    const keys = batch.ranges.flatMap((range) => innermostSymbols(symbols, range.start, range.end)).map((symbol) => symbol.key);
    for (const entry of contracts.values()) {
      if (actorKey(entry.actor) === actorKey(batch.actor)) continue;
      for (const targetSymbol of [...new Set(keys)]) {
        if (!options.semantic.findPaths([targetSymbol], [entry.symbol], 2).length && targetSymbol !== entry.symbol) continue;
        const sides = [{ actor: actorKey(batch.actor), symbol: targetSymbol }, { actor: actorKey(entry.actor), symbol: entry.symbol }].sort((left, right) => left.actor.localeCompare(right.actor));
        const pairId = hash(JSON.stringify([sides[0]!.actor, sides[0]!.symbol, sides[1]!.actor, sides[1]!.symbol]));
        const revision = coordinator.get(pairId)?.revision ?? 0;
        const id = `${batch.id}:${pairId}`;
        if (warnings.has(id)) continue;
        warnings.add(id);
        emit({ type: "t0_warning", id, pairId, revision, targetSymbol, batchId: batch.id, memberId: batch.actor.memberId, targetActor: batch.actor, actor: entry.actor, symbol: entry.symbol, summary: `正在修改你依赖的 ${entry.symbol.slice(entry.symbol.indexOf("#") + 1)}：外部接口已改变。` });
      }
    }
  }
  function batchClosed(batch: EditBatch) {
    recordContracts(batch);
    awaitingBatches.set(batch.id, batch);
    refreshGates();
  }
  function recordContracts(batch: EditBatch) {
    if (batch.actor.kind !== "human") return;
    const set = options.semantic.getActiveChangeSets().find((set) => actorKey(set.actor) === actorKey(batch.actor));
    for (const symbol of set?.files.get(batch.file)?.symbols ?? []) {
      const key = `${actorKey(batch.actor)}:${symbol.key}`;
      if (symbolContractChanged(symbol)) contracts.set(key, { actor: batch.actor, symbol: symbol.key });
      else contracts.delete(key);
    }
  }
  function regions() { return [...frozen.values()].map((region) => ({ ...region })); }
  function coordinateHumans(pair: CandidatePair) { return humanPair(pair) || options.arbitrationMode === "all-human" && [pair.left.actor, pair.right.actor].some((actor) => actor.kind === "human"); }
  function emitFrozen() {
    const current = JSON.stringify(regions());
    if (current === lastFrozen) return;
    lastFrozen = current;
    emit({ type: "freeze", regions: regions() });
  }
  return { coordinator, refresh, gate, refreshGates, edit, batchOpened, batchClosed, regions, analyzingRegions: () => [...analyzing.values()].map((region) => ({ ...region })), symbolFor, blockedFiles: () => [...gates].map(([file, reason]) => ({ file, reason })), dispose() { coordinator.dispose(); for (const timer of analysisTimers.values()) options.clock?.clearTimeout(timer); analysisTimers.clear(); } };
}

function hash(value: string) { return createHash("sha256").update(value).digest("hex"); }
function humanPair(pair: CandidatePair) { return pair.left.actor.kind === "human" && pair.right.actor.kind === "human"; }
function actorKey(actor: ActorRef) { return actor.kind === "human" ? `human:${actor.memberId}` : actor.kind === "agent" ? `agent:${actor.runId}` : actor.kind; }
function nested(left: string, right: string) { return left === right || left.startsWith(`${right}.`) || right.startsWith(`${left}.`); }
