import type { CandidatePair } from "../routing/candidates.js";
import type { ZoneVerdict } from "../routing/classifier.js";

export type PairStatus = "pending" | "judged" | "stale" | "resolved" | "closed";
export type Resolution = "reverted" | "overridden" | "auto-cleared";

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
}

export type PairEvent =
  | { type: "pair_judged"; record: PairRecord }
  | { type: "pair_stale"; record: PairRecord }
  | { type: "pair_resolved"; record: PairRecord }
  | { type: "pair_closed"; record: PairRecord };

export function createPairCoordinator(options: { now(): number; classify(pair: CandidatePair): ZoneVerdict }) {
  const records = new Map<string, PairRecord>();
  const revisionHistory = new Map<string, number>();
  const finalized = new Map<string, { revisionKey?: string; verdict: ZoneVerdict; resolution: Resolution }>();
  const requestedResolutions = new Map<string, Resolution>();
  const listeners = new Set<(event: PairEvent) => void>();
  const emit = (event: PairEvent) => { for (const listener of listeners) { try { listener(event); } catch { /* 事件监听器隔离 */ } } };
  const ensure = (pair: CandidatePair) => {
    const previous = records.get(pair.id);
    if (previous && previous.status !== "closed") { previous.pair = pair; previous.revisionKey = pair.revisionKey; previous.updatedAt = options.now(); return previous; }
    const final = finalized.get(pair.id);
    const revision = (revisionHistory.get(pair.id) ?? 0) + (previous && previous.revisionKey !== pair.revisionKey ? 1 : 0);
    revisionHistory.set(pair.id, revision);
    const record: PairRecord = { pair, status: final && final.revisionKey === pair.revisionKey ? "resolved" : "pending", revision, leftConfirmed: false, rightConfirmed: false, totalLockMs: 0, updatedAt: options.now(), revisionKey: pair.revisionKey, ...(final && final.revisionKey === pair.revisionKey ? { verdict: final.verdict, resolution: final.resolution } : {}) };
    records.set(pair.id, record);
    return record;
  };
  function update(pairs: CandidatePair[], shouldJudge: (pair: CandidatePair) => boolean = () => true) {
    const active = new Set(pairs.map((pair) => pair.id));
    for (const pair of pairs) {
      requestedResolutions.delete(pair.id);
      const previous = records.get(pair.id);
      if (previous && previous.status !== "closed" && previous.revisionKey !== pair.revisionKey) markChanged(pair.id);
      const record = ensure(pair);
      if ((record.status === "pending" || record.status === "stale" || !record.verdict) && shouldJudge(pair)) judge(record);
    }
    for (const [id, record] of records) if (!active.has(id) && record.status !== "closed") {
      const resolution = requestedResolutions.get(id);
      if (resolution) {
        requestedResolutions.delete(id);
        resolve(record, resolution);
        continue;
      }
      close(record);
    }
    return [...records.values()].filter((record) => record.status !== "closed");
  }
  function judge(record: PairRecord) {
    const previous = record.verdict;
    const verdict = options.classify(record.pair);
    const autoCleared = previous?.decision === "lock" && verdict.decision !== "lock";
    if (autoCleared) record.verdict = verdict;
    if (autoCleared) { resolve(record, "auto-cleared"); return; }
    if (record.firstLockedAt !== undefined && verdict.decision !== "lock") { record.totalLockMs += Math.max(0, options.now() - record.firstLockedAt); record.firstLockedAt = undefined; }
    if (verdict.decision === "lock" && record.firstLockedAt === undefined) record.firstLockedAt = options.now();
    record.status = "judged";
    record.verdict = verdict;
    record.updatedAt = options.now();
    emit({ type: "pair_judged", record: { ...record } });
  }
  function markChanged(id: string) {
    const record = records.get(id);
    if (!record || record.status === "closed") return;
    record.revision += 1;
    revisionHistory.set(id, record.revision);
    finalized.delete(id);
    record.status = "stale";
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
  function close(record: PairRecord) { if (record.firstLockedAt !== undefined) { record.totalLockMs += Math.max(0, options.now() - record.firstLockedAt); record.firstLockedAt = undefined; } record.status = "closed"; record.updatedAt = options.now(); emit({ type: "pair_closed", record: { ...record } }); }
  return {
    update,
    markChanged,
    confirm,
    resolve(id: string, resolution: Resolution) { const record = records.get(id); if (record) resolve(record, resolution); },
    requestResolution,
    records() { return [...records.values()]; },
    get(id: string) { return records.get(id); },
    onEvent(listener: (event: PairEvent) => void) { listeners.add(listener); return () => listeners.delete(listener); }
  };
}

export type PairCoordinator = ReturnType<typeof createPairCoordinator>;
