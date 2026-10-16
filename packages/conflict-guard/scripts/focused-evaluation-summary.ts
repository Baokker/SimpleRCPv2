import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import ts from "typescript";
import { calculateReplayMetrics, compareEvaluations, cacheKey, inputHash, latencySummary } from "../dist/index.js";

const repository = fileURLToPath(new URL("../../../", import.meta.url));
const evidence = path.join(repository, "docs/conflict-guard/evidence");
const output = path.join(evidence, "focused-evaluation-analysis");
const sources: Record<string, { path: string; sha256: string }> = {};
const sha = (bytes: Buffer | string) => createHash("sha256").update(bytes).digest("hex");
async function read(name: string, relative: string) {
  const bytes = await fs.readFile(path.join(evidence, relative));
  sources[name] = { path: path.relative(repository, path.join(evidence, relative)), sha256: sha(bytes) };
  return JSON.parse((relative.endsWith(".gz") ? gunzipSync(bytes) : bytes).toString());
}
const baseline = await read("pair-v1", "preexperiment/record/results.json.gz");
const second = await read("pair-v2", "exploratory-grey-pair-v2/results.json.gz");
const third = await read("pair-v3", "exploratory-grey-pair-v3/results.json.gz");
const human = await read("human", "focused-evaluation-human-dev/results.json.gz");
const reports = { "pair-v1": baseline, "pair-v2": second, "pair-v3": third };
const identity = (rows: any[]) => rows.map((row) => [row.id, row.relationGroupId, row.programHash, row.outcome.truth]).sort();
assert.equal(baseline.split, "dev");
assert.equal(human.split, "dev");
assert.deepEqual(identity(human.policies.P3.groups), identity(baseline.policies.P3.groups));
const greyIds = new Set(baseline.policies.P3.groups.filter((row: any) => row.result.judgements.some((item: any) => item.verdict.zone === "grey" && !item.verdict.localOnly)).map((row: any) => row.id));
const count = (values: string[]) => Object.fromEntries([...new Set(values)].sort().map((value) => [value, values.filter((item) => item === value).length]));
function quality(rows: any[]) {
  return {
    samples: rows.length,
    relationGroups: new Set(rows.map((row) => row.relationGroupId)).size,
    truth: count(rows.map((row) => row.outcome.truth)),
    confusion: Object.fromEntries(["allow", "warn", "lock"].map((truth) => [truth, count(rows.filter((row) => row.outcome.truth === truth).map((row) => row.outcome.decision))])),
    metrics: calculateReplayMetrics(rows.map((row) => row.outcome)),
    noJudgement: rows.filter((row) => row.result.judgements.length === 0).map((row) => ({ id: row.id, truth: row.outcome.truth, decision: row.outcome.decision, escaped: row.outcome.escaped }))
  };
}
const modelResults: Record<string, any> = {};
const comparison: Record<string, any[]> = {};
const greyComparison: Record<string, any[]> = {};
const cacheValidation: Record<string, number> = {};
const cacheIssues: Array<{ version: string; file: string; sha256: string; diagnostics: number }> = [];
const normalizedInputHashes: Record<string, string[]> = {};
const hasSyntaxDiagnostic = (text: string) => {
  const source = ts.createSourceFile("fragment.ts", text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  return (source as ts.SourceFile & { parseDiagnostics: readonly ts.Diagnostic[] }).parseDiagnostics.length > 0;
};
for (const [version, report] of Object.entries(reports)) {
  assert.equal(report.split, "dev");
  assert.equal(report.config.promptVersion, version);
  const policy = report.policies.G1;
  assert.deepEqual(identity(policy.groups), identity(baseline.policies.P3.groups));
  const directory = path.join(repository, "packages/conflict-guard/bench/model-cache", version === "pair-v1" ? "preexperiment" : `exploratory-grey-${version}`, "G1");
  const cacheNames = (await fs.readdir(directory)).filter((name) => name.endsWith(".json")).sort();
  const inputs: any[] = [];
  for (const name of cacheNames) {
    const contents = await fs.readFile(path.join(directory, name), "utf8");
    const parsed = ts.parseJsonText(name, contents) as ts.JsonSourceFile & { parseDiagnostics: readonly ts.Diagnostic[] };
    if (parsed.parseDiagnostics.length) {
      cacheIssues.push({ version, file: path.relative(repository, path.join(directory, name)), sha256: sha(contents), diagnostics: parsed.parseDiagnostics.length });
      continue;
    }
    const entry = JSON.parse(contents);
    assert.equal(entry.input.promptVersion, version);
    assert.equal(cacheKey(entry.input, entry.call.adapter, entry.call.model, entry.parameters), entry.key);
    assert.equal(name, `${entry.key}.json`);
    inputs.push(entry.input);
  }
  cacheValidation[version] = inputs.length;
  normalizedInputHashes[version] = inputs.map((input) => inputHash({ ...input, promptVersion: "pair-v1" })).sort();
  const grey = policy.groups.filter((row: any) => greyIds.has(row.id));
  comparison[version] = policy.groups;
  greyComparison[version] = grey;
  const completedCalls = policy.model.calls.filter((call: any) => call.status === "success");
  modelResults[version] = {
    all: quality(policy.groups),
    grey: quality(grey),
    tasks: policy.model.tasks,
    successfulTasks: policy.model.successful,
    completionRatio: policy.model.completionRatio,
    taskLatencyIncludingDeadlineMs: { p50: policy.model.p50Ms, p95: policy.model.p95Ms },
    httpCalls: policy.model.httpCalls,
    callStatus: count(policy.model.calls.map((call: any) => call.status)),
    successfulHttpLatencyMs: latencySummary(completedCalls.map((call: any) => call.latencyMs)),
    recordedCostUsd: policy.model.recordedCostUsd,
    usage: policy.model.usage,
    inputCoverage: {
      requests: inputs.length,
      afterFragmentSyntaxDiagnostics: inputs.filter((input) => hasSyntaxDiagnostic(input.left.after) || hasSyntaxDiagnostic(input.right.after)).length,
      emptyAfterFragment: inputs.filter((input) => !input.left.after.trim() || !input.right.after.trim()).length,
      noMergeOnlyDiagnostics: inputs.filter((input) => input.local?.typecheck?.ran && input.local.typecheck.mergeOnlyDiagnostics?.length === 0).length,
      missingTypecheck: inputs.filter((input) => !input.local?.typecheck?.ran).length
    },
    byOperatorFamily: policy.metrics.byOperatorFamily
  };
}
const humanResults = Object.fromEntries(["P0", "P1", "P2", "P3", "P*"].map((id) => [id, quality(human.policies[id].groups)]));
const humanRows = Object.fromEntries(["P0", "P1", "P2", "P3", "P*"].map((id) => [id, human.policies[id].groups]));
const sourceFiles = ["src/adjudication/prompts.ts", "src/adjudication/adapters.ts", "src/adjudication/minimax.ts", "scripts/model-runtime.ts", "scripts/model-cache-writer.ts", "scripts/focused-evaluation-summary.ts"];
const sourceHashes = Object.fromEntries(await Promise.all(sourceFiles.map(async (file) => [file, sha(await fs.readFile(path.join(repository, "packages/conflict-guard", file)))])));
const result = {
  status: "development-exploration",
  codeCommit: execFileSync("git", ["rev-parse", "HEAD"], { cwd: repository, encoding: "utf8" }).trim(),
  sourceHashes, sources, cacheValidation,
  cacheIntegrity: { complete: cacheIssues.length === 0, issues: cacheIssues },
  inputComparisonWithDefault: Object.fromEntries(Object.entries(normalizedInputHashes).map(([version, hashes]) => [version, cacheIssues.some((issue) => issue.version === version) ? null : JSON.stringify(hashes) === JSON.stringify(normalizedInputHashes["pair-v1"])])),
  sameInputsExceptPromptVersion: cacheIssues.length ? null : Object.values(normalizedInputHashes).every((hashes) => JSON.stringify(hashes) === JSON.stringify(normalizedInputHashes["pair-v1"])),
  scope: { dataset: "d1-v3", split: "dev", samples: baseline.policies.P3.groups.length, greySelection: "P3-grey-without-localOnly", greyIds: [...greyIds].sort(), modelNetworkCalls: 0 },
  human: humanResults,
  model: modelResults,
  statistics: { human: compareEvaluations(humanRows, 20261007), all: compareEvaluations(comparison, 20261007), grey: compareEvaluations(greyComparison, 20261007) }
};
await fs.mkdir(output, { recursive: true });
await fs.writeFile(path.join(output, "verification.json"), JSON.stringify(result, null, 2) + "\n");
const percentage = (value: number) => `${(100 * value).toFixed(1)}%`;
const lines = ["# 开发集统计核验", "", "全部回放样本与实际触发模型的灰区样本分别统计。没有 warn 真值，当前一致率不能证明提醒类别的识别能力。任务延迟含 8000 ms 超时终止值，不能据此证明有效回答的 p95 达标。", "", "| 提示词 | 灰区样本 | 灰区一致率 | 灰区漏阻断率 | 灰区误拦率 | 完成任务 | HTTP 成功/总数 |", "|---|---:|---:|---:|---:|---:|---:|"];
for (const [version, row] of Object.entries(modelResults)) lines.push(`| ${version} | ${row.grey.samples} | ${percentage(row.grey.metrics.agreement.value)} | ${percentage(row.grey.metrics.missBlockRatio.value)} | ${percentage(row.grey.metrics.falseBlockRatio.value)} | ${row.successfulTasks}/${row.tasks} | ${row.callStatus.success ?? 0}/${row.httpCalls} |`);
lines.push("", "全部模型调用、错误分类、Wilson 区间、关系组 bootstrap 区间、配对检验与 Holm 校正见 verification.json。统计种子 20261007，bootstrap 2000 次。不同提示词录制时间不同，HTTP 状态变化不能单独归因于提示词。", "");
if (cacheIssues.length) lines.push(`缓存完整性未通过：${cacheIssues.length} 个文件含 JSON 语法错误，原始文件保持原样。本表由各轮 results.json.gz 计算，不能据此宣称缓存回放可以完整复现。输入覆盖统计仅包含可解析缓存，错误文件的路径和哈希见 verification.json。`, "");
await fs.writeFile(path.join(output, "summary.md"), lines.join("\n"));
await fs.writeFile(path.join(output, "command.txt"), "pnpm --filter @simplercp/conflict-guard exec node --experimental-strip-types scripts/focused-evaluation-summary.ts\n");
console.log(JSON.stringify({ samples: result.scope.samples, greySamples: greyIds.size, cacheValidation, cacheIntegrityComplete: result.cacheIntegrity.complete, invalidCacheFiles: cacheIssues.length, modelNetworkCalls: 0 }));
