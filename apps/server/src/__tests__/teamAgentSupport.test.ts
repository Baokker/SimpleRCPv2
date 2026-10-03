import { describe, expect, it } from "vitest";
import { normalizeHandle, parseMentions, validateHandle } from "../agent/teamAgentSupport.js";

describe("team Agent handle support", () => {
  it("normalizes display names into handles", () => {
    expect(normalizeHandle("  Code Review Team  ")).toBe("code-review-team");
    expect(normalizeHandle("中文 Agent!")).toBe("agent");
  });

  it("validates syntax and reserved handles", () => {
    expect(() => validateHandle("agent-1")).not.toThrow();
    expect(() => validateHandle("1".repeat(33))).toThrow();
    expect(() => validateHandle("system")).toThrow();
    expect(() => validateHandle("all")).toThrow();
  });

  it("parses candidate mentions in order without email matches", () => {
    const candidates = new Set(["agent", "reviewer"]);
    expect(parseMentions("Email a@agent.test then @reviewer and @agent @reviewer", candidates))
      .toEqual(["reviewer", "agent"]);
    expect(parseMentions("中文 @代理 and @missing", candidates)).toEqual([]);
  });
});
