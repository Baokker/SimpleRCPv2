import type { TraceEvent } from "../trace/trace.js";
import { replayTrace, type ReplayOptions } from "./engine.js";

export function checkReplay(events: TraceEvent[], options: Omit<ReplayOptions, "policy"> = {}) {
  const recorded = events.filter((event) => event.type === "pair_judged").map((event) => ({ pairId: String(event.pairId), revision: Number(event.revision), at: event.at, ruleId: (event.verdict as { ruleId?: string })?.ruleId, decision: (event.verdict as { decision?: string })?.decision }));
  const replay = replayTrace(events, { ...options, policy: "P3" });
  const actual = replay.judgements.map((event) => ({ pairId: event.pairId, revision: event.revision, at: event.at, ruleId: event.verdict.ruleId, decision: event.verdict.decision }));
  const config = events.find((event) => event.type === "session_start")?.config as { idleMs?: number } | undefined;
  const tolerance = options.idleMs ?? config?.idleMs ?? 1500;
  const differences = [];
  for (let index = 0; index < Math.max(recorded.length, actual.length); index += 1) {
    const expected = recorded[index]; const found = actual[index];
    if (!expected || !found || expected.pairId !== found.pairId || expected.revision !== found.revision || expected.ruleId !== found.ruleId || expected.decision !== found.decision || Math.abs(expected.at - found.at) > tolerance) differences.push({ index, recorded: expected, actual: found });
  }
  return { valid: recorded.length > 0 && differences.length === 0, checked: recorded.length > 0, actual, differences, ...(recorded.length === 0 ? { reason: "轨迹缺少 pair_judged，无法核验产品判定。" } : {}) };
}
