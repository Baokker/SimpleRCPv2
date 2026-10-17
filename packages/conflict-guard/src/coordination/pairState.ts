import type { CandidatePair } from "../routing/candidates.js";
import type { ZoneVerdict } from "../routing/classifier.js";
import type { ConflictGuardClock } from "../tracking/tracker.js";
import { effectiveVerdict, isEffectiveVerdict } from "./verdict.js";

export type PairStatus = "pending" | "analyzing" | "judged" | "stale" | "resolved" | "closed";
export type Resolution = "reverted" | "overridden" | "auto-cleared";
export type PairRevisionMode = "judged-input" | "legacy";
export type PairCloseReason = "candidate-removed" | "candidate-filtered" | "change-set-closed" | "no-semantic-change" | "relation-removed";

export interface PairRecord {
  pair: CandidatePair;
  status: PairStatus;
  revision: number;
  verdict?: ZoneVerdict;
  resolution?: Resolution;
  leftConfirmed: boolean;
  rightConfirmed: boolean;
  firstLockedAt?: number;
  totalLockMs: number;
  updatedAt: number;
  revisionKey?: string;
  analysisStartedAt?: number;
  analysisVisible?: boolean;
  analysisPending?: boolean;
  closeReason?: PairCloseReason;
  lastAttempt?: ZoneVerdict;
}

export type PairEvent =
  | { type: "pair_analyzing" | "pair_analysis_progress"; record: PairRecord }
  | { type: "pair_judged" | "pair_unchanged"; record: PairRecord }
  | { type: "pair_stale"; record: PairRecord }
  | { type: "pair_syntax_waiting"; record: PairRecord }
  | { type: "pair_resolved"; record: PairRecord }
  | { type: "pair_closed"; record: PairRecord };

export type PairAdjudicationUpdate = { final?: boolean };
export type PairAdjudicator = (pair: CandidatePair, local: ZoneVerdict, signal: AbortSignal, complete: (verdict: ZoneVerdict, update?: PairAdjudicationUpdate) => void) => void;

export function createJudgementQueue(options: { clock: ConflictGuardClock; frameMs: number; maximum: number }) {
  const jobs = new Map<string, { run(): void; cancelled?(): void }>();
  let timer: unknown;
  let disposed = false;
  const schedule = () => {
    if (timer !== undefined || !jobs.size) return;
    timer = options.clock.setTimeout(() => {
      timer = undefined;
      let count = 0;
      try {
        for (const [id, job] of jobs) {
          jobs.delete(id);
          job.run();
          if (++count >= options.maximum) break;
        }
      } finally { schedule(); }
    }, options.frameMs);
  };
  return {
    enqueue(id: string, run: () => void, cancelled?: () => void) { if (disposed) { cancelled?.(); return; } jobs.set(id, { run, cancelled }); schedule(); },
    cancel(id: string) { const job = jobs.get(id); jobs.delete(id); job?.cancelled?.(); },
    dispose() { disposed = true; options.clock.clearTimeout(timer); timer = undefined; const pending = [...jobs.values()]; jobs.clear(); for (const job of pending) job.cancelled?.(); }
  };
}
export type JudgementQueue = ReturnType<typeof createJudgementQueue>;

export function createPairCoordinator(options: { now(): number; classify(pair: CandidatePair): ZoneVerdict; adjudicate?: PairAdjudicator; revisionMode?: PairRevisionMode; clock?: ConflictGuardClock; judgementFrameMs?: number; maxJudgementsPerFrame?: number; judgementQueue?: JudgementQueue; resultCache?: Map<string, { verdict: ZoneVerdict; pair: CandidatePair }> }) {
  const records = new Map<string, PairRecord>();
  const revisionHistory = new Map<string, number>();
  const finalized = new Map<string, { revisionKey?: string; verdict: ZoneVerdict; resolution: Resolution }>();
  const requestedResolutions = new Map<string, Resolution>();
  const listeners = new Set<(event: PairEvent) => void>();
  const analyses = new Map<string, AbortController>();
  const invalidated = new Set<string>();
  const results = options.resultCache ?? new Map<string, { verdict: ZoneVerdict; pair: CandidatePair }>();
  const published = new Map<string, string>();
  const effective = new Map<string, ZoneVerdict>();
  const queued = new Map<string, () => boolean>();
  let timer: unknown;
  function schedule() {
    if (options.judgementQueue) {
      for (const [id, eligible] of queued) options.judgementQueue.enqueue(`T1:${id}`, () => {
        queued.delete(id);
        const record = records.get(id);
        if (record && ["pending", "stale"].includes(record.status) && eligible()) judge(record);
      });
      return;
    }
    if (!options.clock || timer !== undefined || !queued.size) return;
    timer = options.clock.setTimeout(() => {
      timer = undefined;
      let count = 0;
      for (const [id, eligible] of queued) {
        queued.delete(id);
        const record = records.get(id);
        if (!record || !["pending", "stale"].includes(record.status) || !eligible()) continue;
        judge(record);
        if (++count >= (options.maxJudgementsPerFrame ?? 20)) break;
      }
      schedule();
    }, options.judgementFrameMs ?? 200);
  }
  const emit = (event: PairEvent) => { for (const listener of listeners) { try { listener(event); } catch { /* 事件监听器隔离 */ } } };
  const ensure = (pair: CandidatePair) => {
    const previous = records.get(pair.id);
    if (previous && previous.status !== "closed") { previous.pair = pair; previous.revisionKey = pair.revisionKey; previous.updatedAt = options.now(); return previous; }
    const retryFailure = previous?.status === "closed" && previous.verdict && (previous.verdict.adjudication?.status === "degraded" || previous.verdict.ruleId === "model-unavailable" || previous.verdict.ruleId === "agent-analysis-unavailable" || previous.verdict.ruleId === "syntax-incomplete-final");
    const advance = retryFailure || previous && previous.revisionKey !== pair.revisionKey && (options.revisionMode === "legacy" || previous.verdict && !invalidated.has(pair.id));
    const revision = (revisionHistory.get(pair.id) ?? 0) + (advance ? 1 : 0);
    if (advance) { invalidated.add(pair.id); finalized.delete(pair.id); }
    const final = finalized.get(pair.id);
    revisionHistory.set(pair.id, revision);
    const record: PairRecord = { pair, status: final && final.revisionKey === pair.revisionKey ? "resolved" : "pending", revision, leftConfirmed: false, rightConfirmed: false, totalLockMs: 0, updatedAt: options.now(), revisionKey: pair.revisionKey, ...(effective.has(pair.id) ? { verdict: effective.get(pair.id) } : {}), ...(final && final.revisionKey === pair.revisionKey ? { verdict: final.verdict, resolution: final.resolution } : {}) };
    records.set(pair.id, record);
    return record;
  };
  function update(pairs: CandidatePair[], shouldJudge: (pair: CandidatePair) => boolean = () => true, closeReason: (pair: CandidatePair) => PairCloseReason = () => "candidate-removed") {
    const active = new Set(pairs.map((pair) => pair.id));
    for (const pair of pairs) {
      requestedResolutions.delete(pair.id);
      const previous = records.get(pair.id);
      const changed = previous?.revisionKey !== pair.revisionKey;
      if (previous && previous.status !== "closed" && previous.revisionKey !== pair.revisionKey) markChanged(pair.id);
      const record = ensure(pair);
      if (record.lastAttempt?.deferred && !changed) continue;
      if ((record.status === "pending" || record.status === "stale" || !record.verdict) && shouldJudge(pair)) {
        if (options.clock && (options.judgementFrameMs ?? 200) > 0) queued.set(pair.id, () => shouldJudge(record.pair));
        else judge(record);
      }
    }
    for (const [id, record] of records) if (!active.has(id) && record.status !== "closed") {
      const resolution = requestedResolutions.get(id);
      if (resolution) {
        requestedResolutions.delete(id);
        resolve(record, resolution);
        continue;
      }
      close(record, closeReason(record.pair));
    }
    schedule();
    return [...records.values()].filter((record) => record.status !== "closed");
  }
  function judge(record: PairRecord) {
    invalidated.delete(record.pair.id);
    const previous = record.verdict;
    const cacheKey = JSON.stringify([record.pair.id, record.revision, record.revisionKey]);
    const cached = results.get(cacheKey);
    if (cached) { record.pair = { ...record.pair, left: cached.pair.left, right: cached.pair.right, path: cached.pair.path, distance: cached.pair.distance }; applyVerdict(record, cached.verdict, previous); return; }
    const classified = (record.pair.relations?.length ? record.pair.relations : [{ left: record.pair.left.symbol, right: record.pair.right.symbol, path: record.pair.path }]).map((relation) => {
      const pair = { ...record.pair, left: { ...record.pair.left, symbol: relation.left }, right: { ...record.pair.right, symbol: relation.right }, path: relation.path, distance: (relation.path?.hops.length ?? 0) as CandidatePair["distance"] };
      return { pair, verdict: options.classify(pair) };
    }).sort((a, b) => severity(b.verdict) - severity(a.verdict) || Number(Boolean(a.verdict.localOnly)) - Number(Boolean(b.verdict.localOnly)));
    const selected = classified[0]!;
    record.pair = selected.pair;
    const verdict = selected.verdict;
    if (verdict.zone === "grey" && !verdict.localOnly && options.adjudicate) {
      const request = new AbortController();
      analyses.set(record.pair.id, request);
      const revision = record.revision;
      record.status = "analyzing";
      record.analysisPending = false;
      record.verdict = effective.get(record.pair.id) ?? verdict;
      record.analysisStartedAt = options.now();
      record.analysisVisible = false;
      emit({ type: "pair_analyzing", record: { ...record } });
      const complete = (result: ZoneVerdict, update: PairAdjudicationUpdate = {}) => {
        const isFinal = update.final !== false;
        const activeStatus = record.status === "analyzing" || (record.status === "judged" && record.analysisPending);
        if (request.signal.aborted || record.revision !== revision || !activeStatus || analyses.get(record.pair.id) !== request) return;
        if (result.deferred) {
          analyses.delete(record.pair.id);
          record.analysisPending = false;
          record.status = "pending";
          record.lastAttempt = result;
          record.verdict = effectiveVerdict(result, effective.get(record.pair.id));
          record.analysisVisible = false;
          emit({ type: "pair_syntax_waiting", record: { ...record } });
          return;
        }
        if (!isFinal) {
          record.analysisPending = true;
          // 快判提醒只用于界面展示，保留上一次有效结论供最终研判使用。
          record.lastAttempt = result;
          record.analysisVisible = false;
          record.status = "judged";
          record.verdict = previous?.decision === "lock" ? previous : result;
          record.updatedAt = options.now();
          emit({ type: "pair_judged", record: { ...record } });
          return;
        }
        analyses.delete(record.pair.id);
        record.analysisPending = false;
        const minimum = classified.find((entry) => entry.verdict.localOnly && entry.verdict.decision === "warn");
        const final = result.decision === "allow" && minimum ? minimum.verdict : result;
        results.set(cacheKey, { verdict: final, pair: record.pair });
        applyVerdict(record, final, previous);
      };
      try { options.adjudicate(record.pair, verdict, request.signal, complete); }
      catch { complete({ ...verdict, decision: "warn", ruleId: "model-unavailable", summary: "研判失败，已降级为警告。" }); }
      return;
    }
    results.set(cacheKey, { verdict, pair: record.pair });
    applyVerdict(record, verdict, previous);
  }
  function applyVerdict(record: PairRecord, verdict: ZoneVerdict, previous = record.verdict) {
    record.lastAttempt = verdict;
    verdict = effectiveVerdict(verdict, effective.get(record.pair.id));
    if (isEffectiveVerdict(verdict)) effective.set(record.pair.id, verdict);
    record.analysisVisible = false;
    const autoCleared = previous?.decision === "lock" && verdict.decision !== "lock";
    if (autoCleared) record.verdict = verdict;
    if (autoCleared) { resolve(record, "auto-cleared"); return; }
    if (record.firstLockedAt !== undefined && verdict.decision !== "lock") { record.totalLockMs += Math.max(0, options.now() - record.firstLockedAt); record.firstLockedAt = undefined; }
    if (verdict.decision === "lock" && record.firstLockedAt === undefined) record.firstLockedAt = options.now();
    record.status = "judged";
    record.verdict = verdict;
    record.updatedAt = options.now();
    const fingerprint = verdictFingerprint(verdict);
    if (published.get(record.pair.id) !== fingerprint) {
      published.set(record.pair.id, fingerprint);
      emit({ type: "pair_judged", record: { ...record } });
    } else emit({ type: "pair_unchanged", record: { ...record } });
  }
  function markChanged(id: string) {
    const record = records.get(id);
    if (!record || record.status === "closed") return;
    if (options.revisionMode !== "legacy" && (record.status === "pending" || record.status === "stale") && !record.lastAttempt?.deferred) return;
    analyses.get(id)?.abort();
    analyses.delete(id);
    record.revision += 1;
    invalidated.add(id);
    revisionHistory.set(id, record.revision);
    finalized.delete(id);
    record.status = "stale";
    record.analysisPending = false;
    record.lastAttempt = undefined;
    record.leftConfirmed = false;
    record.rightConfirmed = false;
    record.updatedAt = options.now();
    emit({ type: "pair_stale", record: { ...record } });
  }
  function confirm(id: string, side: "left" | "right") {
    const record = records.get(id);
    if (!record || record.status !== "judged" || record.verdict?.decision !== "lock") return false;
    record[side === "left" ? "leftConfirmed" : "rightConfirmed"] = true;
    if (record.leftConfirmed && record.rightConfirmed) resolve(record, "overridden");
    return true;
  }
  function resolve(record: PairRecord, resolution: Resolution) {
    if (record.firstLockedAt !== undefined) { record.totalLockMs += Math.max(0, options.now() - record.firstLockedAt); record.firstLockedAt = undefined; }
    record.status = "resolved";
    record.resolution = resolution;
    if (resolution === "overridden" && record.verdict) finalized.set(record.pair.id, { revisionKey: record.revisionKey, verdict: record.verdict, resolution });
    record.updatedAt = options.now();
    emit({ type: "pair_resolved", record: { ...record } });
  }
  function requestResolution(id: string, resolution: Resolution) {
    const record = records.get(id);
    if (!record || record.status === "closed") return false;
    requestedResolutions.set(id, resolution);
    return true;
  }
  function close(record: PairRecord, reason: PairCloseReason) {
    record.closeReason = reason;
    analyses.get(record.pair.id)?.abort(reason);
    analyses.delete(record.pair.id);
    queued.delete(record.pair.id);
    options.judgementQueue?.cancel(`T1:${record.pair.id}`);
    if (record.firstLockedAt !== undefined) { record.totalLockMs += Math.max(0, options.now() - record.firstLockedAt); record.firstLockedAt = undefined; }
    record.status = "closed";
    record.analysisPending = false;
    record.updatedAt = options.now();
    emit({ type: "pair_closed", record: { ...record } });
  }
  return {
    update,
    markChanged,
    confirm,
    resolve(id: string, resolution: Resolution) { const record = records.get(id); if (record) resolve(record, resolution); },
    requestResolution,
    finishSyntax(id: string) {
      const record = records.get(id);
      if (!record || !record.lastAttempt?.deferred || record.status === "closed") return;
      const { deferred: _deferred, ...attempt } = record.lastAttempt;
      applyVerdict(record, { ...attempt, ruleId: "syntax-incomplete-final", summary: "修改结束时声明仍不完整，请双方检查代码。", localOnly: true });
    },
    showAnalysis(id: string, revision: number) { const record = records.get(id); if (record?.status === "analyzing" && record.revision === revision) { record.analysisVisible = true; emit({ type: "pair_analysis_progress", record: { ...record } }); } },
    dispose() { for (const request of analyses.values()) request.abort(); analyses.clear(); options.clock?.clearTimeout(timer); for (const id of queued.keys()) options.judgementQueue?.cancel(`T1:${id}`); queued.clear(); },
    records() { return [...records.values()]; },
    get(id: string) { return records.get(id); },
    onEvent(listener: (event: PairEvent) => void) { listeners.add(listener); return () => listeners.delete(listener); }
  };
}

function severity(verdict: ZoneVerdict) { return { allow: 0, warn: 1, lock: 2 }[verdict.decision] * 10 + Number(verdict.zone === "black"); }

export function verdictFingerprint(verdict: ZoneVerdict) {
  return JSON.stringify({ zone: verdict.zone, decision: verdict.decision, ruleId: verdict.ruleId, summary: verdict.summary, evidence: verdict.evidence, explanation: verdict.adjudication?.userExplanation, suggestion: verdict.adjudication?.suggestedAction });
}

export type PairCoordinator = ReturnType<typeof createPairCoordinator>;
