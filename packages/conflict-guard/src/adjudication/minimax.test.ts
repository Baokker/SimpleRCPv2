import fs from "node:fs/promises";
import { expect, it } from "vitest";
import { miniMaxRequest, parseMiniMaxResponse } from "./minimax.js";
import type { AdjudicationInput } from "./types.js";

const probe = JSON.parse(await fs.readFile(new URL("../../../../docs/conflict-guard/evidence/minimax-probe/probe.json", import.meta.url), "utf8"));
const inputs = JSON.parse(await fs.readFile(new URL("../../../../docs/conflict-guard/evidence/minimax-probe/inputs.json", import.meta.url), "utf8")) as AdjudicationInput[];

it("五个真实开发集灰区响应符合 MiniMax 判定格式", () => {
  const selected = probe.results.filter((result: { name: string }) => result.name.startsWith("development-grey-json-")).slice(-5);
  expect(selected).toHaveLength(5);
  for (const record of selected) {
    const result = parseMiniMaxResponse(record.response, "MiniMax-M3", record.latencyMs);
    expect(["allow", "warn", "lock"]).toContain(result.decision);
    expect(result.usage).toEqual({ inputTokens: record.response.usage.prompt_tokens, outputTokens: record.response.usage.completion_tokens });
    expect(result.userExplanation).toMatch(/[\u4e00-\u9fff]/u);
    expect(result.suggestedAction).toMatch(/[\u4e00-\u9fff]/u);
  }
});

it("MiniMax 请求使用独立输出约束、推理开关和 token 上限", () => {
  const disabled = miniMaxRequest(inputs[0]!, "MiniMax-M3", false);
  expect(disabled.thinking).toEqual({ type: "disabled" });
  expect(disabled).toMatchObject({ max_tokens: 1024, reasoning_split: true, temperature: 0, n: 1, response_format: { type: "json_object" } });
  expect(miniMaxRequest(inputs[0]!, "MiniMax-M3", true)).toMatchObject({ thinking: { type: "adaptive" }, max_tokens: 4096 });
  expect(() => miniMaxRequest(inputs[0]!, "MiniMax-M2.7", false)).toThrow("关闭推理需要使用 MiniMax-M3");
  expect(() => miniMaxRequest(inputs[0]!, "MiniMax-M3", false, true, -1)).toThrow("temperature");
});

it("真实响应的截断状态、版本不符与缺少字段均拒绝接受", () => {
  const record = probe.results.at(-1).response;
  expect(() => parseMiniMaxResponse(record, "MiniMax-M2.7", 0)).toThrow("version mismatch");
  const truncated = structuredClone(record); truncated.choices[0].finish_reason = "length";
  expect(() => parseMiniMaxResponse(truncated, "MiniMax-M3", 0)).toThrow("未完成判定输出");
  const missing = structuredClone(record);
  const data = JSON.parse(missing.choices[0].message.content); delete data.suggestedAction;
  missing.choices[0].message.content = JSON.stringify(data);
  expect(() => parseMiniMaxResponse(missing, "MiniMax-M3", 0)).toThrow("invalid-format");
});
