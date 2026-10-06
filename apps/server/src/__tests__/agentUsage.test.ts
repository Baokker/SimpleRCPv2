import { describe, expect, it } from "vitest";
import { createAgentUsageCollector, normalizeAgentUsage, estimateAgentUsageCost } from "../agent/agentUsage.js";

describe("Agent usage collection", () => {
  it("prices uncached, cached and reasoning tokens separately for MiniMax-M2", () => {
    const usage = { inputTokens: 1_000_000, outputTokens: 500_000, reasoningTokens: 500_000, cacheReadTokens: 1_000_000, cacheWriteTokens: 1_000_000, cost: 0 };
    expect(estimateAgentUsageCost(usage, "minimax", "MiniMax-M2")).toMatchObject({ estimatedCost: 13.335, estimatedCostCurrency: "CNY", cost: 0 });
    expect(estimateAgentUsageCost(usage, "deepseek", "deepseek-chat")).toBe(usage);
  });
  it("uses the runtime total and replaces repeated message updates", () => {
    expect(normalizeAgentUsage({ role: "assistant", tokens: { total: 42, input: 10, output: 15, reasoning: 5, cache: { read: 2, write: 1 } }, cost: 0.2 })).toEqual({ inputTokens: 10, outputTokens: 15, reasoningTokens: 5, cacheReadTokens: 2, cacheWriteTokens: 1, totalTokens: 42, cost: 0.2 });
    const collector = createAgentUsageCollector();
    collector.observe({ type: "message.updated", data: { info: { id: "message-1", role: "assistant", tokens: { total: 20, input: 8, output: 10, reasoning: 2, cache: { read: 0, write: 0 } }, cost: 0.1 } } });
    collector.observe({ type: "message.updated", data: { info: { id: "message-1", role: "assistant", tokens: { total: 30, input: 10, output: 15, reasoning: 5, cache: { read: 2, write: 1 } }, cost: 0.2 } } });
    expect(collector.total()).toEqual({ inputTokens: 10, outputTokens: 15, reasoningTokens: 5, cacheReadTokens: 2, cacheWriteTokens: 1, totalTokens: 30, cost: 0.2 });
    collector.addResult({ inputTokens: 10, outputTokens: 15, reasoningTokens: 5, totalTokens: 30, cost: 0.2 }, "message-1");
    collector.observe({ type: "message.updated", data: { info: { id: "message-2", role: "assistant", tokens: { input: 4, output: 6, reasoning: 2 }, cost: 0.1 } } });
    expect(collector.total()).toEqual({ inputTokens: 14, outputTokens: 21, reasoningTokens: 7, totalTokens: 42, cost: expect.closeTo(0.3) });
    const summaryCollector = createAgentUsageCollector();
    summaryCollector.observe({ type: "message.updated", data: { info: { id: "message-summary" }, usageSummary: { inputTokens: 3, outputTokens: 4, totalTokens: 7, cost: 0.04 } } });
    expect(summaryCollector.total()).toEqual({ inputTokens: 3, outputTokens: 4, totalTokens: 7, cost: 0.04 });
    expect(normalizeAgentUsage({ role: "user", tokens: { input: 10, output: 0 } })).toBeUndefined();
  });
});
