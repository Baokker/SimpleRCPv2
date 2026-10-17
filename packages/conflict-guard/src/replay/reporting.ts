import type { ReplayMetrics } from "./metrics.js";
import type { ZoneVerdict } from "../routing/classifier.js";

export function replayEvidenceSummary(groups: Array<{
  id?: string;
  outcome: { truth: string; decision: string };
  result: { judgements: Array<{ verdict: Pick<ZoneVerdict, "ruleId" | "summary"> }> };
}>) {
  const safe = groups.filter((group) => group.outcome.truth === "allow");
  const safeWarnings = safe.filter((group) => group.outcome.decision === "warn").length;
  const missing = groups.map((group) => ({
    id: group.id,
    count: group.result.judgements.filter(({ verdict }) => verdict.ruleId === "model-unavailable" &&
      (verdict.summary.startsWith("研判录放缓存未命中") || verdict.summary.startsWith("深判缓存缺失"))).length
  })).filter((group) => group.count > 0);
  return { safeTruthCount: safe.length, safeWarnings, safeWarningRate: safe.length ? safeWarnings / safe.length : null, cacheMissingJudgements: missing.reduce((count, group) => count + group.count, 0), cacheMissingGroups: missing, comparable: missing.length === 0 };
}

export function escapeDifference(metrics: ReplayMetrics, oracle?: ReplayMetrics) {
  if (!oracle || metrics.denominators.escapeRatio === 0 || oracle.denominators.escapeRatio === 0) return "N/A";
  return `${((metrics.escapeRatio.value - oracle.escapeRatio.value) * 100).toFixed(1)} pp`;
}

export function paretoPoints(reports: Record<string, { metrics: ReplayMetrics }>) {
  const valid = Object.entries(reports).filter(([, { metrics }]) => metrics.denominators.escapeRatio > 0 && Number.isFinite(metrics.escapeRatio.value));
  const maxCards = Math.max(1, ...valid.map(([, { metrics }]) => metrics.cardsPerHour));
  return { maxCards, excluded: Object.entries(reports).filter(([, { metrics }]) => metrics.denominators.escapeRatio === 0).map(([id]) => id), points: valid.map(([id, { metrics }]) => ({ id, x: 65 + metrics.cardsPerHour / maxCards * 340, y: 245 - metrics.escapeRatio.value * 200 })) };
}
