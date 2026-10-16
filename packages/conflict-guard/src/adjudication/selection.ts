export interface DevelopmentCandidate {
  id: string;
  validResponseRatio: number;
  falseBlockRatio: number;
  missed: number;
  agreement: number;
  p50Ms: number | null;
  escalationRatio: number;
}

export function selectDevelopmentCandidate(candidates: DevelopmentCandidate[], step: "prompt" | "threshold" | "strategy") {
  if (!candidates.length) throw new Error("开发集选择缺少候选");
  for (const candidate of candidates) {
    if (![candidate.validResponseRatio, candidate.falseBlockRatio, candidate.agreement, candidate.escalationRatio].every((value) => Number.isFinite(value) && value >= 0 && value <= 1) || !Number.isInteger(candidate.missed) || candidate.missed < 0 || candidate.p50Ms !== null && (!Number.isFinite(candidate.p50Ms) || candidate.p50Ms < 0)) throw new Error("开发集候选指标无效");
  }
  const bestResponse = Math.max(...candidates.map((candidate) => candidate.validResponseRatio));
  let eligible = candidates.filter((candidate) => bestResponse - candidate.validResponseRatio <= 0.05 + Number.EPSILON);
  const safe = eligible.filter((candidate) => candidate.falseBlockRatio <= 0.15);
  eligible = safe.length ? safe : eligible.filter((candidate) => candidate.falseBlockRatio === Math.min(...eligible.map((candidate) => candidate.falseBlockRatio)));
  const minimumMissed = Math.min(...eligible.map((candidate) => candidate.missed));
  eligible = eligible.filter((candidate) => candidate.missed <= minimumMissed + 1);
  const agreement = Math.max(...eligible.map((candidate) => candidate.agreement));
  eligible = eligible.filter((candidate) => candidate.agreement === agreement);
  const tieValue = (candidate: DevelopmentCandidate) => step === "threshold" ? candidate.escalationRatio : candidate.p50Ms ?? Infinity;
  const minimumTie = Math.min(...eligible.map(tieValue));
  return eligible.find((candidate) => tieValue(candidate) === minimumTie)!;
}
