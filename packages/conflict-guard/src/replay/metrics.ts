export interface WilsonInterval {
  value: number;
  low: number;
  high: number;
}

export interface ReplayGroupOutcome {
  truth: "lock" | "warn" | "allow";
  decision: "lock" | "warn" | "allow";
  local: boolean;
  escaped: boolean;
  missed: boolean;
  overblocked: boolean;
  frozenPersonSeconds: number;
  cardCount: number;
  latencyMs?: number;
  virtualDurationMs?: number;
  hasRelation?: boolean;
  operatorFamily?: string;
  detectability?: string;
  agreed?: boolean;
}

export interface ReplayMetrics {
  groups: number;
  noRelationRatio: WilsonInterval;
  localDecisionRatio: WilsonInterval;
  agreement: WilsonInterval;
  missBlockRatio: WilsonInterval;
  falseBlockRatio: WilsonInterval;
  escapeRatio: WilsonInterval;
  frozenPersonSeconds: number;
  cardsPerHour: number;
  decisionLatencyMs: { p50: number; p95: number };
  byOperatorFamily: Record<string, ReplayMetricsGroup>;
  byDetectability: Record<string, ReplayMetricsGroup>;
}

export interface ReplayMetricsGroup {
  groups: number;
  agreement: WilsonInterval;
  missBlockRatio: WilsonInterval;
  falseBlockRatio: WilsonInterval;
  escapeRatio: WilsonInterval;
}

export function calculateReplayMetrics(outcomes: ReplayGroupOutcome[], noRelation = 0): ReplayMetrics {
  const count = outcomes.length;
  const proportion = (value: number, denominator = count) => wilson(value, denominator);
  const local = outcomes.filter((outcome) => outcome.local).length;
  const agreement = outcomes.filter((outcome) => outcome.agreed ?? outcome.truth === outcome.decision).length;
  const missed = outcomes.filter((outcome) => outcome.missed).length;
  const overblocked = outcomes.filter((outcome) => outcome.overblocked).length;
  const escaped = outcomes.filter((outcome) => outcome.escaped).length;
  const frozen = outcomes.reduce((sum, outcome) => sum + outcome.frozenPersonSeconds, 0);
  const cards = outcomes.reduce((sum, outcome) => sum + outcome.cardCount, 0);
  const latencies = outcomes.flatMap((outcome) => outcome.latencyMs === undefined ? [] : [outcome.latencyMs]).sort((a, b) => a - b);
  const durationHours = Math.max(1 / 3_600, outcomes.reduce((sum, outcome) => sum + (outcome.virtualDurationMs ?? 0), 0) / 3_600_000);
  return {
    groups: count,
    noRelationRatio: wilson(noRelation + outcomes.filter((outcome) => outcome.hasRelation === false).length, count + noRelation),
    localDecisionRatio: proportion(local),
    agreement: proportion(agreement),
    missBlockRatio: proportion(missed),
    falseBlockRatio: proportion(overblocked),
    escapeRatio: proportion(escaped),
    frozenPersonSeconds: frozen,
    cardsPerHour: cards / durationHours,
    decisionLatencyMs: { p50: percentile(latencies, 0.5), p95: percentile(latencies, 0.95) },
    byOperatorFamily: groupedMetrics(outcomes, (outcome) => outcome.operatorFamily ?? "unknown"),
    byDetectability: groupedMetrics(outcomes, (outcome) => outcome.detectability ?? "unknown")
  };
}

export function wilson(successes: number, trials: number, z = 1.96): WilsonInterval {
  if (trials <= 0) return { value: 0, low: 0, high: 0 };
  const value = successes / trials;
  const denominator = 1 + z * z / trials;
  const center = (value + z * z / (2 * trials)) / denominator;
  const margin = z * Math.sqrt((value * (1 - value) + z * z / (4 * trials)) / trials) / denominator;
  return { value, low: Math.max(0, center - margin), high: Math.min(1, center + margin) };
}

function groupedMetrics(outcomes: ReplayGroupOutcome[], key: (outcome: ReplayGroupOutcome) => string) {
  const groups: Record<string, ReplayMetricsGroup> = {};
  for (const [name, members] of groupBy(outcomes, key)) {
    const size = members.length;
    groups[name] = {
      groups: size,
      agreement: wilson(members.filter((outcome) => outcome.agreed ?? outcome.truth === outcome.decision).length, size),
      missBlockRatio: wilson(members.filter((outcome) => outcome.missed).length, size),
      falseBlockRatio: wilson(members.filter((outcome) => outcome.overblocked).length, size),
      escapeRatio: wilson(members.filter((outcome) => outcome.escaped).length, size)
    };
  }
  return groups;
}

function groupBy<T>(values: T[], key: (value: T) => string) {
  const groups = new Map<string, T[]>();
  for (const value of values) {
    const name = key(value);
    const group = groups.get(name) ?? [];
    group.push(value);
    groups.set(name, group);
  }
  return groups;
}

function percentile(values: number[], fraction: number) {
  if (values.length === 0) return 0;
  return values[Math.min(values.length - 1, Math.floor((values.length - 1) * fraction))] ?? 0;
}
