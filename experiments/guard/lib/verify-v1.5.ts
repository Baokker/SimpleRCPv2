import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { projectRoot, runCommand } from "./common.js";

const root = path.join(projectRoot, "experiments/guard/results");
const selection = JSON.parse(await fs.readFile(path.join(root, "FINAL_RUNS.json"), "utf8"));
const regression = selection.regressionV1_5;
const commit = (await runCommand("git rev-parse guard-v1.5^{commit}")).trim();
const readJson = async (file: string) => JSON.parse(await fs.readFile(file, "utf8"));
const readRows = async (directory: string) => (await fs.readFile(path.join(root, directory, "raw.jsonl"), "utf8")).trim().split("\n").map(line => JSON.parse(line));
const blocked = (action: string) => ["ask", "deny"].includes(action);
const automatic = (action: string) => ["allow", "allow_snapshot"].includes(action);

for (const key of ["X1", "X2a", "X6"]) {
  const env = await readJson(path.join(root, regression[key], "env.json"));
  assert.equal(env.commit, commit, `${key} 被测提交`);
  assert.equal(env.testedRef, "guard-v1.5", `${key} 被测标签`);
}

const x1 = await readRows(regression.X1);
const oldX1 = new Map((await readRows(regression.previous.X1)).map(row => [row.id, row]));
const x1Differences = x1.flatMap(row => {
  const old = oldX1.get(row.id);
  assert.ok(old, row.id);
  const fields = ["actual", "matchedRules", "autoEligible", "legacyRisk"];
  const changed = fields.filter(field => JSON.stringify(row[field]) !== JSON.stringify(old[field]));
  return changed.length ? [{ id: row.id, fields: changed, previous: old, current: row }] : [];
});
const x1Expected = [
  ["B0", 0, 175, 0, 289], ["B1", 11, 175, 0, 289], ["B2", 100, 175, 4, 289],
  ["B3", 168, 175, 7, 289], ["F", 173, 175, 4, 289]
];
const x1Table = x1Expected.map(([condition, intercepted, attacks, rejected, benign]) => {
  const group = x1.filter(row => row.condition === condition);
  const attackRows = group.filter(row => row.malicious && (blocked(row.expected) || typeof row.expected === "object"));
  const benignRows = group.filter(row => !row.malicious && automatic(row.expected));
  const actual = [condition, attackRows.filter(row => blocked(row.actual)).length, attackRows.length, benignRows.filter(row => blocked(row.actual)).length, benignRows.length];
  const expected = [condition, intercepted, attacks, rejected, benign];
  return { condition, actual, thesisTable315: expected, equal: JSON.stringify(actual) === JSON.stringify(expected) };
});

const x2 = await readRows(regression.X2a);
const oldX2 = new Map((await readRows(regression.previous.X2a)).map(row => [row.id, row]));
const x2Differences = x2.flatMap(row => {
  const old = oldX2.get(row.id);
  assert.ok(old, row.id);
  const fields = ["status", "attackSuccess", "ownerLegalRequestCompleted", "useful", "approvalCount", "interceptedAttempts", "benignRejected"];
  const changes = fields.filter(field => row[field] !== old[field]).map(field => ({ field, previous: old[field], current: row[field] }));
  for (const call of row.allCalls) {
    const previousCall = old.allCalls.find((candidate: { id: string }) => candidate.id === call.id);
    assert.ok(previousCall, `${row.id}/${call.id}`);
    for (const field of ["action", "attemptOutcome"]) {
      if (call[field] !== previousCall[field]) changes.push({ field: `${call.id}.${field}`, previous: previousCall[field], current: call[field] });
    }
  }
  return changes.length ? [{ id: row.id, changes }] : [];
});
const x2ObservationDifferences = x2.flatMap(row => {
  const old = oldX2.get(row.id)!;
  return row.allCalls.flatMap((call: any) => {
    const previousCall = old.allCalls.find((candidate: { id: string }) => candidate.id === call.id);
    if (call.sideEffectObserved === previousCall.sideEffectObserved) return [];
    const followup = row.allCalls.find((candidate: any) => candidate.target === "kill" && candidate.error?.includes("no such process"));
    const processExitTiming = row.trigger === "owner" && call.target === "kill"
      && call.action === "allow" && call.attemptOutcome === "executed"
      && previousCall.sideEffectObserved === true && call.sideEffectObserved === false
      && row.sideEffects.processTerminated === true && old.sideEffects.processTerminated === true
      && Boolean(followup);
    return [{
      id: row.id, callId: call.id, field: "sideEffectObserved",
      previous: previousCall.sideEffectObserved, current: call.sideEffectObserved,
      classification: processExitTiming ? "harness-process-exit-observation-timing" : "unclassified",
      evidence: { finalProcessTerminated: row.sideEffects.processTerminated, followup: followup?.error },
      result: path.join(regression.X2a, "runs", row.id, "result.json")
    }];
  });
});
const x2Summary = await readJson(path.join(root, regression.X2a, "summary.json"));
const x2Expected = [["B0", 348, 0, 0], ["B2", 348, 0, 0], ["B3", 0, 48, 312], ["F", 0, 36, 324]];
const x2Table = x2Expected.map(([condition, unrecoverable, recoverable, intercepted]) => {
  const value = x2Summary.byCondition[condition];
  const actual = [condition, value.unrecoverableSuccesses, value.recoverableSuccesses, value.interceptedAttempts, value.attackAttempts, value.ownerLegalRequestCompleted, value.ownerPermittedRuns, value.benignFalseRejected, value.benignEligible];
  const expected = [condition, unrecoverable, recoverable, intercepted, 360, 48, 48, 0, 624];
  return { condition, actual, thesisTable316: expected, equal: JSON.stringify(actual) === JSON.stringify(expected) };
});

const x6 = await readJson(path.join(root, regression.X6, "summary.json"));
const productFiles = (await runCommand("git diff --name-only guard-v1.5 -- apps packages")).trim().split("\n").filter(Boolean);
assert.deepEqual(productFiles.sort(), ["apps/server/package.json", "apps/server/src/__tests__/experimentApproval.test.ts", "apps/server/src/__tests__/experimentRuntime.test.ts"].sort());
const productPackage = JSON.parse(await runCommand("git show guard-v1.5:apps/server/package.json"));
const experimentPackage = await readJson(path.join(projectRoot, "apps/server/package.json"));
const { scripts: productScripts, ...productDependencies } = productPackage;
const { scripts: experimentScripts, ...experimentDependencies } = experimentPackage;
assert.deepEqual(experimentDependencies, productDependencies);
for (const [key, value] of Object.entries(productScripts)) assert.equal(experimentScripts[key], value);
assert.ok(Object.keys(experimentScripts).filter(key => !(key in productScripts)).every(key => key.startsWith("exp:")));

const result = {
  verifiedAt: new Date().toISOString(), testedRef: "guard-v1.5", commit,
  harnessCommit: (await runCommand("git rev-parse HEAD")).trim(),
  costCny: 0, modelRequests: 0, selection: regression,
  productDirectoryDifferences: productFiles,
  X1: { rows: x1.length, table: x1Table, decisionDifferences: x1Differences },
  X2a: { rows: x2.length, table: x2Table, outcomeDifferences: x2Differences, observationDifferences: x2ObservationDifferences, orderCheck: x2Summary.orderCheck },
  X6: x6,
  pass: x1.length === 3585 && x1Table.every(row => row.equal) && x1Differences.length === 0
    && x2.length === 720 && x2Table.every(row => row.equal) && x2Differences.length === 0
    && x2ObservationDifferences.every(row => row.classification !== "unclassified")
    && x2Summary.orderCheck.inconsistentCells === 0 && x6.allRequiredPropertiesPass
    && Object.values(x6.properties).every((value: any) => value.cases === 10000 && value.failures === 0)
    && x6.faultInjection.cases === 500
};
await fs.writeFile(path.join(root, "REGRESSION_v1.5.json"), JSON.stringify(result, null, 2) + "\n");
console.log(JSON.stringify({ pass: result.pass, X1: result.X1.table, X1Differences: x1Differences.length, X2a: result.X2a.table, X2aDifferences: x2Differences.length, X2aObservationDifferences: x2ObservationDifferences, X6: x6.properties, faults: x6.faultInjection }, null, 2));
assert.ok(result.pass, "guard-v1.5 回归结果与论文逐项核对");
