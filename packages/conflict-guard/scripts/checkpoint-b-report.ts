import fs from "node:fs/promises";
import path from "node:path";
import { gzipSync, gunzipSync } from "node:zlib";
import { compareEvaluations, wilson } from "../dist/index.js";
import { repositoryRoot } from "./model-runtime.ts";

const output = path.join(repositoryRoot, "docs/conflict-guard/evidence/checkpoint-b-dev-report");
const readReport = async (name: string) => JSON.parse(gunzipSync(await fs.readFile(path.join(output, name, "results.json.gz"))).toString());
const rounds = await Promise.all([1, 2, 3].map((round) => readReport(`real-round${round}`)));
const calibrated = await readReport("calibrated");
if ([...rounds, calibrated].some((report) => report.split !== "dev" || report.dataset !== "d1-v2")) throw new Error("报告只允许同一版本的开发集");
const policies = { G0: calibrated.policies.G0, P3: calibrated.policies.P3, "P*": calibrated.policies["P*"], G1: rounds[0].policies.G1, G2: rounds[0].policies.G2, G3: calibrated.policies.G3 };
const evaluations = Object.fromEntries(Object.entries(policies).map(([id, row]: [string, any]) => [id, row.groups.map((group: any) => ({ id: group.id, relationGroupId: group.relationGroupId, outcome: group.outcome, modelLatenciesMs: group.result.judgements.flatMap((item: any) => item.verdict.adjudication ? [item.verdict.adjudication.latencyMs] : []) }))]));
const statistics = compareEvaluations(evaluations, calibrated.seed);
const repetition = Object.fromEntries(["G1", "G2"].map((policy) => {
  const indexes = rounds.map((round) => new Map(round.policies[policy].groups.map((group: any) => [group.id, group])));
  const rows = [...indexes[0]].map(([id, value]: [unknown, any]) => {
    const values = indexes.map((index) => index.get(id) as any);
    if (values.some((row) => !row || row.programHash !== value.programHash)) throw new Error("真实重复的样本不一致");
    const decisions = values.map((row) => row.outcome.decision);
    return { id, relationGroupId: value.relationGroupId, decisions, identical: new Set(decisions).size === 1 };
  });
  const consistent = rows.filter((row) => row.identical).length;
  const calls = rounds.map((round) => round.policies[policy].model.calls.filter((call: any) => call.status === "success"));
  const inputDecisions = new Map<string, string[]>();
  for (const [round, records] of calls.entries()) for (const call of records) {
    const decisions = inputDecisions.get(call.inputHash) ?? Array(3).fill("");
    decisions[round] = call.decision; inputDecisions.set(call.inputHash, decisions);
  }
  const common = [...inputDecisions.values()].filter((values) => values.every(Boolean));
  const commonConsistent = common.filter((values) => new Set(values).size === 1).length;
  return [policy, { rounds: rounds.map((round) => ({ calls: round.policies[policy].model.httpCalls, completion: round.policies[policy].model.completionRatio, p50Ms: round.policies[policy].model.p50Ms, p95Ms: round.policies[policy].model.p95Ms, tokens: round.policies[policy].model.usage.totalTokens, costUsd: round.policies[policy].model.recordedCostUsd })), finalDecisionAgreement: { consistent, samples: rows.length, ratio: consistent / rows.length, interval: wilson(consistent, rows.length) }, commonInputAgreement: { consistent: commonConsistent, inputs: common.length, ratio: common.length ? commonConsistent / common.length : null }, rows }];
}));
const percent = (value: number) => `${(value * 100).toFixed(1)}%`;
const lines = ["# 检查点 B 开发集评价", "", "D1-v2；79 个去重样本。G1、G2 分别执行三轮独立 HTTP 调用，主表使用第一轮；G3 使用校准后的独立录制。比例的 Wilson 区间、关系组 bootstrap 区间、McNemar 与 Holm 校正见 statistics.json。", "", "| 策略 | 一致率 | 漏阻断率 | 误阻断率 | 逃逸率 | 完成率 | p50/p95 ms | HTTP 调用 | token 合计 | USD | 冻结人秒 | 无人处理上界人秒 |", "|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|"];
for (const [policy, row] of Object.entries(policies) as Array<[string, any]>) {
  const metric = row.metrics; const model = row.model;
  lines.push(`| ${policy} | ${percent(metric.agreement.value)} | ${percent(metric.missBlockRatio.value)} | ${percent(metric.falseBlockRatio.value)} | ${percent(metric.escapeRatio.value)} | ${model.completionRatio === null ? "N/A" : percent(model.completionRatio)} | ${model.p50Ms.toFixed(0)}/${model.p95Ms.toFixed(0)} | ${model.httpCalls} | ${model.usage.totalTokens} | ${model.recordedCostUsd.toFixed(6)} | ${metric.frozenPersonSeconds.toFixed(2)} | ${metric.unattendedFrozenPersonSeconds.toFixed(2)} |`);
}
lines.push("", "合成轨迹的冻结积分在最后一次编辑处截止；无人处理上界使用活跃修改十分钟超时。保留集只生成和标注，策略评价没有使用保留集。", "", "| 角色策略 | 三轮最终判定一致 | 相同模型输入的三轮判定一致 |", "|---|---:|---:|");
for (const [id, row] of Object.entries(repetition)) lines.push(`| ${id} | ${percent(row.finalDecisionAgreement.ratio)} (${row.finalDecisionAgreement.consistent}/${row.finalDecisionAgreement.samples}) | ${percent(row.commonInputAgreement.ratio ?? 0)} (${row.commonInputAgreement.consistent}/${row.commonInputAgreement.inputs}) |`);
lines.push("", "| 策略 | 完成率 ≥95% | 漏阻断 ≤10% | 误阻断 ≤15% | 一致率 ≥80% | p50 ≤3000 ms | p95 ≤8000 ms |", "|---|---|---|---|---|---|---|");
for (const [id, row] of Object.entries(policies) as Array<[string, any]>) if (row.t03) lines.push(`| ${id} | ${[row.t03.completion, row.t03.missed, row.t03.falseBlocking, row.t03.agreement, row.t03.median, row.t03.p95].map((value) => value ? "通过" : "未达到").join(" | ")} |`);
const families = ["# 按算子族评价", "", "| 策略 | 算子族 | 样本 | 一致率 | 漏阻断率 | 误阻断率 | 逃逸率 |", "|---|---|---:|---:|---:|---:|---:|"];
for (const [id, row] of Object.entries(policies) as Array<[string, any]>) for (const [family, metrics] of Object.entries(row.metrics.byOperatorFamily) as Array<[string, any]>) families.push(`| ${id} | ${family} | ${metrics.groups} | ${percent(metrics.agreement.value)} | ${metrics.denominators.missBlockRatio ? percent(metrics.missBlockRatio.value) : "N/A"} | ${metrics.denominators.falseBlockRatio ? percent(metrics.falseBlockRatio.value) : "N/A"} | ${metrics.denominators.escapeRatio ? percent(metrics.escapeRatio.value) : "N/A"} |`);
await fs.writeFile(path.join(output, "results.json.gz"), gzipSync(JSON.stringify({ ...calibrated, providerMode: "record", policies, statistics, repetition }, null, 2) + "\n", { mtime: 0 }));
await fs.writeFile(path.join(output, "summary.md"), lines.join("\n") + "\n");
await fs.writeFile(path.join(output, "statistics.json"), JSON.stringify(statistics, null, 2) + "\n");
await fs.writeFile(path.join(output, "real-repeatability.json"), JSON.stringify(repetition, null, 2) + "\n");
await fs.writeFile(path.join(output, "families.md"), families.join("\n") + "\n");
console.log(JSON.stringify({ samples: evaluations.G1.length, realRepetition: Object.fromEntries(Object.entries(repetition).map(([id, row]) => [id, row.finalDecisionAgreement])), coverage: policies.G1.model.invariantCoverage }));
