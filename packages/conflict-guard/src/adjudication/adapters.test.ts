import { describe, it, expect } from "vitest";
import { createJevJudge, createDeepJudge } from "./adapters.js";
import { defaultAdjudicationConfig } from "./config.js";
import type { AdjudicationInput } from "./types.js";

const input: AdjudicationInput = { promptVersion: "pair-v1", left: { actorKind: "human", file: "a.ts", symbol: "a.ts#price", before: "function price(){return 1}", after: "function price(){return 2}" }, right: { actorKind: "human", file: "b.ts", symbol: "b.ts#buy", before: "function buy(){return price()}", after: "function buy(){return price()+1}" }, relationship: "buy calls price", invariants: "price returns whole units", local: { excludedRules: [], typecheck: { ran: false } } };

describe("adjudication adapters", () => {
  it("Jev sends one pinned Choice and accepts rounded probabilities", async () => {
    let body: Record<string, unknown> = {};
    const judge = createJevJudge({ apiKey: "test-credential", fetch: async (_url, init) => {
      body = JSON.parse(String(init?.body));
      return Response.json({ model: "jev-1.13.0", answers: { decision: { type: "choice", choice: "warn", confidence: 0.7, probabilities: { allow: 0.2, warn: 0.7, lock: 0.09 } } }, usage: { input_tokens: 20, output_tokens: 10 } });
    }, now: () => 10, config: defaultAdjudicationConfig });
    const result = await judge.judge(input, new AbortController().signal);
    expect(body.model).toBe("jev-1.13.0");
    expect(Object.keys(body.questions as object)).toEqual(["decision"]);
    expect(JSON.stringify(body)).not.toContain("test-credential");
    expect(result.decision).toBe("warn");
    expect(result.probabilities?.lock).toBe(0.09);
  });

  it("Jev rejects invalid probability mass without exposing the response", async () => {
    const judge = createJevJudge({ apiKey: "test-credential", fetch: async () => Response.json({ model: "jev-1.13.0", answers: { decision: { type: "choice", choice: "allow", confidence: 1, probabilities: { allow: 1, warn: 1, lock: 0 } } } }), now: () => 0, config: defaultAdjudicationConfig });
    await expect(judge.judge(input, new AbortController().signal)).rejects.toMatchObject({ status: "invalid-format" });
  });

  it("DeepSeek disables thinking and validates Chinese explanation and evidence", async () => {
    let body: Record<string, unknown> = {};
    const judge = createDeepJudge({ name: "deepseek", apiKey: "test-credential", baseUrl: "https://example.invalid/v1", model: "deepseek-chat", fetch: async (_url, init) => {
      body = JSON.parse(String(init?.body));
      return Response.json({ choices: [{ message: { content: JSON.stringify({ decision: "lock", riskLevel: "high", confidence: 0.9, summary: "价格单位改变。", evidence: [{ path: "a.ts", symbol: "price", reason: "单位不一致" }], missingContext: false, userExplanation: "双方使用的价格单位不同。", suggestedAction: "请 price 的修改者统一价格单位。" }) } }], usage: { prompt_tokens: 40, completion_tokens: 30 } });
    }, now: () => 0, config: defaultAdjudicationConfig });
    const result = await judge.judge(input, { reasoning: false }, new AbortController().signal);
    expect(body.thinking).toEqual({ type: "disabled" });
    expect(body.temperature).toBe(0);
    expect(body.response_format).toEqual({ type: "json_object" });
    expect(result.userExplanation).toBe("双方使用的价格单位不同。");
    expect(JSON.stringify(result)).not.toContain("test-credential");
  });

  it("HTTP errors and cancellation contain only safe metadata", async () => {
    const judge = createJevJudge({ apiKey: "test-credential", fetch: async () => new Response("test-credential", { status: 401 }), now: () => 0, config: defaultAdjudicationConfig });
    await expect(judge.judge(input, new AbortController().signal)).rejects.toMatchObject({ message: "provider HTTP 401", status: "failed" });
    const abort = new AbortController(); abort.abort();
    await expect(judge.judge(input, abort.signal)).rejects.toMatchObject({ status: "cancelled" });
  });
  it("network exceptions and malformed JSON never expose transport details", async () => {
    const options = { apiKey: "test-credential", now: () => 0, config: defaultAdjudicationConfig };
    const failed = createJevJudge({ ...options, fetch: async () => { throw new Error("test-credential in transport error"); } });
    await expect(failed.judge(input, new AbortController().signal)).rejects.toMatchObject({ message: "provider failed" });
    const invalid = createJevJudge({ ...options, fetch: async () => new Response("invalid JSON") });
    await expect(invalid.judge(input, new AbortController().signal)).rejects.toMatchObject({ status: "invalid-format" });
  });
  it("compatible endpoint uses the deep role and rejects extra response fields", async () => {
    let body: Record<string, unknown> = {};
    const judge = createDeepJudge({ name: "openai-compatible", model: "second-model", apiKey: "test-credential", config: defaultAdjudicationConfig, now: () => 0, fetch: async (_url, init) => {
      body = JSON.parse(String(init?.body));
      return Response.json({ choices: [{ message: { content: JSON.stringify({ decision: "warn", riskLevel: "medium", confidence: 0.5, summary: "共同检查", evidence: [], missingContext: true, userExplanation: "请检查计算。", suggestedAction: "请双方检查计算。", unexpected: true }) } }] });
    } });
    await expect(judge.judge(input, { reasoning: false }, new AbortController().signal)).rejects.toMatchObject({ status: "invalid-format" });
    expect(body.model).toBe("second-model");
    expect(body.thinking).toBeUndefined();
  });
  it("compatible endpoint accepts the same validated decision format", async () => {
    const judge = createDeepJudge({ name: "openai-compatible", model: "second-model", baseUrl: "https://example.invalid/v1", apiKey: "test-credential", config: defaultAdjudicationConfig, now: () => 0, fetch: async () => Response.json({ choices: [{ message: { content: JSON.stringify({ decision: "allow", riskLevel: "low", confidence: 0.95, summary: "修改兼容", evidence: [], missingContext: false, userExplanation: "双方修改可以共同继续。", suggestedAction: "请双方保留当前修改。" }) } }] }) });
    expect(await judge.judge(input, { reasoning: false }, new AbortController().signal)).toMatchObject({ decision: "allow", confidence: 0.95, userExplanation: "双方修改可以共同继续。" });
  });
  it("removes sensitive values from response property names", async () => {
    const judge = createJevJudge({ apiKey: "test-credential", config: defaultAdjudicationConfig, now: () => 0, fetch: async () => Response.json({ "test-credential": "extra metadata", model: "jev-1.13.0", answers: { decision: { type: "choice", choice: "allow", confidence: 0.9, probabilities: { allow: 0.9, warn: 0.1, lock: 0 } } } }) });
    expect(JSON.stringify(await judge.judge(input, new AbortController().signal))).not.toContain("test-credential");
  });
});

export { input };
