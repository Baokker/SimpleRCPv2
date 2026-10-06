import { choiceInstructions, choiceCriteria, deepInstructions, fastInstructions, sanitize } from "./prompts.js";
import { ProviderError, type AdjudicationConfig, type AdjudicationInput, type FastJudge, type DeepJudge, type JudgeResult } from "./types.js";

interface HttpOptions { apiKey?: string; baseUrl?: string; fetch: typeof fetch; now(): number; config: AdjudicationConfig }
const object = (value: unknown): Record<string, unknown> => { if (!value || typeof value !== "object" || Array.isArray(value)) throw new ProviderError("invalid-format"); return value as Record<string, unknown>; };
const string = (value: unknown) => { if (typeof value !== "string" || !value.trim() || value.length > 6000) throw new ProviderError("invalid-format"); return value; };
const probability = (value: unknown) => { if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) throw new ProviderError("invalid-format"); return value; };
const decision = (value: unknown): JudgeResult["decision"] => { if (value !== "allow" && value !== "warn" && value !== "lock") throw new ProviderError("invalid-format"); return value; };
function tokens(input: unknown, output: unknown) { if (typeof input !== "number" || typeof output !== "number" || !Number.isInteger(input) || !Number.isInteger(output) || input < 0 || output < 0) return undefined; return { inputTokens: input, outputTokens: output }; }

async function request(options: HttpOptions, url: string, body: unknown, signal: AbortSignal) {
  if (signal.aborted) throw new ProviderError("cancelled");
  if (!options.apiKey) throw new ProviderError("failed", "provider credential unavailable");
  try {
    const response = await options.fetch(url, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${options.apiKey}` }, body: JSON.stringify(sanitize(body, [options.apiKey])), signal });
    if (!response.ok) throw new ProviderError("failed", `provider HTTP ${response.status}`);
    const value = object(await response.json());
    if (signal.aborted) throw new ProviderError("cancelled");
    return sanitize(value, [options.apiKey]);
  } catch (error) {
    if (signal.aborted) throw new ProviderError("cancelled");
    if (error instanceof ProviderError) throw error;
    throw new ProviderError(error instanceof SyntaxError ? "invalid-format" : "failed");
  }
}

export function createJevJudge(options: HttpOptions): FastJudge {
  const model = options.config.fastModel;
  return { name: "jev", model, cacheParameters: { endpoint: options.baseUrl ?? "https://api.typesafe.ai", questionType: "choice" }, async judge(input: AdjudicationInput, signal) {
    const started = options.now();
    const raw = await request(options, `${(options.baseUrl ?? "https://api.typesafe.ai").replace(/\/$/, "")}/v1/systemone`, { model, state: input, questions: { decision: { type: "choice", instructions: choiceInstructions, criteria: choiceCriteria } } }, signal);
    if (raw.model !== model) throw new ProviderError("invalid-format", "provider model version mismatch");
    const answer = object(object(raw.answers).decision);
    if (answer.type !== "choice") throw new ProviderError("invalid-format");
    const probabilities = object(answer.probabilities);
    if (Object.keys(probabilities).sort().join(",") !== "allow,lock,warn") throw new ProviderError("invalid-format");
    const distribution = { allow: probability(probabilities.allow), warn: probability(probabilities.warn), lock: probability(probabilities.lock) };
    if (Math.abs(distribution.allow + distribution.warn + distribution.lock - 1) > 0.011) throw new ProviderError("invalid-format");
    const selected = decision(answer.choice);
    if (distribution[selected] < Math.max(...Object.values(distribution))) throw new ProviderError("invalid-format");
    const usage = raw.usage ? object(raw.usage) : {};
    return { decision: selected, confidence: probability(answer.confidence), probabilities: distribution, latencyMs: Math.max(0, options.now() - started), raw, usage: tokens(usage.input_tokens, usage.output_tokens) };
  } };
}

export function createDeepJudge(options: HttpOptions & { name: "deepseek" | "openai-compatible"; model: string }): DeepJudge {
  return { name: options.name, model: options.model, cacheParameters: { endpoint: options.baseUrl ?? "https://api.deepseek.com/v1", temperature: 0, response_format: { type: "json_object" }, thinking: options.name === "deepseek" }, async judge(input, { reasoning }, signal) {
    const started = options.now();
    const raw = await request(options, `${(options.baseUrl ?? "https://api.deepseek.com/v1").replace(/\/$/, "")}/chat/completions`, { model: options.model, temperature: 0, response_format: { type: "json_object" }, ...(options.name === "deepseek" ? { thinking: { type: reasoning ? "enabled" : "disabled" } } : {}), messages: [{ role: "system", content: deepInstructions }, { role: "user", content: JSON.stringify(input) }] }, signal);
    if (raw.model !== options.model) throw new ProviderError("invalid-format", "provider model version mismatch");
    if (!Array.isArray(raw.choices) || raw.choices.length !== 1) throw new ProviderError("invalid-format");
    const message = object(object(raw.choices[0]).message);
    let result: Record<string, unknown>;
    try { result = object(JSON.parse(string(message.content))); } catch { throw new ProviderError("invalid-format"); }
    const fields = ["decision", "riskLevel", "confidence", "summary", "evidence", "missingContext", "userExplanation", "suggestedAction"].sort();
    if (Object.keys(result).sort().join(",") !== fields.join(",") || !["low", "medium", "high"].includes(String(result.riskLevel)) || typeof result.missingContext !== "boolean" || !Array.isArray(result.evidence) || result.evidence.length > 20) throw new ProviderError("invalid-format");
    string(result.summary);
    const explanation = string(result.userExplanation);
    const action = string(result.suggestedAction);
    if (!/[\u4e00-\u9fff]/u.test(explanation) || !/[\u4e00-\u9fff]/u.test(action)) throw new ProviderError("invalid-format");
    const evidence = result.evidence.map((entry) => { const item = object(entry); if (Object.keys(item).sort().join(",") !== "path,reason,symbol") throw new ProviderError("invalid-format"); return { path: string(item.path), symbol: string(item.symbol), reason: string(item.reason) }; });
    const usage = raw.usage ? object(raw.usage) : {};
    return { decision: decision(result.decision), confidence: probability(result.confidence), evidence, userExplanation: explanation, suggestedAction: action, latencyMs: Math.max(0, options.now() - started), raw, usage: tokens(usage.prompt_tokens, usage.completion_tokens) };
  } };
}

export function createCompatibleFastJudge(options: HttpOptions & { model: string }): FastJudge {
  const samples = options.config.fastSamplingCount ?? 7;
  const parameters = { temperature: 0, max_tokens: 4, logprobs: true, top_logprobs: 20 };
  return { name: "openai-compatible", model: options.model, cacheParameters: { endpoint: options.baseUrl, ...parameters, samples, samplingTemperature: 1 }, async judge(input, signal) {
    const started = options.now();
    const url = `${options.baseUrl?.replace(/\/$/, "")}/chat/completions`;
    const messages = [{ role: "system", content: fastInstructions }, { role: "user", content: JSON.stringify(input) }];
    const sample = () => request(options, url, { model: options.model, temperature: 1, max_tokens: 4, messages }, signal);
    let raw: Record<string, unknown>;
    let sampledFirst = false;
    try { raw = await request(options, url, { model: options.model, ...parameters, messages }, signal); }
    catch (error) {
      if (!(error instanceof ProviderError) || !["provider HTTP 400", "provider HTTP 422"].includes(error.message)) throw error;
      raw = await sample();
      sampledFirst = true;
    }
    if (raw.model !== options.model || !Array.isArray(raw.choices) || raw.choices.length !== 1) throw new ProviderError("invalid-format");
    const choice = object(raw.choices[0]);
    const selected = decision(string(object(choice.message).content).trim());
    if (!choice.logprobs) return sampled(raw);
    const content = object(choice.logprobs).content;
    if (!Array.isArray(content) || content.length < 1) return sampled(raw);
    const alternatives = object(content[0]).top_logprobs;
    if (!Array.isArray(alternatives)) return sampled(raw);
    const mass = { allow: 0, warn: 0, lock: 0 };
    for (const alternative of alternatives) {
      const item = object(alternative);
      const token = typeof item.token === "string" ? item.token.trim() : "";
      if ((token === "allow" || token === "warn" || token === "lock") && typeof item.logprob === "number" && Number.isFinite(item.logprob) && item.logprob <= 0) mass[token] += Math.exp(item.logprob);
    }
    if (Object.values(mass).some((value) => value === 0)) return sampled(raw);
    const total = mass.allow + mass.warn + mass.lock;
    const probabilities = { allow: mass.allow / total, warn: mass.warn / total, lock: mass.lock / total };
    const usage = raw.usage ? object(raw.usage) : {};
    return { decision: selected, confidence: probabilities[selected], probabilities, latencyMs: Math.max(0, options.now() - started), raw, usage: tokens(usage.prompt_tokens, usage.completion_tokens) };
    async function sampled(first: Record<string, unknown>): Promise<JudgeResult> {
      const runs: Record<string, unknown>[] = sampledFirst ? [first] : [];
      for (let index = runs.length; index < samples; index += 1) runs.push(await sample());
      const counts = { allow: 0, warn: 0, lock: 0 };
      const usage = { inputTokens: 0, outputTokens: 0 };
      if (!sampledFirst) {
        const reported = first.usage ? object(first.usage) : {};
        const measured = tokens(reported.prompt_tokens, reported.completion_tokens);
        if (measured) { usage.inputTokens += measured.inputTokens; usage.outputTokens += measured.outputTokens; }
      }
      for (const run of runs) {
        if (run.model !== options.model || !Array.isArray(run.choices) || run.choices.length !== 1) throw new ProviderError("invalid-format");
        counts[decision(string(object(object(run.choices[0]).message).content).trim())] += 1;
        const reported = run.usage ? object(run.usage) : {};
        const measured = tokens(reported.prompt_tokens, reported.completion_tokens);
        if (measured) { usage.inputTokens += measured.inputTokens; usage.outputTokens += measured.outputTokens; }
      }
      const probabilities = { allow: counts.allow / samples, warn: counts.warn / samples, lock: counts.lock / samples };
      const selected = (["warn", "lock", "allow"] as const).reduce((best, candidate) => counts[candidate] > counts[best] ? candidate : best);
      return { decision: selected, confidence: probabilities[selected], probabilities, latencyMs: Math.max(0, options.now() - started), raw: { method: "one-word-sampling", temperature: 1, samples, ...(sampledFirst ? {} : { initial: first }), runs }, usage };
    }
  } };
}

export function createJudgeRegistry(options: { fetch: typeof fetch; now(): number; config: AdjudicationConfig; jev: { apiKey?: string; baseUrl?: string }; deepseek: { apiKey?: string; baseUrl?: string; model: string }; compatible?: { apiKey?: string; baseUrl: string; model: string }; fastJudges?: FastJudge[]; deepJudges?: DeepJudge[] }) {
  const fast = new Map<string, FastJudge>([["jev", createJevJudge({ ...options, ...options.jev })]]);
  const deep = new Map<string, DeepJudge>([["deepseek", createDeepJudge({ ...options, ...options.deepseek, name: "deepseek" })]]);
  if (options.compatible) {
    deep.set("openai-compatible", createDeepJudge({ ...options, ...options.compatible, name: "openai-compatible" }));
    fast.set("openai-compatible", createCompatibleFastJudge({ ...options, ...options.compatible }));
  }
  for (const judge of options.fastJudges ?? []) fast.set(judge.name, judge);
  for (const judge of options.deepJudges ?? []) deep.set(judge.name, judge);
  return { fast(name: string) { const judge = fast.get(name); if (!judge) throw new Error("快判适配器未注册"); return judge; }, deep(name: string) { const judge = deep.get(name); if (!judge) throw new Error("深判适配器未注册"); return judge; } };
}
