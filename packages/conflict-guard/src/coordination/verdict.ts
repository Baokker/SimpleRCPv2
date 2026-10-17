import type { ZoneVerdict } from "../routing/classifier.js";

const incompleteRules = new Set(["model-unavailable", "agent-analysis-unavailable", "syntax-incomplete-final", "syntax-incomplete-waiting", "policy-error", "unparsable-side"]);

export function isEffectiveVerdict(verdict: ZoneVerdict) {
  return !verdict.deferred && verdict.adjudication?.status !== "degraded" && !incompleteRules.has(verdict.ruleId);
}

export function effectiveVerdict(current: ZoneVerdict, previous?: ZoneVerdict): ZoneVerdict {
  if (current.ruleId === "agent-analysis-unavailable") return current;
  if (isEffectiveVerdict(current)) return current;
  if (previous && isEffectiveVerdict(previous)) {
    if (current.ruleId === "model-unavailable" && previous.decision !== "lock") return { ...current, decision: "warn" };
    return previous;
  }
  return { ...current, decision: "warn" };
}
