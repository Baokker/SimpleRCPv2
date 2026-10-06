import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";

const repository = path.resolve(fileURLToPath(new URL("../../../", import.meta.url)));
const script = path.join(repository, "packages/conflict-guard/scripts/experiment-freeze.ts");
const target = ".test-workspaces/checkpoint-c-export-check";
const options = { cwd: repository, encoding: "utf8" as const, maxBuffer: 4 * 1024 * 1024 };
const run = (verify = false) => execFileSync(process.execPath, ["--experimental-strip-types", script, "--out", target, ...(verify ? ["--verify"] : [])], options);
run();
run(true);
const original = path.join(repository, "docs/conflict-guard/experiment");
const repeated = path.join(repository, target);
const snapshot = JSON.parse(await fs.readFile(path.join(original, "freeze.json"), "utf8"));
for (const [file, expected] of Object.entries(snapshot.generated) as Array<[string, { sha256: string; bytes: number }]>) {
  const bytes = await fs.readFile(path.join(original, file));
  assert.equal(createHash("sha256").update(bytes).digest("hex"), expected.sha256);
  assert.equal(bytes.length, expected.bytes);
  assert.deepEqual(await fs.readFile(path.join(repeated, file)), bytes);
}
assert.deepEqual(await fs.readFile(path.join(repeated, "freeze.json")), await fs.readFile(path.join(original, "freeze.json")));
assert.equal(snapshot.audit.groups, 40);
assert.equal(snapshot.audit.fraction, 0.2);
assert.equal(snapshot.audit.perSplit.dev, 15);
assert.equal(snapshot.audit.perSplit.holdout, 25);
for (const sample of snapshot.audit.samples) {
  const programs = JSON.parse(await fs.readFile(path.join(original, "label-audit", sample.id, "programs.json"), "utf8"));
  const probes = JSON.parse(await fs.readFile(path.join(original, "label-audit", sample.id, "probe-results.json"), "utf8"));
  const labels = JSON.parse(await fs.readFile(path.join(original, "label-audit", sample.id, "automatic-labels.json"), "utf8"));
  assert.deepEqual(Object.keys(programs).sort(), sample.variants.toSorted());
  assert.deepEqual(Object.keys(probes).sort(), sample.variants.toSorted());
  assert.deepEqual(labels.map((label: { id: string }) => label.id).sort(), sample.variants.toSorted());
  for (const id of sample.variants) for (const state of ["baseline", "leftOnly", "rightOnly", "merged"]) {
    assert(programs[id][state]);
    assert.equal(probes[id][state].length, 3);
  }
}
const promptFile = path.join(repeated, "prompts.json");
const saved = await fs.readFile(promptFile);
await fs.writeFile(promptFile, "{}\n");
const corruption = spawnSync(process.execPath, ["--experimental-strip-types", script, "--out", target, "--verify"], options);
assert.notEqual(corruption.status, 0);
assert(corruption.stderr.includes("冻结材料内容不一致 prompts.json"));
await fs.writeFile(promptFile, saved);
run(true);
const verification = { codeCommit: snapshot.codeCommit, checks: { deterministicExport: true, byteHashes: true, auditFraction: true, independentReviewerTemplates: true, fourStatesThreeRuns: true, modifiedPromptRejected: true, archiveLabelsTracesChecked: true }, auditGroups: 40, generatedFiles: Object.keys(snapshot.generated).length + 1, modelCalls: 0, agentRuns: 0, holdoutPolicyEvaluations: 0 };
for (const reviewer of [1, 2]) {
  const sheet = JSON.parse(await fs.readFile(path.join(original, `label-audit/reviewer-${reviewer}.json`), "utf8"));
  assert(sheet.decisions.every((decision: { label: unknown; reason: string; notes: string }) => decision.label === null && decision.reason === "" && decision.notes === ""));
}
await fs.writeFile(path.join(repository, ".test-workspaces/checkpoint-c-verification.json"), JSON.stringify(verification, null, 2) + "\n");
console.log(JSON.stringify(verification));
