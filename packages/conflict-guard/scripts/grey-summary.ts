import fs from "node:fs/promises";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { parseArgs } from "node:util";
import { calculateReplayMetrics, compareEvaluations } from "../dist/index.js";

const { values } = parseArgs({ options: { record: { type: "string" }, out: { type: "string" }, plan: { type: "boolean", default: false } } });
if (!values.record || !values.out) throw new Error("指定 record 与 out");
if (values.plan) { console.log(JSON.stringify({ record: values.record, selection: "P3-model-request", executed: false, modelCalls: 0 })); process.exit(0); }
const bytes = await fs.readFile(path.resolve(values.record));
const report = JSON.parse((values.record.endsWith(".gz") ? gunzipSync(bytes) : bytes).toString());
if (!report.policies.P3) throw new Error("灰区子集报告需要同一数据的 P3 结果");
const ids = new Set(report.policies.P3.groups.filter((row: any) => row.result.judgements.some((judgement: any) => judgement.verdict.zone === "grey" && !judgement.verdict.localOnly)).map((row: any) => row.id));
const policies = Object.fromEntries(Object.entries(report.policies).filter(([id]) => /^G[1-4]$/.test(id)).map(([id, value]: [string, any]) => {
  const rows = value.groups.filter((row: any) => ids.has(row.id));
  return [id, { rows: rows.map((row: any) => ({ id: row.id, relationGroupId: row.relationGroupId, outcome: row.outcome })), metrics: calculateReplayMetrics(rows.map((row: any) => row.outcome)) }];
}));
if (!Object.keys(policies).length) throw new Error("报告没有模型策略");
const statistics = compareEvaluations(Object.fromEntries(Object.entries(policies).map(([id, value]) => [id, value.rows.map((row: any) => ({ id: row.id, relationGroupId: row.relationGroupId, outcome: row.outcome }))])), 20261007);
const output = path.resolve(values.out);
await fs.mkdir(output, { recursive: true });
await fs.writeFile(path.join(output, "verification.json"), JSON.stringify({ source: values.record, split: report.split, selection: "P3-grey-without-localOnly", sampleIds: [...ids].sort(), policies, statistics }, null, 2) + "\n");
const percentage = (value: number, denominator: number) => denominator ? `${(100 * value).toFixed(2)}%` : "N/A";
await fs.writeFile(path.join(output, "summary.md"), ["# 灰区子集质量", "", "子集由同一数据的 P3 实际研判触发确定，选择过程只读取本地结果。模型完成率、延迟与调用量见完整录制；本表报告该子集的程序级质量。", "", "| 策略 | 样本 | 一致率 | 漏阻断率 | 误阻断率 |", "|---|---:|---:|---:|---:|", ...Object.entries(policies).map(([id, row]) => `| ${id} | ${row.metrics.groups} | ${percentage(row.metrics.agreement.value, row.metrics.denominators.agreement)} | ${percentage(row.metrics.missBlockRatio.value, row.metrics.denominators.missBlockRatio)} | ${percentage(row.metrics.falseBlockRatio.value, row.metrics.denominators.falseBlockRatio)} |`), ""].join("\n"));
console.log(JSON.stringify({ greySamples: ids.size, policies: Object.keys(policies), modelCalls: 0 }));
