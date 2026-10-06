import type { TraceEvent } from "../trace/trace.js";
import { replayTrace, type ReplayOptions } from "./engine.js";
import type { CandidatePair } from "../routing/candidates.js";

export function checkReplay(events: TraceEvent[], options: Omit<ReplayOptions, "policy"> = {}) {
  const recorded = events.filter((event) => event.type === "pair_judged").map((event) => ({ pairId: String(event.pairId), revision: Number(event.revision), at: event.at, ruleId: (event.verdict as { ruleId?: string })?.ruleId, decision: (event.verdict as { decision?: string })?.decision }));
  const replay = replayTrace(events, { ...options, policy: "P3" });
  const actual = replay.judgements.map((event) => ({ pairId: event.pairId, revision: event.revision, at: event.at, ruleId: event.verdict.ruleId, decision: event.verdict.decision }));
  const config = events.find((event) => event.type === "session_start")?.config as { idleMs?: number } | undefined;
  const tolerance = options.idleMs ?? config?.idleMs ?? 1500;
  const differences = [];
  const legacyRevisionMatches: Array<{ pairId: string; recorded: number; actual: number; revisionKey: string }> = [];
  const legacy = events.find((event) => event.type === "session_start")?.pairRevisionMode !== "judged-input";
  const inputs = events.filter((event) => event.type === "pair_judged").map((event) => (event.pair as CandidatePair | undefined)?.revisionKey);
  for (let index = 0; index < Math.max(recorded.length, actual.length); index += 1) {
    const expected = recorded[index]; const found = actual[index];
    const key = inputs[index];
    const compatible = legacy && typeof key === "string" && /^[a-f0-9]{64}$/.test(key) && key === replay.judgements[index]?.pair.revisionKey;
    if (!expected || !found || expected.pairId !== found.pairId || expected.revision !== found.revision && !compatible || expected.ruleId !== found.ruleId || expected.decision !== found.decision || Math.abs(expected.at - found.at) > tolerance) differences.push({ index, recorded: expected, actual: found });
    else if (expected.revision !== found.revision) legacyRevisionMatches.push({ pairId: found.pairId, recorded: expected.revision, actual: found.revision, revisionKey: key! });
  }
  const coordinationDifferences: Array<{ type: string; index: number; recorded?: unknown; actual?: unknown }> = [];
  const categories: Record<string, { recorded: number; actual: number; checked: boolean }> = {};
  for (const type of ["persist_gate", "persist", "freeze"]) {
    const perFile = type === "persist" || type === "persist_gate";
    const expected = events.filter((event) => event.type === type).sort((left, right) => perFile ? String(left.file).localeCompare(String(right.file)) || left.seq - right.seq : 0);
    const found = replay.coordinationEvents.filter((event) => event.type === type).sort((left, right) => perFile ? String(left.file).localeCompare(String(right.file)) || left.at - right.at : 0);
    categories[type] = { recorded: expected.length, actual: found.length, checked: expected.length > 0 };
    if (expected.length === 0) continue;
    for (let index = 0; index < Math.max(expected.length, found.length); index += 1) {
      const left = expected[index]; const right = found[index];
      if (!left || !right || JSON.stringify(normalize(left)) !== JSON.stringify(normalize(right)) || Math.abs(left.at - right.at) > tolerance) coordinationDifferences.push({ type, index, recorded: left && normalize(left), actual: right && normalize(right) });
    }
  }
  return { valid: recorded.length > 0 && differences.length === 0 && coordinationDifferences.length === 0 && replay.errors.length === 0, checked: recorded.length > 0, actual, differences, legacyRevisionMatches, coordinationDifferences, categories, errors: replay.errors, timeoutSimulation: replay.timeoutSimulation, ...(recorded.length === 0 ? { reason: "轨迹缺少 pair_judged，无法核验产品判定。" } : {}) };
}

function normalize(event: Record<string, unknown>) {
  if (event.type === "persist_gate") return { file: event.file, allowed: event.allowed, reason: event.reason };
  if (event.type === "persist") return { file: event.file, textHash: event.textHash };
  const regions = (event.regions as Array<Record<string, unknown>>).map((region) => ({ pairId: region.pairId, actor: region.actor, file: region.file, symbol: region.symbol, start: region.start, end: region.end })).sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
  return { regions };
}
