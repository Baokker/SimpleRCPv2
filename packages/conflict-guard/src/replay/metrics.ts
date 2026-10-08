export interface WilsonInterval {
  value: number;
  low: number;
  high: number;
}

export interface ReplayGroupOutcome {
  truth: "lock" | "warn" | "allow";
  decision: "lock" | "warn" | "allow";
  local?: boolean;
  totalPairCount?: number;
  localDecisionCount?: number;
  variantKind?: "conflict" | "safe";
  escaped: boolean;
  missed: boolean;
  overblocked: boolean;
  frozenPersonSeconds: number;
  unattendedFrozenPersonSeconds?: number;
  cardCount: number;
  latencyMs?: number;
  latenciesMs?: number[];
  missingLatencyTriggers?: number;
  virtualDurationMs?: number;
  hasRelation?: boolean;
  operatorFamily?: string;
  detectability?: string;
  agreed?: boolean;
  counterfactualEdits?: number;
  freezeCount?: number;
  frozenEdits?: number;
  exposureWindowMs?: number;
  conflictPersistAt?: number;
  unnotifiedEscape?: boolean;
}

export interface ReplayMetrics {
  groups: number;
  noRelationRatio: WilsonInterval;
  localDecisionRatio: WilsonInterval | null;
  agreement: WilsonInterval;
  missBlockRatio: WilsonInterval;
  falseBlockRatio: WilsonInterval;
  escapeRatio: WilsonInterval;
  frozenPersonSeconds: number;
  unattendedFrozenPersonSeconds: number;
  cardsPerHour: number;
  counterfactualEdits: number;
  freezeCount: number;
  frozenEdits: number;
  variantCounts: { conflict: number; safe: number };
  decisionLatencyMs: LatencySummary & { byVariant: { conflict: LatencySummary; safe: LatencySummary }; missingTriggers: number };
  exposureWindowMs: LatencySummary;
  unnotifiedEscapes: number;
  byOperatorFamily: Record<string, ReplayMetricsGroup>;
  byDetectability: Record<string, ReplayMetricsGroup>;
  byVariantKind: Record<string, ReplayMetricsGroup>;
  denominators: ReplayMetricsGroup["denominators"];
}

export interface ReplayMetricsGroup {
  groups: number;
  agreement: WilsonInterval;
  missBlockRatio: WilsonInterval;
  falseBlockRatio: WilsonInterval;
  escapeRatio: WilsonInterval;
  denominators: { agreement: number; missBlockRatio: number; falseBlockRatio: number; escapeRatio: number };
}

export interface LatencySummary { samples: number; p50: number; p95: number }

export interface PersistExposure {
  escaped: boolean;
  conflictPersistAt?: number;
  exposureWindowMs?: number;
}

export function calculateReplayMetrics(outcomes: ReplayGroupOutcome[], noRelation = 0): ReplayMetrics {
  const count = outcomes.length;
  const proportion = (value: number, denominator = count) => wilson(value, denominator);
  const localOutcomes = outcomes.filter((outcome) => outcome.localDecisionCount !== undefined && (outcome.totalPairCount ?? 0) > 0);
  const local = localOutcomes.reduce((sum, outcome) => sum + outcome.localDecisionCount!, 0);
  const localPairs = localOutcomes.reduce((sum, outcome) => sum + outcome.totalPairCount!, 0);
  const agreement = outcomes.filter((outcome) => outcome.agreed ?? outcome.truth === outcome.decision).length;
  const lockTruth = outcomes.filter((outcome) => outcome.truth === "lock");
  const allowTruth = outcomes.filter((outcome) => outcome.truth === "allow");
  const conflictTruth = outcomes.filter((outcome) => outcome.truth === "lock" || outcome.truth === "warn");
  const missed = lockTruth.filter((outcome) => outcome.missed).length;
  const overblocked = allowTruth.filter((outcome) => outcome.overblocked).length;
  const escaped = conflictTruth.filter((outcome) => outcome.escaped).length;
  const frozen = outcomes.reduce((sum, outcome) => sum + outcome.frozenPersonSeconds, 0);
  const cards = outcomes.reduce((sum, outcome) => sum + outcome.cardCount, 0);
  const latencies = outcomeLatencies(outcomes);
  const durationHours = outcomes.reduce((sum, outcome) => sum + (outcome.virtualDurationMs ?? 0), 0) / 3_600_000;
  return {
    groups: count,
    noRelationRatio: wilson(noRelation + outcomes.filter((outcome) => outcome.hasRelation === false).length, count + noRelation),
    localDecisionRatio: localPairs === 0 ? null : wilson(local, localPairs),
    agreement: proportion(agreement),
    missBlockRatio: wilson(missed, lockTruth.length),
    falseBlockRatio: wilson(overblocked, allowTruth.length),
    escapeRatio: wilson(escaped, conflictTruth.length),
    frozenPersonSeconds: frozen,
    unattendedFrozenPersonSeconds: outcomes.reduce((sum, outcome) => sum + (outcome.unattendedFrozenPersonSeconds ?? outcome.frozenPersonSeconds), 0),
    cardsPerHour: durationHours > 0 ? cards / durationHours : 0,
    counterfactualEdits: outcomes.reduce((sum, outcome) => sum + (outcome.counterfactualEdits ?? 0), 0),
    freezeCount: outcomes.reduce((sum, outcome) => sum + (outcome.freezeCount ?? 0), 0),
    frozenEdits: outcomes.reduce((sum, outcome) => sum + (outcome.frozenEdits ?? 0), 0),
    variantCounts: { conflict: outcomes.filter((outcome) => outcome.variantKind === "conflict").length, safe: outcomes.filter((outcome) => outcome.variantKind === "safe").length },
    decisionLatencyMs: {
      ...latencySummary(latencies),
      byVariant: {
        conflict: latencySummary(outcomeLatencies(outcomes.filter((outcome) => outcome.variantKind === "conflict"))),
        safe: latencySummary(outcomeLatencies(outcomes.filter((outcome) => outcome.variantKind === "safe")))
      },
      missingTriggers: outcomes.reduce((sum, outcome) => sum + (outcome.missingLatencyTriggers ?? 0), 0)
    },
    exposureWindowMs: latencySummary(outcomes.flatMap((outcome) => outcome.exposureWindowMs === undefined ? [] : [outcome.exposureWindowMs])),
    unnotifiedEscapes: outcomes.filter((outcome) => outcome.unnotifiedEscape).length,
    byOperatorFamily: groupedMetrics(outcomes, (outcome) => outcome.operatorFamily ?? "unknown"),
    byDetectability: groupedMetrics(outcomes, (outcome) => outcome.detectability ?? "unknown"),
    byVariantKind: groupedMetrics(outcomes, (outcome) => outcome.variantKind ?? "unknown"),
    denominators: { agreement: count, missBlockRatio: lockTruth.length, falseBlockRatio: allowTruth.length, escapeRatio: conflictTruth.length }
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
      missBlockRatio: wilson(members.filter((outcome) => outcome.truth === "lock" && outcome.missed).length, members.filter((outcome) => outcome.truth === "lock").length),
      falseBlockRatio: wilson(members.filter((outcome) => outcome.truth === "allow" && outcome.overblocked).length, members.filter((outcome) => outcome.truth === "allow").length),
      escapeRatio: wilson(members.filter((outcome) => outcome.truth !== "allow" && outcome.escaped).length, members.filter((outcome) => outcome.truth !== "allow").length),
      denominators: { agreement: size, missBlockRatio: members.filter((outcome) => outcome.truth === "lock").length, falseBlockRatio: members.filter((outcome) => outcome.truth === "allow").length, escapeRatio: members.filter((outcome) => outcome.truth !== "allow").length }
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
  return values[Math.max(0, Math.ceil(values.length * fraction) - 1)] ?? 0;
}

function outcomeLatencies(outcomes: ReplayGroupOutcome[]) {
  return outcomes.flatMap((outcome) => outcome.latenciesMs ?? (outcome.latencyMs === undefined ? [] : [outcome.latencyMs]));
}

function latencySummary(values: number[]): LatencySummary {
  const ordered = [...values].sort((left, right) => left - right);
  return { samples: ordered.length, p50: percentile(ordered, 0.5), p95: percentile(ordered, 0.95) };
}

export function detectPersistExposure(input: {
  truth: "allow" | "warn" | "lock";
  baseline: Record<string, string>;
  merged: Record<string, string>;
  persisted: ReplayResult["persisted"];
  interventions: number[];
}): PersistExposure {
  if (input.truth === "allow") return { escaped: false };
  const changed = Object.keys(input.merged).filter((file) => input.merged[file] !== input.baseline[file]);
  if (changed.length === 0) return { escaped: false };
  const state = { ...input.baseline };
  const firstIntervention = input.interventions.length > 0 ? Math.min(...input.interventions) : undefined;
  for (const write of input.persisted) {
    if (write.counterfactual) continue;
    state[write.file] = write.text;
    if (!changed.every((file) => state[file] === input.merged[file])) continue;
    const escaped = firstIntervention === undefined || firstIntervention > write.at;
    return { escaped, conflictPersistAt: write.at, ...(escaped && firstIntervention !== undefined ? { exposureWindowMs: firstIntervention - write.at } : {}) };
  }
  return { escaped: false };
}

export function replayOutcome(input: {
  truth: "allow" | "warn" | "lock";
  variantKind: "safe" | "conflict";
  operatorFamily: string;
  detectability: string;
  baseline: Record<string, string>;
  merged: Record<string, string>;
  trace: TraceEvent[];
  result: ReplayResult;
}): ReplayGroupOutcome {
  const { result } = input;
  const events = result.coordinationEvents;
  const notifications = result.judgements.filter((item) => item.verdict.decision !== "allow");
  const warnings = events.filter((event) => event.type === "t0_warning");
  const interventions = [...notifications.map((item) => item.at), ...warnings.map((event) => event.at)];
  const edits = input.trace.filter((event) => event.type === "edit");
  for (const edit of result.blockedEdits) if (edit.shouldHaveBeenBlocked) interventions.push(edit.at);
  const exposure = detectPersistExposure({ ...input, persisted: result.persisted, interventions });
  const cards = new Set(notifications.map((item) => `${item.pairId}:${item.revision}`));
  for (const warning of warnings) {
    if (warning.pairId === undefined || warning.revision === undefined) { cards.add(`t0:${String(warning.id)}`); continue; }
    const nextJudgement = result.judgements.find((item) => item.pairId === warning.pairId && item.at >= warning.at && item.revision >= Number(warning.revision));
    const nextRevision = events.find((event) => event.type === "pair_stale" && event.pairId === warning.pairId && event.at >= warning.at && Number(event.revision) >= Number(warning.revision));
    cards.add(`${warning.pairId}:${nextJudgement?.revision ?? nextRevision?.revision ?? warning.revision}`);
  }
  const latencies = result.judgements.flatMap((item) => {
    const triggerAt = item.triggerAt;
    return triggerAt === undefined ? [] : [Math.max(0, item.at - triggerAt)];
  });
  const frozenEdits = result.blockedEdits.filter((edit) => edit.shouldHaveBeenBlocked).length;
  const totalPairCount = result.pairs.length;
  return {
    truth: input.truth,
    decision: result.finalDecision,
    variantKind: input.variantKind,
    escaped: exposure.escaped,
    missed: input.truth === "lock" && result.finalDecision !== "lock",
    overblocked: input.truth === "allow" && result.finalDecision === "lock",
    frozenPersonSeconds: frozenPersonSeconds(result, input.trace.find((event) => event.type === "session_start")?.typing ? Math.max(0, ...edits.map((event) => event.at)) : result.endedAt),
    unattendedFrozenPersonSeconds: frozenPersonSeconds(result),
    cardCount: cards.size,
    freezeCount: new Set(result.freezeIntervals.map((interval) => `${interval.pairId}:${interval.start}`)).size,
    frozenEdits,
    counterfactualEdits: frozenEdits,
    latenciesMs: latencies,
    missingLatencyTriggers: result.judgements.length - latencies.length,
    virtualDurationMs: edits.length > 1 ? Math.max(...edits.map((event) => event.at)) - Math.min(...edits.map((event) => event.at)) : 0,
    hasRelation: result.semanticRelations > 0,
    operatorFamily: input.operatorFamily,
    detectability: input.detectability,
    totalPairCount,
    ...(result.policy === "P3" || result.policy.startsWith("G") ? { localDecisionCount: result.pairs.filter((pair) => pair.final?.verdict && !pair.final.verdict.adjudication && (pair.final.verdict.zone !== "grey" || pair.final.verdict.localOnly)).length } : {}),
    unnotifiedEscape: exposure.escaped && interventions.length === 0,
    ...(exposure.conflictPersistAt === undefined ? {} : { conflictPersistAt: exposure.conflictPersistAt }),
    ...(exposure.exposureWindowMs === undefined ? {} : { exposureWindowMs: exposure.exposureWindowMs })
  };
}

export function frozenPersonSeconds(result: Pick<ReplayResult, "freezeIntervals" | "endedAt">, cutoff = result.endedAt) {
  const actors = new Map<string, Array<[number, number]>>();
  for (const interval of result.freezeIntervals) {
    const key = JSON.stringify(interval.actor);
    const ranges = actors.get(key) ?? [];
    ranges.push([interval.start, Math.min(interval.end ?? result.endedAt, cutoff)]);
    actors.set(key, ranges);
  }
  let milliseconds = 0;
  for (const ranges of actors.values()) {
    let end = -Infinity;
    for (const [start, currentEnd] of ranges.sort((left, right) => left[0] - right[0])) {
      milliseconds += Math.max(0, currentEnd - Math.max(start, end));
      end = Math.max(end, currentEnd);
    }
  }
  return milliseconds / 1000;
}
import type { ReplayResult } from "./engine.js";
import type { TraceEvent } from "../trace/trace.js";
