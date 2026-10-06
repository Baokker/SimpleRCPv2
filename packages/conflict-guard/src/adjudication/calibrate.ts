import type { Decision } from "../routing/classifier.js";

export interface CalibrationSample { truth: Decision; fast?: { decision: Decision; confidence: number }; deep?: { decision: Decision } }
export function calibrateThreshold(samples: CalibrationSample[]) {
  if (samples.length === 0) throw new Error("校准需要开发集样本");
  const thresholds = [...new Set([0, ...Array.from({ length: 21 }, (_, index) => index / 20)])];
  const lockCount = samples.filter((sample) => sample.truth === "lock").length;
  const allowCount = samples.filter((sample) => sample.truth === "allow").length;
  const curves = thresholds.map((threshold) => {
    let escalated = 0; let missed = 0; let overblocked = 0; let agreed = 0; let complete = 0;
    for (const sample of samples) {
      const escalate = !sample.fast || sample.fast.confidence < threshold || sample.fast.decision === "lock";
      escalated += Number(escalate);
      const result = escalate ? sample.deep : sample.fast;
      complete += Number(Boolean(result));
      const decision = result?.decision ?? "warn";
      missed += Number(sample.truth === "lock" && decision !== "lock");
      overblocked += Number(sample.truth === "allow" && decision === "lock");
      agreed += Number(sample.truth === decision);
    }
    return { threshold, coverage: 1 - escalated / samples.length, escalationRatio: escalated / samples.length, missBlockRatio: lockCount ? missed / lockCount : null, falseBlockRatio: allowCount ? overblocked / allowCount : null, agreement: agreed / samples.length, completionRatio: complete / samples.length };
  });
  const ordered = [...curves].sort((left, right) => (left.missBlockRatio ?? 0) - (right.missBlockRatio ?? 0) || (left.falseBlockRatio ?? 0) - (right.falseBlockRatio ?? 0) || right.agreement - left.agreement || left.escalationRatio - right.escalationRatio || left.threshold - right.threshold);
  return { samples: samples.length, lockCount, allowCount, recommended: ordered[0]!.threshold, selection: "minimum missed blocking, then false blocking, then maximum agreement, then minimum escalation", curves };
}
