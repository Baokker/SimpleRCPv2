import { describe, it, expect } from "vitest";
import { createJevJudge, createDeepJudge, createCompatibleFastJudge, createJudgeRegistry } from "./adapters.js";
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
      return Response.json({ model: "deepseek-chat", choices: [{ message: { content: JSON.stringify({ decision: "lock", riskLevel: "high", confidence: 0.9, summary: "价格单位改变。", evidence: [{ path: "a.ts", symbol: "price", reason: "单位不一致" }], missingContext: false, userExplanation: "双方使用的价格单位不同。", suggestedAction: "请 price 的修改者统一价格单位。" }) } }], usage: { prompt_tokens: 40, completion_tokens: 30 } });
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
      return Response.json({ model: "second-model", choices: [{ message: { content: JSON.stringify({ decision: "warn", riskLevel: "medium", confidence: 0.5, summary: "共同检查", evidence: [], missingContext: true, userExplanation: "请检查计算。", suggestedAction: "请双方检查计算。", unexpected: true }) } }] });
    } });
    await expect(judge.judge(input, { reasoning: false }, new AbortController().signal)).rejects.toMatchObject({ status: "invalid-format" });
    expect(body.model).toBe("second-model");
    expect(body.thinking).toBeUndefined();
  });
  it("compatible endpoint accepts the same validated decision format", async () => {
    const judge = createDeepJudge({ name: "openai-compatible", model: "second-model", baseUrl: "https://example.invalid/v1", apiKey: "test-credential", config: defaultAdjudicationConfig, now: () => 0, fetch: async () => Response.json({ model: "second-model", choices: [{ message: { content: JSON.stringify({ decision: "allow", riskLevel: "low", confidence: 0.95, summary: "修改兼容", evidence: [], missingContext: false, userExplanation: "双方修改可以共同继续。", suggestedAction: "请双方保留当前修改。" }) } }] }) });
    expect(await judge.judge(input, { reasoning: false }, new AbortController().signal)).toMatchObject({ decision: "allow", confidence: 0.95, userExplanation: "双方修改可以共同继续。" });
  });
  it("removes sensitive values from response property names", async () => {
    const judge = createJevJudge({ apiKey: "test-credential", config: defaultAdjudicationConfig, now: () => 0, fetch: async () => Response.json({ "test-credential": "extra metadata", model: "jev-1.13.0", answers: { decision: { type: "choice", choice: "allow", confidence: 0.9, probabilities: { allow: 0.9, warn: 0.1, lock: 0 } } } }) });
    expect(JSON.stringify(await judge.judge(input, new AbortController().signal))).not.toContain("test-credential");
  });
  it("rejects a deep response from another model", async () => {
    const judge = createDeepJudge({ name: "deepseek", model: "expected", apiKey: "test-credential", config: defaultAdjudicationConfig, now: () => 0, fetch: async () => Response.json({ model: "different", choices: [] }) });
    await expect(judge.judge(input, { reasoning: false }, new AbortController().signal)).rejects.toMatchObject({ message: "provider model version mismatch" });
  });
  it("uses conditional choice logprobs for the compatible fast role", async () => {
    const judge = createCompatibleFastJudge({ model: "fast-model", baseUrl: "https://example.invalid/v1", apiKey: "test-credential", config: defaultAdjudicationConfig, now: () => 0, fetch: async (_url, init) => {
      expect(JSON.parse(String(init?.body))).toMatchObject({ logprobs: true, top_logprobs: 20 });
      return Response.json({ model: "fast-model", choices: [{ message: { content: "allow" }, logprobs: { content: [{ top_logprobs: [{ token: "allow", logprob: Math.log(0.6) }, { token: "warn", logprob: Math.log(0.3) }, { token: "lock", logprob: Math.log(0.1) }] }] } }] });
    } });
    const result = await judge.judge(input, new AbortController().signal);
    expect(result.decision).toBe("allow");
    expect(result.confidence).toBeCloseTo(0.6);
    expect(result.probabilities?.warn).toBeCloseTo(0.3);
    expect(result.probabilities?.lock).toBeCloseTo(0.1);
    const registry = createJudgeRegistry({ config: { ...defaultAdjudicationConfig, fastModel: "fast-model" }, fetch, now: () => 0, jev: {}, deepseek: { model: "deep" }, fastJudges: [judge] });
    expect(registry.fast("openai-compatible")).toBe(judge);
  });
  it("estimates fast probabilities with one-word samples when logprobs are unsupported", async () => {
    const choices = ["allow", "warn", "warn", "warn", "lock"];
    let calls = 0;
    const judge = createCompatibleFastJudge({ model: "sample-model", baseUrl: "https://example.invalid/v1", apiKey: "test-credential", config: { ...defaultAdjudicationConfig, fastSamplingCount: 5 }, now: () => 0, fetch: async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      calls += 1;
      if (body.logprobs) return new Response("unsupported", { status: 400 });
      expect(body).toMatchObject({ temperature: 1, max_tokens: 4 });
      expect(JSON.stringify(body)).not.toContain("test-credential");
      return Response.json({ model: "sample-model", choices: [{ message: { content: choices.shift() } }], usage: { prompt_tokens: 10, completion_tokens: 1 } });
    } });
    expect(await judge.judge(input, new AbortController().signal)).toMatchObject({ decision: "warn", confidence: 0.6, probabilities: { allow: 0.2, warn: 0.6, lock: 0.2 }, usage: { inputTokens: 50, outputTokens: 5 } });
    expect(calls).toBe(6);
  });
  it("excludes the temperature-zero capability response from sampling probabilities", async () => {
    const choices = ["warn", "warn", "lock"];
    const temperatures: number[] = [];
    const judge = createCompatibleFastJudge({ model: "sample-model", baseUrl: "https://example.invalid/v1", apiKey: "test-credential", config: { ...defaultAdjudicationConfig, fastSamplingCount: 3 }, now: () => 0, fetch: async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      temperatures.push(body.temperature);
      return Response.json({ model: "sample-model", choices: [{ message: { content: body.logprobs ? "allow" : choices.shift() } }], usage: { prompt_tokens: 10, completion_tokens: 1 } });
    } });
    expect(await judge.judge(input, new AbortController().signal)).toMatchObject({ decision: "warn", confidence: 2 / 3, probabilities: { allow: 0, warn: 2 / 3, lock: 1 / 3 }, usage: { inputTokens: 40, outputTokens: 4 } });
    expect(temperatures).toEqual([0, 1, 1, 1]);
  });
});

export { input };
