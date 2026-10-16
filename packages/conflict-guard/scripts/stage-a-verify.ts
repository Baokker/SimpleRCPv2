import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { inputHash, selectDevelopmentCandidate, type ProviderCall, type ZoneVerdict } from "../dist/index.js";
import { repositoryRoot } from "./model-runtime.ts";

const root = path.join(repositoryRoot, "docs/conflict-guard/experiment/v2/stage-A");
const read = async (file: string) => JSON.parse(gunzipSync(await fs.readFile(path.join(root, file))).toString());
const prepared = await read("prepared.json.gz");
const selection = JSON.parse(await fs.readFile(path.join(root, "selection-final.json"), "utf8"));
const human = JSON.parse(await fs.readFile(path.join(root, "human-comparison.json"), "utf8"));
const budget = JSON.parse(await fs.readFile(path.join(root, "call-budget.json"), "utf8"));
const ruleFile = "docs/conflict-guard/experiment/v2/selection-rule.md";
const registeredRule = execFileSync("git", ["show", `d4e735f:${ruleFile}`], { cwd: repositoryRoot });
assert.deepEqual(await fs.readFile(path.join(repositoryRoot, ruleFile)), registeredRule);
const common = new Set(selection.rows[0].groups.map((row: any) => row.id));
const additional = new Set(selection.additionalGrey);
const allGrey = new Set([...common, ...additional]);
assert.equal(prepared.groups.length, 119);
assert.equal(common.size, 61);
assert.equal(additional.size, 6);
assert.equal(selection.allGrey, allGrey.size);
const identifiers = prepared.groups.map((row: any) => row.id);
const thresholds = [0, 0.2, 0.4, 0.6, 0.8];
const directories = [...new Set(["pair-v4/G1", `${selection.prompt}/G1`, `${selection.prompt}/G2`, ...thresholds.map((value) => `${selection.prompt}/G3-${value}`)])];
const reports = new Map<string, any>();
let realDeep = 0;
let realFast = 0;
for (const directory of directories) {
  const report = await read(`${directory}/results.json.gz`);
  reports.set(directory, report);
  assert.equal(report.split, "dev");
  assert.deepEqual(report.groups.map((row: any) => row.id), identifiers);
  assert.deepEqual(report.sourceHashes, prepared.sourceHashes);
  assert.equal(report.responses.length, report.inputs.length);
  const incomplete = new Set<string>(report.inputs.filter((row: any) => row.input.syntax?.deferred).map((row: any) => inputHash(row.input)));
  assert.equal(incomplete.size, 124);
  const responses = new Map<string, ZoneVerdict>(report.responses);
  for (const key of incomplete) assert.equal(responses.get(key)?.ruleId, "syntax-incomplete-final");
  for (const call of report.model.calls as ProviderCall[]) assert.equal(incomplete.has(call.inputHash), false);
  if (report.mode === "replay") {
    assert.equal(report.model.cacheMisses, 0);
    assert.equal(report.model.calls.some((call: ProviderCall) => call.status === "success"), false);
  } else {
    assert.equal(report.model.calls.length, 70);
    const archive = await read(`${directory.split("/")[0]}/model-cache.json.gz`);
    for (const call of report.model.calls as ProviderCall[]) {
      const entry = JSON.parse(archive[`${call.role === "fast" ? "G2" : "G1"}/${call.cacheKey}.json`]);
      assert.deepEqual(entry.call, call);
    }
    realDeep += report.model.calls.filter((call: ProviderCall) => call.role === "deep").length;
    realFast += report.model.calls.filter((call: ProviderCall) => call.role === "fast").length;
  }
}
assert.equal(realDeep, budget.deep);
assert.equal(realFast, budget.fast);
const deep = reports.get(`${selection.prompt}/G1`);
const fast = reports.get(`${selection.prompt}/G2`);
const deepCalls = new Map<string, ProviderCall>(deep.model.calls.map((call: ProviderCall) => [call.inputHash, call]));
const fastCalls = new Map<string, ProviderCall>(fast.model.calls.map((call: ProviderCall) => [call.inputHash, call]));
let cascadeResponses = 0;
for (const threshold of thresholds) {
  const report = reports.get(`${selection.prompt}/G3-${threshold}`);
  for (const [hash, verdict] of report.responses as Array<[string, ZoneVerdict]>) {
    if (!verdict.adjudication) continue;
    const first = fastCalls.get(hash)!;
    const escalate = first.status !== "success" || first.confidence! < threshold || first.decision === "lock";
    const final = escalate ? deepCalls.get(hash)! : first;
    const elapsed = first.latencyMs + (escalate ? final.latencyMs : 0);
    const valid = final.status === "success" && elapsed <= report.config.hardDeadlineMs;
    assert.equal(verdict.adjudication.escalated, escalate);
    assert.equal(verdict.adjudication.status, valid ? "success" : "degraded");
    assert.equal(verdict.decision, valid ? final.decision : "warn");
    assert.equal(verdict.adjudication.latencyMs, Math.min(elapsed, report.config.hardDeadlineMs));
    cascadeResponses += 1;
  }
}
const historical = JSON.parse(gunzipSync(await fs.readFile(path.join(repositoryRoot, "docs/conflict-guard/evidence/preexperiment/record/results.json.gz"))).toString()).policies.G1;
for (const row of selection.rows) {
  const directory = row.id === "pair-v4 G1" ? "pair-v4/G1" : row.id.includes("完整声明") ? `${selection.prompt}/G1` : `${selection.prompt}/${row.id}`;
  const report = row.id === "pair-v1 G1" ? historical : reports.get(directory)!;
  const groups = report.groups.filter((group: any) => common.has(group.id));
  assert.equal(row.missed, groups.filter((group: any) => group.outcome.truth === "lock" && group.outcome.missed).length);
  assert.equal(row.falseBlockCount, groups.filter((group: any) => group.outcome.truth === "allow" && group.outcome.overblocked).length);
  assert.equal(row.safeWarningCount, groups.filter((group: any) => group.outcome.truth === "allow" && group.outcome.decision === "warn").length);
  assert.equal(row.agreement, groups.filter((group: any) => group.outcome.truth === group.outcome.decision).length / groups.length);
  for (const [name, identifiers] of [["common", common], ["additional", additional], ["all", allGrey]] as const) {
    const subset = report.groups.filter((group: any) => identifiers.has(group.id));
    const actual = row.qualitySubsets[name];
    assert.equal(actual.samples, identifiers.size);
    assert.equal(actual.relationGroups, new Set(subset.map((group: any) => group.relationGroupId)).size);
    assert.equal(actual.correct, subset.filter((group: any) => group.outcome.truth === group.outcome.decision).length);
    assert.equal(actual.agreement, actual.correct / actual.samples);
    assert.equal(actual.missed, subset.filter((group: any) => group.outcome.truth === "lock" && group.outcome.missed).length);
    assert.equal(actual.lockTruth, subset.filter((group: any) => group.outcome.truth === "lock").length);
    assert.equal(actual.falseBlockCount, subset.filter((group: any) => group.outcome.truth === "allow" && group.outcome.overblocked).length);
    assert.equal(actual.safeWarningCount, subset.filter((group: any) => group.outcome.truth === "allow" && group.outcome.decision === "warn").length);
    assert.equal(actual.safeTruth, subset.filter((group: any) => group.outcome.truth === "allow").length);
  }
}
const review = JSON.parse(await fs.readFile(path.join(root, "review-validation.json"), "utf8"));
assert.equal(review.modelCalls, 0);
assert.equal(review.samples, 119);
assert.equal(review.matchingInputs + review.missingInputs.length, review.currentInputs);
assert.equal(review.completeInputs + review.incompleteInputs, review.currentInputs);
assert.equal(review.inputs.length, review.currentInputs);
assert.equal(new Set(review.inputs.map((input: any) => input.hash)).size, review.currentInputs);
const recordedInputs = new Set(deep.inputs.map((entry: any) => inputHash(entry.input)));
for (const input of review.inputs) assert.equal(input.presentInRecording, recordedInputs.has(input.hash));
assert.deepEqual(review.missingInputs, review.inputs.filter((input: any) => !input.presentInRecording));
assert.equal(review.inputs.filter((input: any) => input.complete).length, review.completeInputs);
for (const [file, expected] of Object.entries(review.sourceHashes)) assert.equal(createHash("sha256").update(await fs.readFile(path.join(repositoryRoot, "packages/conflict-guard/src", file))).digest("hex"), expected, `当前输入核查来源变化：${file}`);
assert.ok(review.groups.find((group: any) => group.id === "d1-0026-conflict").judgements > 0);
assert.ok(review.groups.find((group: any) => group.id === "d1-0066-safe").closures.some((event: any) => event.reason === "no-semantic-change"));
assert.ok(review.groups.every((group: any) => group.closures.every((event: any) => typeof event.reason === "string")));
const curves = selection.rows.filter((row: any) => row.id.startsWith("G3-"));
assert.equal(selectDevelopmentCandidate(curves, "threshold").id, `G3-${selection.threshold}`);
const selectedDirectory = `${selection.prompt}/${selection.policy === "G3" ? `G3-${selection.threshold}` : selection.policy}`;
const selected = reports.get(selectedDirectory)!;
assert.equal(human.P4.groups, 119);
assert.equal(human.P4.unnotifiedWriteCount, selected.groups.filter((row: any) => row.outcome.escaped).length);
assert.equal(human.P4.frozenPersonSeconds, selected.groups.reduce((sum: number, row: any) => sum + row.outcome.frozenPersonSeconds, 0));
assert.ok(selected.groups.find((row: any) => row.id === "d1-0026-conflict").result.judgements.length > 0);
const packageRoot = path.join(repositoryRoot, "packages/conflict-guard");
const missingOutput = spawnSync(process.execPath, ["--experimental-strip-types", "scripts/stage-a-evaluate.ts", "--policy", "G2", "--prompt", selection.prompt, "--mode", "replay"], { cwd: packageRoot, encoding: "utf8" });
assert.equal(missingOutput.status, 1);
assert.ok(missingOutput.stderr.includes("通过 --out 指定独立结果目录"));
const logFile = path.join(root, selection.prompt, "G3-0", "calls.jsonl");
const originalLog = await fs.readFile(logFile);
const duplicate = spawnSync(process.execPath, ["--experimental-strip-types", "scripts/stage-a-evaluate.ts", "--policy", "G3", "--prompt", selection.prompt, "--mode", "replay", "--threshold", "0"], { cwd: packageRoot, encoding: "utf8" });
assert.equal(duplicate.status, 1);
assert.ok(duplicate.stderr.includes("结果调用日志已存在"));
assert.deepEqual(await fs.readFile(logFile), originalLog);
const verification = { split: "dev", samples: identifiers.length, commonGrey: common.size, additionalGrey: additional.size, allGrey: allGrey.size, completeInputs: 70, incompleteInputs: 124, cacheMisses: 0, cascadeResponses, review: { currentInputs: review.currentInputs, matchingInputs: review.matchingInputs, missingInputs: review.missingInputs.length, modelCalls: 0 }, calls: { deep: realDeep, fast: realFast }, selectionRuleCommit: "d4e735f", selectionRuleSha256: createHash("sha256").update(registeredRule).digest("hex"), checks: ["input-completeness", "budget", "cascade-deadline", "quality-counts", "quality-subsets", "selection", "human-metrics", "batch-close-judgement", "close-reasons", "current-input-compatibility", "output-protection"] };
await fs.writeFile(path.join(root, "verification.json"), JSON.stringify(verification, null, 2) + "\n");
console.log(JSON.stringify(verification));
