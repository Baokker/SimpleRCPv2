import fs from "node:fs/promises";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { parseArgs } from "node:util";
import { calculateReplayMetrics, replayOutcome, replayTrace, createReplayModelPolicy, policyFor, inputHash, defaultAdjudicationConfig, validateAdjudicationConfig, compareEvaluations, type EvaluationRow, type AdjudicationConfig, type AdjudicationInput, type GreyStrategy, type ProviderMode, type ZoneVerdict, type ReplayGroupOutcome } from "../dist/index.js";
import { replayLibraries } from "./replay-libs.ts";
import { createModelRuntime, loadModelEnvironment } from "./model-runtime.ts";
import { developmentSamples } from "./model-dataset.ts";

const { values } = parseArgs({ args: process.argv.slice(2).filter((item) => item !== "--"), options: { dataset: { type: "string", default: "bench/datasets/d1-v1" }, out: { type: "string", default: "../../docs/conflict-guard/evidence/stage-5-dev-report" }, split: { type: "string", default: "dev" }, policy: { type: "string", default: "G0,P3,G1,G2,G3" }, repeat: { type: "string", default: "1" }, "provider-mode": { type: "string", default: "replay" }, threshold: { type: "string" }, deep: { type: "string" }, config: { type: "string" }, models: { type: "string" }, cache: { type: "string" } } });
if (values.split !== "dev") throw new Error("阶段五只允许开发集评价");
if (!["live", "record", "replay"].includes(values["provider-mode"]!)) throw new Error("provider-mode 无效");
const ids = values.policy!.split(",");
if (ids.some((id) => !["G0", "G1", "G2", "G3", "G4", "P3", "P*"].includes(id))) throw new Error("模型回放策略无效");
const repetitions = Number(values.repeat); if (!Number.isInteger(repetitions) || repetitions < 1) throw new Error("repeat 无效");
loadModelEnvironment();
const { manifest, samples } = await developmentSamples(path.resolve(values.dataset!));
const libs = await replayLibraries();
const suppliedConfig: AdjudicationConfig = values.config ? JSON.parse(await fs.readFile(path.resolve(values.config), "utf8")) : defaultAdjudicationConfig;
const config = validateAdjudicationConfig({ ...suppliedConfig, ...(values.deep ? { deep: values.deep } : {}), ...(values.threshold !== undefined ? { threshold: Number(values.threshold) } : {}) });
const models: Record<string, string> = values.models ? JSON.parse(await fs.readFile(path.resolve(values.models), "utf8")) : {};
if (!models || typeof models !== "object" || Array.isArray(models) || Object.entries(models).some(([adapter, model]) => !adapter.trim() || typeof model !== "string" || !model.trim())) throw new Error("录制模型版本无效");
const reports: Record<string, unknown> = {};
const comparisonRows: Record<string, EvaluationRow[]> = {};
const summary = ["# 开发集研判评价", "", `配置 ${config.version}；提示词 ${config.promptVersion}；阈值 ${config.threshold}；只使用开发集；缓存模式 ${values["provider-mode"]}。`, "", "| 策略 | 三分类一致率 | 漏阻断率 | 误阻断率 | 逃逸率 | 模型完成率 | p50/p95 ms | HTTP 调用 | token 合计 | 费用估算 USD |", "|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|"];
for (const id of ids) {
  const outcomes: ReplayGroupOutcome[] = []; const rows: unknown[] = [];
  const service = createModelRuntime({ ...config, strategy: id === "P3" || id === "P*" ? "G0" : id as GreyStrategy }, values["provider-mode"] as ProviderMode, values.cache ? path.join(path.resolve(values.cache), id) : undefined, undefined, models);
  const responses = new Map<string, ZoneVerdict>();
  const modelTasks: ZoneVerdict[] = [];
  const invariantInputs = new Map<string, AdjudicationInput>();
  comparisonRows[id] = [];
  for (const sample of samples) {
    const { group, variant, label, trace } = sample;
    const requests = new Map<string, { input: AdjudicationInput; local: ZoneVerdict }>();
    const contexts = Object.keys(variant.baseline);
    if (id !== "P3" && id !== "P*" && id !== "G0") {
      for (let pass = 0; ; pass += 1) {
        if (pass > trace.length) throw new Error("模型回放的输入集合未能稳定");
        requests.clear();
        replayTrace(trace, { policy: createReplayModelPolicy({ ...config, strategy: id as GreyStrategy }, responses, (input, local) => requests.set(inputHash(input), { input, local }), contexts), initialFiles: variant.baseline, libs, seed: group.seed });
        const missing = [...requests].filter(([hash]) => !responses.has(hash));
        for (const [hash, request] of requests) invariantInputs.set(hash, request.input);
        if (!missing.length) break;
        for (const [hash, request] of missing) responses.set(hash, await service.judge(request.input, request.local, new AbortController().signal));
      }
    }
    const policy = id === "P3" ? policyFor("P3") : id === "P*" ? policyFor("P*", { oracleTruth: label.label as "allow" | "warn" | "lock" }) : createReplayModelPolicy({ ...config, strategy: id as GreyStrategy }, responses, undefined, contexts);
    const result = replayTrace(trace, { policy, initialFiles: variant.baseline, libs, seed: group.seed });
    for (let repetition = 1; repetition < repetitions; repetition += 1) if (JSON.stringify(replayTrace(trace, { policy, initialFiles: variant.baseline, libs, seed: group.seed })) !== JSON.stringify(result)) throw new Error("录放结果重复不一致");
    const outcome = replayOutcome({ truth: label.label as "allow" | "warn" | "lock", variantKind: variant.kind, operatorFamily: group.operator.family, detectability: label.detectability, baseline: variant.baseline, merged: variant.merged, trace, result });
    outcomes.push(outcome);
    comparisonRows[id]!.push({ id: label.id, relationGroupId: group.id, outcome, modelLatenciesMs: result.judgements.flatMap((item) => item.verdict.adjudication ? [item.verdict.adjudication.latencyMs] : []) });
    modelTasks.push(...result.judgements.filter((item) => item.verdict.adjudication).map((item) => item.verdict));
    rows.push({ id: label.id, relationGroupId: group.id, project: group.project, operator: group.operator.id, programHash: sample.programHash, outcome, result: { ...result, events: undefined } });
  }
  const metrics = calculateReplayMetrics(outcomes);
  const latencies = modelTasks.map((verdict) => verdict.adjudication!.latencyMs).sort((left, right) => left - right);
  const percentile = (p: number) => latencies.length ? latencies[Math.max(0, Math.ceil(latencies.length * p) - 1)]! : 0;
  const successful = modelTasks.filter((verdict) => verdict.adjudication!.status === "success").length;
  const complete = modelTasks.length ? successful / modelTasks.length : null;
  const usage = service.calls().reduce((sum, call) => ({ inputTokens: sum.inputTokens + (call.usage?.inputTokens ?? 0), outputTokens: sum.outputTokens + (call.usage?.outputTokens ?? 0) }), { inputTokens: 0, outputTokens: 0 });
  const invariantCoverage = { inputs: invariantInputs.size, ...Object.fromEntries((["callers", "tests", "usage", "comments"] as const).map((field) => [field, { count: [...invariantInputs.values()].filter((input) => input.invariantCoverage?.[field]).length, ratio: invariantInputs.size ? [...invariantInputs.values()].filter((input) => input.invariantCoverage?.[field]).length / invariantInputs.size : null }])) };
  const model = { ...service.stats(), httpCalls: service.stats().calls, tasks: modelTasks.length, successful, completionRatio: complete, p50Ms: percentile(0.5), p95Ms: percentile(0.95), calls: service.calls(), usage: { ...usage, totalTokens: usage.inputTokens + usage.outputTokens }, invariantCoverage, recordedCostUsd: service.calls().reduce((sum, call) => sum + call.costUsd, 0) };
  reports[id] = { metrics, model, groups: rows, repeated: repetitions, inputHashes: [...responses.keys()].sort(), t03: complete === null ? null : { completion: complete >= 0.95, missed: metrics.missBlockRatio.value <= 0.1, falseBlocking: metrics.falseBlockRatio.value <= 0.15, agreement: metrics.agreement.value >= 0.8, median: percentile(0.5) <= 3000, p95: percentile(0.95) <= 8000 } };
  summary.push(`| ${id} | ${percent(metrics.agreement.value)} | ${percent(metrics.missBlockRatio.value)} | ${percent(metrics.falseBlockRatio.value)} | ${metrics.denominators.escapeRatio ? percent(metrics.escapeRatio.value) : "N/A"} | ${complete === null ? "N/A" : percent(complete)} | ${percentile(0.5).toFixed(0)}/${percentile(0.95).toFixed(0)} | ${service.stats().calls} | ${model.usage.totalTokens} | ${service.stats().costUsd.toFixed(6)} |`);
  service.dispose();
  console.log(JSON.stringify({ policy: id, samples: outcomes.length, modelTasks: modelTasks.length, completion: complete, calls: service.stats().calls }));
}
const output = path.resolve(values.out!); await fs.mkdir(output, { recursive: true });
const statistics = compareEvaluations(comparisonRows, manifest.seed);
const report = { dataset: manifest.version, split: "dev", seed: manifest.seed, config, providerMode: values["provider-mode"], repetitions, policies: reports, statistics };
await fs.writeFile(path.join(output, "results.json.gz"), gzipSync(JSON.stringify(report, null, 2) + "\n", { mtime: 0 }));
await fs.writeFile(path.join(output, "summary.md"), summary.join("\n") + "\n");
await fs.writeFile(path.join(output, "statistics.json"), JSON.stringify(statistics, null, 2) + "\n");
function percent(value: number) { return `${(value * 100).toFixed(1)}%`; }
