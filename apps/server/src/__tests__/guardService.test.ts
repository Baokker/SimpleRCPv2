import { describe, expect, it } from "vitest";
import { applyLlmJudgment, resolveGuardLlmMode } from "../guard/service.js";
import type { GuardDecision } from "../guard/types.js";

const decision: GuardDecision = {
  action: "ask",
  segments: [{ text: "curl www.baidu.com", capabilities: ["network"], zone: "workspace", reversibility: "reversible" }],
  legacyRisk: "risky",
  matchedRules: ["role.student.network"],
  unknown: false,
  autoEligible: true,
  approvers: "owners"
};

describe("guard service model mode semantics", () => {
  it("uses the saved project mode before the environment default", () => {
    expect(resolveGuardLlmMode({ protectedPaths: [], llmMode: "suggest" }, "auto")).toBe("suggest");
    expect(resolveGuardLlmMode(undefined, "auto")).toBe("auto");
    expect(resolveGuardLlmMode(undefined, undefined)).toBe("suggest");
  });

  it("keeps suggest results as advice and leaves human approval pending", () => {
    const result = applyLlmJudgment(decision, "suggest", "terminal", {
      risk: "high",
      confidence: 0.99,
      reason: "The request should be reviewed by a person."
    });
    expect(result.action).toBe("ask");
    expect(result.llm).toMatchObject({ mode: "suggest", risk: "high", applied: false });
  });

  it("applies a high confidence high risk result only in auto mode", () => {
    const result = applyLlmJudgment(decision, "auto", "terminal", {
      risk: "high",
      confidence: 0.99,
      reason: "The request is risky."
    });
    expect(result.action).toBe("deny");
    expect(result.llm).toMatchObject({ mode: "auto", applied: true });
  });
});
