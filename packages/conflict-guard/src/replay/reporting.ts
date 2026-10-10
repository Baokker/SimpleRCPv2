import type { ReplayMetrics } from "./metrics.js";

export function escapeDifference(metrics: ReplayMetrics, oracle?: ReplayMetrics) {
  if (!oracle || metrics.denominators.escapeRatio === 0 || oracle.denominators.escapeRatio === 0) return "N/A";
  return `${((metrics.escapeRatio.value - oracle.escapeRatio.value) * 100).toFixed(1)} pp`;
}

export function paretoPoints(reports: Record<string, { metrics: ReplayMetrics }>) {
  const valid = Object.entries(reports).filter(([, { metrics }]) => metrics.denominators.escapeRatio > 0 && Number.isFinite(metrics.escapeRatio.value));
  const maxCards = Math.max(1, ...valid.map(([, { metrics }]) => metrics.cardsPerHour));
  return { maxCards, excluded: Object.entries(reports).filter(([, { metrics }]) => metrics.denominators.escapeRatio === 0).map(([id]) => id), points: valid.map(([id, { metrics }]) => ({ id, x: 65 + metrics.cardsPerHour / maxCards * 340, y: 245 - metrics.escapeRatio.value * 200 })) };
}
