import type { ZoneVerdict } from "../routing/classifier.js";
import { cacheKey, inputHash, sanitize } from "./prompts.js";
import { validateAdjudicationConfig } from "./config.js";
import { ProviderError, type AdjudicationDependencies, type AdjudicationInput, type JudgeResult, type ProviderCall, type ProviderSubscription, type CachedCall } from "./types.js";

export function createAdjudicationService(options: AdjudicationDependencies) {
  const config = validateAdjudicationConfig(options.config);
  if (!["live", "record", "replay"].includes(options.mode)) throw new Error("录放模式无效");
  const inFlight = new Map<string, { promise: Promise<CachedCall>; controller: AbortController; subscribers: number; startedAt: number }>();
  const calls: ProviderCall[] = [];
  const subscriptions: ProviderSubscription[] = [];
  const occurrences = new Map<string, number>();
  const adjudicationLatencies: number[] = [];
  let escalations = 0; let judgements = 0; let requests = 0; let infrastructureFailures = 0;
  function reportError(stage: "trace" | "cache") { infrastructureFailures += 1; try { options.onError?.(stage); } catch { infrastructureFailures += 1; } }
  function emit(call: ProviderCall) { calls.push(call); try { options.onCall?.(call); } catch { reportError("trace"); } }
  function emitSubscription(subscription: ProviderSubscription) { subscriptions.push(subscription); try { options.onSubscription?.(subscription); } catch { reportError("trace"); } }
  function cost(result: JudgeResult | undefined, fast: boolean) {
    return result?.usage ? (result.usage.inputTokens * (fast ? config.prices.fastInputPerMillion : config.prices.deepInputPerMillion) + result.usage.outputTokens * (fast ? config.prices.fastOutputPerMillion : config.prices.deepOutputPerMillion)) / 1_000_000 : 0;
  }
  async function provider(input: AdjudicationInput, fast: boolean, signal: AbortSignal, budget: number, occurrence: number): Promise<CachedCall & { waitedMs?: number }> {
    if (signal.aborted) throw new ProviderError("cancelled");
    const judge = fast ? options.fast : options.deep;
    const parameters = { ...judge.cacheParameters, role: fast ? "fast" : "deep", reasoning: config.reasoning ?? false, hardDeadlineMs: config.hardDeadlineMs };
    const key = cacheKey(input, judge.name, judge.model, parameters);
    const base = { ...(input.point ? { point: input.point } : {}), role: fast ? "fast" as const : "deep" as const, adapter: judge.name, model: judge.model, promptVersion: input.promptVersion, inputHash: inputHash(input), cacheKey: key };
    const recorded = options.mode === "replay" ? options.recordedSubscriptions?.find((entry) => entry.inputHash === base.inputHash && entry.role === base.role && entry.occurrence === occurrence) : undefined;
    if (options.mode === "replay" && options.recordedSubscriptions) {
      const valid = recorded && recorded.cacheKey === key && recorded.adapter === judge.name && recorded.model === judge.model && recorded.promptVersion === input.promptVersion && Number.isFinite(recorded.latencyMs) && recorded.latencyMs >= 0 && Number.isFinite(recorded.budgetMs) && recorded.budgetMs > 0 && ["success", "cache-hit", "timeout", "failed", "invalid-format", "cancelled"].includes(recorded.status);
      if (!valid || !["success", "cache-hit"].includes(recorded.status)) {
        const call: ProviderCall = { ...base, status: valid ? recorded.status : "invalid-format", latencyMs: valid ? recorded.latencyMs : 0, costUsd: 0 };
        emitSubscription({ ...base, occurrence, budgetMs: valid ? recorded.budgetMs : budget, latencyMs: call.latencyMs, status: call.status });
        return { key, input, parameters, call, waitedMs: call.latencyMs };
      }
    }
    let shared = inFlight.get(key);
    if (shared?.controller.signal.aborted) shared = undefined;
    const joined = Boolean(shared);
    if (!shared) {
      const controller = new AbortController();
      const promise = execute();
      shared = { controller, promise, subscribers: 0, startedAt: options.clock.now() };
      inFlight.set(key, shared);
      void promise.finally(() => { if (inFlight.get(key)?.promise === promise) inFlight.delete(key); }).catch(() => undefined);
      async function execute(): Promise<CachedCall> {
        const started = options.clock.now();
        let timer: unknown;
        let abortListener: (() => void) | undefined;
        let entry: CachedCall;
        let completedResult: JudgeResult | undefined;
        const abortPromise = new Promise<never>((_resolve, reject) => {
          abortListener = () => reject(new ProviderError("cancelled"));
          controller.signal.addEventListener("abort", abortListener, { once: true });
        });
        const timeout = new Promise<never>((_resolve, reject) => { timer = options.clock.setTimeout(() => { reject(new ProviderError("timeout")); controller.abort(); }, config.hardDeadlineMs); });
        try {
          const cached = options.mode === "live" ? undefined : await Promise.race([options.cache?.get(key), timeout, abortPromise]);
          if (controller.signal.aborted) throw new ProviderError("cancelled");
          if (cached) {
            validateCachedCall(cached, key, input, judge.name, judge.model, parameters);
            const safe = sanitize(cached, options.sensitiveValues ?? []);
            const call = { ...safe.call, cacheKey: key, status: safe.result ? "cache-hit" as const : safe.call.status, costUsd: 0 };
            emit(call); return { ...safe, call };
          }
          if (options.mode === "replay") throw new ProviderError("failed", "provider replay cache miss");
          requests += 1;
          const request = fast ? options.fast.judge(input, controller.signal) : options.deep.judge(input, { reasoning: config.reasoning ?? false }, controller.signal);
          const result = sanitize(await Promise.race([request, timeout, abortPromise]), options.sensitiveValues ?? []);
          completedResult = result;
          const call: ProviderCall = { ...base, status: "success", latencyMs: result.latencyMs, decision: result.decision, confidence: result.confidence, usage: result.usage, costUsd: cost(result, fast) };
          entry = { key, input, parameters, result, call };
          if (options.mode === "record") {
            try { await Promise.race([options.cache?.put(sanitize(entry, options.sensitiveValues ?? [])), timeout, abortPromise]); }
            catch (error) { reportError("cache"); throw error; }
          }
        } catch (error) {
          const status = error instanceof ProviderError ? error.status : "failed";
          entry = { key, input, parameters, call: { ...base, status, latencyMs: options.mode === "replay" ? 0 : Math.max(0, options.clock.now() - started), usage: completedResult?.usage, costUsd: cost(completedResult, fast) } };
        } finally {
          options.clock.clearTimeout(timer);
          if (abortListener) controller.signal.removeEventListener("abort", abortListener);
        }
        if (options.mode === "record" && !entry.result && entry.call.status !== "cancelled") void options.cache?.put(sanitize(entry, options.sensitiveValues ?? [])).catch(() => reportError("cache"));
        emit(entry.call); return entry;
      }
    }
    shared.subscribers += 1;
    const current = shared;
    const subscribedAt = options.clock.now();
    return new Promise<CachedCall & { waitedMs?: number }>((resolve, reject) => {
      let finished = false;
      let timer: unknown;
      const finish = () => { if (finished) return false; finished = true; options.clock.clearTimeout(timer); signal.removeEventListener("abort", abort); current.subscribers -= 1; if (current.subscribers === 0) current.controller.abort(); return true; };
      const abort = () => { if (finish()) { emitSubscription({ ...base, occurrence, status: "cancelled", latencyMs: Math.max(0, options.clock.now() - subscribedAt), budgetMs: budget }); reject(new ProviderError("cancelled")); } };
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) { abort(); return; }
      if (subscribedAt + budget < current.startedAt + config.hardDeadlineMs) timer = options.clock.setTimeout(() => {
        if (!finish()) return;
        const call: ProviderCall = { ...base, status: "timeout", latencyMs: budget, costUsd: 0 };
        const entry = { key, input, parameters, call };
        emitSubscription({ ...base, occurrence, status: "timeout", latencyMs: budget, budgetMs: budget });
        resolve(entry);
      }, budget);
      current.promise.then((value) => {
        if (!finish()) return;
        const waitedMs = recorded?.latencyMs ?? (options.mode === "replay" ? value.call.latencyMs : joined && subscribedAt > current.startedAt && value.call.status !== "cache-hit" ? Math.max(0, options.clock.now() - subscribedAt) : Math.max(value.call.latencyMs, options.clock.now() - subscribedAt));
        emitSubscription({ ...base, occurrence, status: value.call.status, latencyMs: waitedMs, budgetMs: recorded?.budgetMs ?? budget });
        resolve({ ...value, waitedMs });
      }, () => { if (finish()) reject(new ProviderError("failed")); });
    });
  }

  async function judge(rawInput: AdjudicationInput, local: ZoneVerdict, signal: AbortSignal): Promise<ZoneVerdict> {
    if (local.zone !== "grey" || config.strategy === "G0") return local;
    if (signal.aborted) throw new ProviderError("cancelled");
    judgements += 1;
    const started = options.clock.now();
    const input = sanitize(config.point && config.point !== "T1" ? { ...rawInput, point: config.point, reasoning: config.reasoning ?? false } : rawInput, options.sensitiveValues ?? []);
    const hash = inputHash(input);
    const occurrence = (occurrences.get(hash) ?? 0) + 1;
    occurrences.set(hash, occurrence);
    const strategy = config.strategy === "G4" ? config.point === "T2" ? config.t2Strategy ?? "G1" : config.point === "T3" ? config.t3Strategy ?? "G1" : config.t1Strategy : config.strategy;
    let source: "fast" | "deep" = strategy === "G1" ? "deep" : "fast";
    let elapsed = 0; let escalated = false;
    const first = await provider(input, source === "fast", signal, config.hardDeadlineMs, occurrence);
    elapsed = first.waitedMs ?? first.call.latencyMs;
    let final = first;
    if (strategy === "G3" && (!first.result || first.result.confidence < config.threshold || first.result.decision === "lock")) {
      escalated = true; escalations += 1; source = "deep";
      const consumed = Math.max(elapsed, options.mode === "replay" ? 0 : options.clock.now() - started);
      if (consumed < config.hardDeadlineMs) { final = await provider(input, false, signal, config.hardDeadlineMs - consumed, occurrence); elapsed += final.waitedMs ?? final.call.latencyMs; }
      else final = { ...first, result: undefined, call: { ...first.call, status: "timeout" } };
    }
    if (signal.aborted) throw new ProviderError("cancelled");
    if (final.call.status === "timeout" && options.clock.now() - started >= config.hardDeadlineMs) elapsed = config.hardDeadlineMs;
    const result = Math.max(elapsed, options.mode === "replay" ? 0 : options.clock.now() - started) <= config.hardDeadlineMs ? final.result : undefined;
    const explanation = result?.userExplanation?.trim() ?? (result ? result.decision === "lock" ? "模型发现双方修改可能破坏共同使用的行为。" : result.decision === "allow" ? "模型认为双方修改可以共同继续。" : "模型建议双方检查关联修改的影响。" : "研判失败，已降级为警告。");
    const action = result?.suggestedAction ?? `请双方检查 ${input.left.symbol} 与 ${input.right.symbol} 的共同使用方式。`;
    adjudicationLatencies.push(Math.min(Math.max(elapsed, options.mode === "replay" ? 0 : options.clock.now() - started), config.hardDeadlineMs));
    return { ...local, decision: result?.decision ?? "warn", ruleId: result ? `model-${source}` : "model-unavailable", summary: explanation, evidence: result?.evidence?.map((item) => ({ file: item.path, symbol: item.symbol, detail: item.reason })) ?? local.evidence, adjudication: { ...(config.point ? { point: config.point } : {}), strategy: config.strategy, source: result ? source : "fallback", adapter: final.call.adapter, model: final.call.model, confidence: result?.confidence, latencyMs: Math.min(elapsed, config.hardDeadlineMs), status: result ? "success" : "degraded", escalated, userExplanation: explanation, suggestedAction: action, inputHash: inputHash(input), promptVersion: config.promptVersion } };
  }
  return { judge, calls: () => [...calls], subscriptions: () => [...subscriptions], stats() {
    const latency = [...adjudicationLatencies].sort((left, right) => left - right);
    const percentile = (p: number) => latency.length ? latency[Math.max(0, Math.ceil(latency.length * p) - 1)]! : 0;
    return { calls: requests, cacheHits: calls.filter((call) => call.status === "cache-hit").length, judgements, escalations, escalationRatio: judgements ? escalations / judgements : 0, p50Ms: percentile(0.5), p95Ms: percentile(0.95), failures: subscriptions.filter((call) => !["success", "cache-hit", "cancelled"].includes(call.status)).length, infrastructureFailures, costUsd: calls.reduce((total, call) => total + call.costUsd, 0) };
  }, dispose() { for (const request of inFlight.values()) request.controller.abort(); } };
}

function validateCachedCall(value: CachedCall, key: string, input: AdjudicationInput, adapter: string, model: string, parameters: Record<string, unknown>) {
  const call = value.call;
  const finite = (number: unknown) => typeof number === "number" && Number.isFinite(number) && number >= 0;
  const validDecision = (decision: unknown) => ["allow", "warn", "lock"].includes(String(decision));
  if (!call || value.key !== key || cacheKey(value.input, adapter, model, parameters) !== key || call.adapter !== adapter || call.model !== model || call.inputHash !== inputHash(input) || call.promptVersion !== input.promptVersion || !finite(call.latencyMs) || !finite(call.costUsd) || !["success", "timeout", "failed", "invalid-format", "cancelled"].includes(call.status)) throw new ProviderError("invalid-format");
  const result = value.result;
  if (!result) { if (call.status === "success") throw new ProviderError("invalid-format"); return; }
  if (call.status !== "success" || !validDecision(result.decision) || !finite(result.confidence) || result.confidence > 1 || !finite(result.latencyMs) || result.decision !== call.decision || result.confidence !== call.confidence || result.latencyMs !== call.latencyMs) throw new ProviderError("invalid-format");
  if (result.probabilities && (Object.keys(result.probabilities).sort().join(",") !== "allow,lock,warn" || Object.values(result.probabilities).some((number) => !finite(number) || number > 1) || Math.abs(Object.values(result.probabilities).reduce((sum, number) => sum + number, 0) - 1) > 0.011)) throw new ProviderError("invalid-format");
  if (result.evidence && (!Array.isArray(result.evidence) || result.evidence.some((entry) => !entry || [entry.path, entry.symbol, entry.reason].some((text) => typeof text !== "string" || !text.trim())))) throw new ProviderError("invalid-format");
  if ([result.userExplanation, result.suggestedAction].some((text) => text !== undefined && (typeof text !== "string" || !text.trim()))) throw new ProviderError("invalid-format");
}
