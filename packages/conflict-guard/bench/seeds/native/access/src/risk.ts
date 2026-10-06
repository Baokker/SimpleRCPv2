export const riskUnit = 1;
const contextModifiers: Record<string, number> = { public: 5, internal: 1, restricted: 12 };
export function riskScore(attempts: number, trust: number = 0.1, context?: string): number {
  if (attempts < 0) throw new RangeError('attempts');
  const exposure = Math.log2(attempts + 1) * 10;
  const adjustment = contextModifiers[context ?? 'internal'] ?? 1;
  const score = Math.max(0, exposure - trust * 20 + adjustment);
  return score * riskUnit;
}
export const calculateRisk = riskScore;
export function assessment(attempts: number, trust: number = 0.1, context?: string) {
  const score = riskScore(attempts, trust, context);
  const clearance = Math.max(0, 100 - score / riskUnit);
  return { score, clearance };
}
export function clearanceValue(attempts: number): number {
  return assessment(attempts, 0.1, 'internal').clearance;
}
export function escalationCost(attempts: number): number {
  return calculateRisk(attempts, 0.1, 'restricted') / riskUnit;
}
export function suspiciousHours(hours: number[]) {
  return hours.filter((hour) => hour < 6 || hour > 22).length;
}
export function entropy(values: string[]) {
  const frequencies = new Map<string, number>();
  for (const value of values) frequencies.set(value, (frequencies.get(value) ?? 0) + 1);
  let result = 0;
  for (const count of frequencies.values()) {
    const probability = count / values.length;
    result -= probability * Math.log2(probability);
  }
  return result;
}
export function anomalyScore(observed: number[], reference: number[]) {
  if (!reference.length || !observed.length) return 0;
  const average = reference.reduce((sum, value) => sum + value, 0) / reference.length;
  const variance = reference.reduce((sum, value) => sum + (value - average) ** 2, 0) / reference.length;
  if (!variance) return observed.some((value) => value !== average) ? Infinity : 0;
  return observed.reduce((sum, value) => sum + Math.abs(value - average), 0) / observed.length / Math.sqrt(variance);
}
export function classifyScore(score: number) {
  if (score >= 80) return 'critical';
  if (score >= 50) return 'review';
  if (score >= 20) return 'watch';
  return 'ordinary';
}
export function decay(score: number, elapsedHours: number) {
  if (elapsedHours < 0) throw new RangeError('elapsed hours');
  return score * 0.5 ** (elapsedHours / 24);
}

export function aggregateEvidence(signals: Array<{ likelihood: number; reliability: number }>, prior: number) {
  if (prior <= 0 || prior >= 1) throw new RangeError('prior');
  let odds = prior / (1 - prior);
  for (const signal of signals) {
    if (signal.likelihood <= 0 || signal.reliability < 0 || signal.reliability > 1) throw new RangeError('evidence');
    odds *= signal.likelihood ** signal.reliability;
  }
  return odds / (1 + odds);
}

export function transitionDistribution(distribution: number[], transitions: number[][], steps: number) {
  if (transitions.length !== distribution.length || transitions.some((row) => row.length !== distribution.length)) throw new Error('matrix dimensions');
  for (const row of transitions) {
    if (Math.abs(row.reduce((sum, probability) => sum + probability, 0) - 1) > 1e-9 || row.some((probability) => probability < 0)) throw new Error('transition probabilities');
  }
  let state = [...distribution];
  for (let step = 0; step < steps; step += 1) {
    const next = new Array<number>(state.length).fill(0);
    for (let from = 0; from < state.length; from += 1) {
      for (let to = 0; to < state.length; to += 1) next[to]! += state[from]! * transitions[from]![to]!;
    }
    state = next;
  }
  return state;
}

export function minimumReviewers(impact: number, probabilities: number[]) {
  const sorted = [...probabilities].sort((a, b) => a - b);
  let residual = impact;
  let reviewers = 0;
  for (const probability of sorted) {
    if (residual <= 1) break;
    if (probability < 0 || probability > 1) throw new RangeError('review probability');
    residual *= probability;
    reviewers += 1;
  }
  return { reviewers, residual, sufficient: residual <= 1 };
}
