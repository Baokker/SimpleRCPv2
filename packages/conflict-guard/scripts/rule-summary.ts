import fs from "node:fs/promises";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { parseArgs } from "node:util";
import { wilson } from "../dist/index.js";

const { values } = parseArgs({ options: { record: { type: "string" }, out: { type: "string" }, plan: { type: "boolean", default: false } } });
if (!values.record || !values.out) throw new Error("指定 record 与 out");
if (values.plan) { console.log(JSON.stringify({ record: values.record, policy: "P3", executed: false, modelCalls: 0 })); process.exit(0); }
const bytes = await fs.readFile(path.resolve(values.record));
const report = JSON.parse((values.record.endsWith(".gz") ? gunzipSync(bytes) : bytes).toString());
if (!report.policies.P3) throw new Error("报告缺少 P3 原始判定");
const rows = report.policies.P3.groups.flatMap((group: any) => group.result.pairs.filter((pair: any) => pair.final?.verdict).map((pair: any) => ({ id: group.id, relationGroupId: group.relationGroupId, pairId: pair.id, revision: pair.final.revision, ruleId: pair.final.verdict.ruleId, zone: pair.final.verdict.zone, decision: pair.final.verdict.decision, truth: group.outcome.truth, correct: pair.final.verdict.decision === group.outcome.truth, local: pair.final.verdict.zone !== "grey" || pair.final.verdict.localOnly === true })));
const rules = [...new Set<string>(rows.map((row: any) => row.ruleId))].sort().map((ruleId) => {
  const selected = rows.filter((row: any) => row.ruleId === ruleId);
  const correct = selected.filter((row: any) => row.correct).length;
  const revisionHits = report.policies.P3.groups.reduce((sum: number, row: any) => sum + row.result.judgements.filter((judgement: any) => judgement.verdict.ruleId === ruleId).length, 0);
  return { ruleId, finalPairs: selected.length, correct, precision: wilson(correct, selected.length), revisionHits };
});
const output = path.resolve(values.out);
await fs.mkdir(output, { recursive: true });
await fs.writeFile(path.join(output, "rules.json"), JSON.stringify({ source: values.record, split: report.split, rows, rules, precisionUnit: "final-pair-verdict-compared-with-program-truth" }, null, 2) + "\n");
await fs.writeFile(path.join(output, "summary.md"), ["# 本地规则命中与精确率", "", "每个变更对只计最终判定；同一程序中的多个变更对使用该程序的可执行真值，统计单位同时说明。所有 revision 的命中次数另列。无候选对程序保留在原始样本与无关系比例中。", "", "| 规则 | 最终变更对 | 正确 | 精确率 | revision 命中 |", "|---|---:|---:|---:|---:|", ...rules.map((row) => `| ${row.ruleId} | ${row.finalPairs} | ${row.correct} | ${(100 * row.precision.value).toFixed(2)}% | ${row.revisionHits} |`), ""].join("\n"));
console.log(JSON.stringify({ rules: rules.length, finalPairs: rows.length, modelCalls: 0 }));
