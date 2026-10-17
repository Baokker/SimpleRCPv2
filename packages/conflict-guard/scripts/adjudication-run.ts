import fs from "node:fs/promises";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { parseArgs } from "node:util";
import { calculateReplayMetrics, replayOutcome, replayTrace, createReplayModelPolicy, policyFor, inputHash, defaultAdjudicationConfig, validateAdjudicationConfig, compareEvaluations, type EvaluationRow, type AdjudicationConfig, type AdjudicationInput, type GreyStrategy, type ProviderMode, type ProviderSubscription, type ZoneVerdict, type ReplayGroupOutcome } from "../dist/index.js";
import { replayLibraries } from "./replay-libs.ts";
import { createModelRuntime, loadModelEnvironment } from "./model-runtime.ts";
import { developmentSamples } from "./model-dataset.ts";
import { createExperimentBudget } from "./experiment-budget.ts";
import { escapeDifference, paretoPoints } from "../dist/replay/reporting.js";
import type { ModelProviderConfiguration } from "./model-providers.ts";

const { values } = parseArgs({ args: process.argv.slice(2).filter((item) => item !== "--"), options: { dataset: { type: "string", default: "bench/datasets/d1-v1" }, out: { type: "string", default: "../../docs/conflict-guard/evidence/stage-5-dev-report" }, split: { type: "string", default: "dev" }, policy: { type: "string", default: "G0,P3,G1,G2,G3" }, repeat: { type: "string", default: "1" }, "provider-mode": { type: "string", default: "replay" }, threshold: { type: "string" }, deep: { type: "string" }, config: { type: "string" }, models: { type: "string" }, providers: { type: "string" }, cache: { type: "string" }, subscriptions: { type: "string" }, experiment: { type: "string" }, ablation: { type: "string" }, k: { type: "string", default: "2" }, plan: { type: "boolean", default: false } } });
if (!["dev", "holdout"].includes(values.split!)) throw new Error("split 必须为 dev 或 holdout");
if (!["live", "record", "replay"].includes(values["provider-mode"]!)) throw new Error("provider-mode 无效");
const ids = values.policy!.split(",");
if (ids.some((id) => !["G0", "G1", "G2", "G3", "G3a", "G4", "P0", "P1", "P2", "P3", "P*"].includes(id))) throw new Error("模型回放策略无效");
if (values.ablation && !["no-four-state-typecheck", "no-invariants", "no-T0", "no-T3", "all-history"].includes(values.ablation)) throw new Error("消融条件无效");
if (![1, 2, 3].includes(Number(values.k))) throw new Error("k 必须为 1、2 或 3");
if (values.ablation && (ids.length !== 1 || ids[0] !== "G2")) throw new Error("消融使用冻结 G2 配置");
const repetitions = Number(values.repeat); if (!Number.isInteger(repetitions) || repetitions < 1) throw new Error("repeat 无效");
loadModelEnvironment();
const { manifest, samples } = await developmentSamples(path.resolve(values.dataset!), values.split as "dev" | "holdout");
if (values.plan) { console.log(JSON.stringify({ dataset: manifest.version, split: values.split, samples: samples.length, policies: ids, ablation: values.ablation, executed: false, modelCalls: 0 })); process.exit(0); }
if (values.split === "holdout" && !values.experiment) throw new Error("保留集评价必须指定实验编号并获得冻结确认");
const budget = values.experiment ? await createExperimentBudget(values.experiment) : undefined;
const libs = await replayLibraries();
const suppliedConfig: AdjudicationConfig = values.config ? JSON.parse(await fs.readFile(path.resolve(values.config), "utf8")) : defaultAdjudicationConfig;
const config = validateAdjudicationConfig({ ...suppliedConfig, ...(values.deep ? { deep: values.deep } : {}), ...(values.ablation === "no-invariants" ? { invariants: false } : {}), ...(values.threshold !== undefined ? { threshold: Number(values.threshold) } : {}) });
const replayOptions = { k: Number(values.k), ...(values.ablation === "no-four-state-typecheck" ? { disableFourState: true } : {}), ...(values.ablation === "no-T0" ? { enableT0: false } : {}), ...(values.ablation === "all-history" ? { retainHistory: true } : {}) };
const models: Record<string, string> = values.models ? JSON.parse(await fs.readFile(path.resolve(values.models), "utf8")) : {};
if (!models || typeof models !== "object" || Array.isArray(models) || Object.entries(models).some(([adapter, model]) => !adapter.trim() || typeof model !== "string" || !model.trim())) throw new Error("录制模型版本无效");
const recordedSubscriptions: Record<string, ProviderSubscription[]> | undefined = values.subscriptions ? JSON.parse(await fs.readFile(path.resolve(values.subscriptions), "utf8")) : undefined;
const providers: ModelProviderConfiguration = values.providers ? JSON.parse(await fs.readFile(path.resolve(values.providers), "utf8")) : {};
if (recordedSubscriptions && (values["provider-mode"] !== "replay" || typeof recordedSubscriptions !== "object" || Array.isArray(recordedSubscriptions) || Object.values(recordedSubscriptions).some((entries) => !Array.isArray(entries)))) throw new Error("订阅记录只能用于 replay 模式，并且必须按策略提供记录数组");
const reports: Record<string, { metrics: ReturnType<typeof calculateReplayMetrics>; model: { cacheMisses: number; providers: ModelProviderConfiguration } }> = {};
const comparisonRows: Record<string, EvaluationRow[]> = {};
const summary = [`# ${values.split === "dev" ? "开发集" : "保留集"}研判评价`, "", `配置 ${config.version}；提示词 ${config.promptVersion}；阈值 ${config.threshold}；缓存模式 ${values["provider-mode"]}。bootstrap 重复 2000 次，种子 20261007。${values.ablation === "no-T3" ? "D1 没有 Agent 任务完成后复检，本条件标记 N/A。" : ""}`, "", "| 策略 | 三分类一致率 | 漏阻断率 | 误阻断率 | 逃逸率 | 模型完成率 | p50/p95 ms | HTTP 调用 | token 合计 | 费用估算 USD |", "|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|"];
for (const id of ids) {
  const outcomes: ReplayGroupOutcome[] = []; const rows: unknown[] = [];
  const service = createModelRuntime({ ...config, strategy: id.startsWith("P") ? "G0" : id as GreyStrategy }, values["provider-mode"] as ProviderMode, values.cache ? path.join(path.resolve(values.cache), id) : undefined, undefined, models, recordedSubscriptions?.[id], budget, providers);
  const responses = new Map<string, ZoneVerdict>();
  const modelTasks: ZoneVerdict[] = [];
  const invariantInputs = new Map<string, AdjudicationInput>();
  comparisonRows[id] = [];
  for (const sample of samples) {
    const { group, variant, label, trace } = sample;
    const requests = new Map<string, { input: AdjudicationInput; local: ZoneVerdict }>();
    const contexts = Object.keys(variant.baseline);
    if (!id.startsWith("P") && id !== "G0") {
      for (let pass = 0; ; pass += 1) {
        if (pass > trace.length) throw new Error("模型回放的输入集合未能稳定");
        requests.clear();
        replayTrace(trace, { ...replayOptions, policy: createReplayModelPolicy({ ...config, strategy: id as GreyStrategy }, responses, (input, local) => requests.set(inputHash(input), { input, local }), contexts), initialFiles: variant.baseline, libs, seed: group.seed });
        const missing = [...requests].filter(([hash]) => !responses.has(hash));
        for (const [hash, request] of requests) invariantInputs.set(hash, request.input);
        if (!missing.length) break;
        for (const [hash, request] of missing) {
          if (id === "G3a") {
            let initial: ZoneVerdict | undefined;
            let final: ZoneVerdict | undefined;
            await service.judgeWithUpdates(request.input, request.local, new AbortController().signal, undefined, (verdict, update) => {
              if (update?.final === false) initial = verdict;
              else final = verdict;
            });
            responses.set(hash, initial ?? final!);
            if (initial && final) responses.set(`${hash}:deep`, final);
          } else responses.set(hash, await service.judge(request.input, request.local, new AbortController().signal));
        }
      }
    }
    const policy = id.startsWith("P") ? policyFor(id as "P0" | "P1" | "P2" | "P3" | "P*", { oracleTruth: label.label as "allow" | "warn" | "lock" }) : createReplayModelPolicy({ ...config, strategy: id as GreyStrategy }, responses, undefined, contexts);
    const result = replayTrace(trace, { ...replayOptions, policy, initialFiles: variant.baseline, libs, seed: group.seed });
    for (let repetition = 1; repetition < repetitions; repetition += 1) if (JSON.stringify(replayTrace(trace, { ...replayOptions, policy, initialFiles: variant.baseline, libs, seed: group.seed })) !== JSON.stringify(result)) throw new Error("录放结果重复不一致");
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
  const model = { ...service.stats(), providers: service.providerConfiguration, cacheMisses: values["provider-mode"] === "replay" ? service.cacheMisses() : 0, httpCalls: service.stats().calls, tasks: modelTasks.length, successful, completionRatio: complete, p50Ms: percentile(0.5), p95Ms: percentile(0.95), calls: service.calls(), subscriptions: service.subscriptions(), usage: { ...usage, totalTokens: usage.inputTokens + usage.outputTokens }, invariantCoverage, recordedCostUsd: service.calls().reduce((sum, call) => sum + call.costUsd, 0) };
  const policyReport = { metrics, model, groups: rows, repeated: repetitions, inputHashes: [...responses.keys()].sort(), t03: complete === null ? null : { completion: complete >= 0.95, missed: metrics.denominators.missBlockRatio === 0 ? null : metrics.missBlockRatio.value <= 0.1, falseBlocking: metrics.denominators.falseBlockRatio === 0 ? null : metrics.falseBlockRatio.value <= 0.15, agreement: metrics.denominators.agreement === 0 ? null : metrics.agreement.value >= 0.8, median: percentile(0.5) <= 3000, p95: percentile(0.95) <= 8000 } };
  reports[id] = policyReport;
  summary.push(`| ${id} | ${percent(metrics.agreement.value, metrics.denominators.agreement)} | ${percent(metrics.missBlockRatio.value, metrics.denominators.missBlockRatio)} | ${percent(metrics.falseBlockRatio.value, metrics.denominators.falseBlockRatio)} | ${percent(metrics.escapeRatio.value, metrics.denominators.escapeRatio)} | ${complete === null ? "N/A" : percent(complete)} | ${latencies.length ? `${percentile(0.5).toFixed(0)}/${percentile(0.95).toFixed(0)}` : "N/A"} | ${service.stats().calls} | ${model.usage.totalTokens} | ${service.stats().costUsd.toFixed(6)} |`);
  service.dispose();
  console.log(JSON.stringify({ policy: id, samples: outcomes.length, modelTasks: modelTasks.length, completion: complete, calls: service.stats().calls }));
}
const output = path.resolve(values.out!); await fs.mkdir(output, { recursive: true });
const statistics = compareEvaluations(comparisonRows, 20261007);
const report = { dataset: manifest.version, split: values.split, seed: manifest.seed, config, providerMode: values["provider-mode"], repetitions, experiment: values.experiment, ablation: values.ablation, replayOptions, policies: reports, statistics };
await fs.writeFile(path.join(output, "results.json.gz"), gzipSync(JSON.stringify(report, null, 2) + "\n"));
summary.push("", "## 配对显著性", "", "关系组全部有效变体正确时记为正确。同一实验内全部策略两两比较使用 Holm 校正。", "", "| 策略比较 | 关系组 | exact McNemar p | Holm p |", "|---|---:|---:|---:|");
for (const row of statistics.comparisons) summary.push(`| ${row.left} / ${row.right} | ${row.groups} | ${row.p.toPrecision(6)} | ${row.adjustedP.toPrecision(6)} |`);
const plot = paretoPoints(reports);
if (plot.excluded.length) summary.push("", `${plot.excluded.join("、")} 没有冲突真值，逃逸率及相对 P* 差值为 N/A，帕累托图跳过这些策略。`);
summary.push("", "| 策略 | 相对 P* 的逃逸率差值 | 回放缓存缺失 |", "|---|---:|---:|");
for (const [id, row] of Object.entries(reports)) summary.push(`| ${id} | ${escapeDifference(row.metrics, reports["P*"]?.metrics)} | ${row.model.cacheMisses} |`);
if (values.ablation && Object.values(reports).some((row) => row.model.cacheMisses > 0)) summary.push("", "此条件存在缓存缺失，质量变化不能归因于消融，结果标记为不可比较。");
await fs.writeFile(path.join(output, "summary.md"), summary.join("\n") + "\n");
await fs.writeFile(path.join(output, "statistics.json"), JSON.stringify(statistics, null, 2) + "\n");
await fs.writeFile(path.join(output, "verification.json"), JSON.stringify({ statistics, cacheMisses: Object.fromEntries(Object.entries(reports).map(([id, row]) => [id, row.model.cacheMisses])), ablationComparable: !Object.values(reports).some((row) => row.model.cacheMisses > 0), t3Applicable: values.ablation !== "no-T3" }, null, 2) + "\n");
await fs.writeFile(path.join(output, "config.json"), JSON.stringify({ config, models, providers: Object.fromEntries(Object.entries(reports).map(([id, report]) => [id, report.model.providers])), split: values.split, replayOptions, repetitions, ablation: values.ablation }, null, 2) + "\n");
await fs.writeFile(path.join(output, "command.txt"), `pnpm --filter @simplercp/conflict-guard replay:run ${process.argv.slice(2).join(" ")}\n`);
await fs.writeFile(path.join(output, "interruptions.svg"), `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="300"><rect width="480" height="300" fill="white"/><path d="M60 35V250H435" stroke="black" fill="none"/>${plot.points.map(({ id, x, y }) => `<circle cx="${x}" cy="${y}" r="5"/><text x="${x + 8}" y="${y - 6}">${id}</text>`).join("")}</svg>\n`);
function percent(value: number | null, denominator?: number) { return value === null || denominator === 0 ? "N/A" : `${(value * 100).toFixed(1)}%`; }
