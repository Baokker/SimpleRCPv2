import { deepInstructions, sanitize } from "./prompts.js";
import { ProviderError, type AdjudicationInput, type DeepJudge, type JudgeResult } from "./types.js";

export interface MiniMaxOptions {
  apiKey?: string;
  baseUrl?: string;
  model: string;
  jsonMode?: boolean;
  temperature?: number;
  fetch: typeof fetch;
  now(): number;
}

export const miniMaxOutputInstruction = "只输出一个完整的 JSON 对象，首个字符为 {，末尾字符为 }。禁止使用 Markdown 和代码围栏，对象之前和之后不添加说明。decision 只允许字符串 allow、warn、lock；需要阻止修改时填写 lock。riskLevel 只允许 low、medium、high。严格保留规定的八个字段。";

export function miniMaxRequest(input: AdjudicationInput, model: string, reasoning: boolean, jsonMode = true, temperature = 0) {
  if (!reasoning && model !== "MiniMax-M3") throw new Error("关闭推理需要使用 MiniMax-M3");
  if (!Number.isFinite(temperature) || temperature < 0 || temperature > 2) throw new Error("MiniMax temperature 必须介于 0 与 2");
  return { model, temperature, n: 1, thinking: { type: reasoning ? "adaptive" : "disabled" }, reasoning_split: true, max_tokens: reasoning ? 4096 : 1024, ...(jsonMode ? { response_format: { type: "json_object" } } : {}), messages: [{ role: "system", content: `${deepInstructions}\n${miniMaxOutputInstruction}` }, { role: "user", content: JSON.stringify(input) }] };
}

export function parseMiniMaxResponse(raw: unknown, model: string, latencyMs: number): JudgeResult {
  const object = (value: unknown): Record<string, unknown> => {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new ProviderError("invalid-format");
    return value as Record<string, unknown>;
  };
  const text = (value: unknown) => {
    if (typeof value !== "string" || !value.trim() || value.length > 6000) throw new ProviderError("invalid-format");
    return value;
  };
  const response = object(raw);
  if (response.model !== model) throw new ProviderError("invalid-format", "provider model version mismatch");
  if (!Array.isArray(response.choices) || response.choices.length !== 1) throw new ProviderError("invalid-format");
  const choice = object(response.choices[0]);
  if (choice.finish_reason !== "stop") throw new ProviderError("invalid-format", "MiniMax 未完成判定输出");
  const message = object(choice.message);
  const content = text(message.content).replace(/<think>[\s\S]*?<\/think>/g, "").trim();
  let result: Record<string, unknown>;
  try { result = object(JSON.parse(content)); }
  catch (error) { if (error instanceof SyntaxError) throw new ProviderError("invalid-format"); throw error; }
  const fields = ["decision", "riskLevel", "confidence", "summary", "evidence", "missingContext", "userExplanation", "suggestedAction"].sort();
  if (Object.keys(result).sort().join(",") !== fields.join(",") || !["allow", "warn", "lock"].includes(String(result.decision)) || !["low", "medium", "high"].includes(String(result.riskLevel)) || typeof result.confidence !== "number" || !Number.isFinite(result.confidence) || result.confidence < 0 || result.confidence > 1 || typeof result.missingContext !== "boolean" || !Array.isArray(result.evidence) || result.evidence.length > 20) throw new ProviderError("invalid-format");
  text(result.summary);
  const userExplanation = text(result.userExplanation);
  const suggestedAction = text(result.suggestedAction);
  if (!/[\u4e00-\u9fff]/u.test(userExplanation) || !/[\u4e00-\u9fff]/u.test(suggestedAction)) throw new ProviderError("invalid-format");
  const evidence = result.evidence.map((value) => {
    const entry = object(value);
    if (Object.keys(entry).sort().join(",") !== "path,reason,symbol") throw new ProviderError("invalid-format");
    return { path: text(entry.path), symbol: text(entry.symbol), reason: text(entry.reason) };
  });
  const usage = response.usage ? object(response.usage) : {};
  const measured = [usage.prompt_tokens, usage.completion_tokens].every((value) => typeof value === "number" && Number.isInteger(value) && value >= 0);
  return { decision: result.decision as JudgeResult["decision"], confidence: result.confidence, evidence, userExplanation, suggestedAction, latencyMs, raw, ...(measured ? { usage: { inputTokens: usage.prompt_tokens as number, outputTokens: usage.completion_tokens as number } } : {}) };
}

export function createMiniMaxJudge(options: MiniMaxOptions): DeepJudge {
  const endpoint = options.baseUrl ?? "https://api.minimax.io/v1";
  const jsonMode = options.jsonMode ?? true;
  const temperature = options.temperature ?? 0;
  return { name: "minimax", model: options.model, cacheParameters: { endpoint, temperature, n: 1, outputInstruction: miniMaxOutputInstruction, reasoning_split: true, thinking: { disabled: "disabled", enabled: "adaptive" }, max_tokens: { disabled: 1024, enabled: 4096 }, ...(jsonMode ? { response_format: { type: "json_object" } } : {}) }, async judge(input, { reasoning }, signal) {
    if (signal.aborted) throw new ProviderError("cancelled");
    if (!options.apiKey) throw new ProviderError("failed", "provider credential unavailable");
    const started = options.now();
    const body = miniMaxRequest(input, options.model, reasoning, jsonMode, temperature);
    const response = await options.fetch(`${endpoint.replace(/\/$/, "")}/chat/completions`, { method: "POST", headers: { "content-type": "application/json", Authorization: `Bearer ${options.apiKey}` }, body: JSON.stringify(sanitize(body, [options.apiKey])), signal });
    if (!response.ok) throw new ProviderError("failed", `provider HTTP ${response.status}`);
    const raw = sanitize(await response.json(), [options.apiKey]);
    if (signal.aborted) throw new ProviderError("cancelled");
    return parseMiniMaxResponse(raw, options.model, Math.max(0, options.now() - started));
  } };
}
