import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { lstatSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";

const repository = path.resolve(fileURLToPath(new URL("../../../", import.meta.url)));
const script = path.join(repository, "packages/conflict-guard/scripts/experiment-freeze.ts");
const target = ".test-workspaces/checkpoint-c-export-check";
const runtime = path.join(repository, ".test-workspaces/runtime");
await fs.mkdir(runtime, { recursive: true });
const options = { cwd: repository, encoding: "utf8" as const, maxBuffer: 4 * 1024 * 1024, env: { ...process.env, TMPDIR: runtime } };
const args = (verify = false, output = target) => ["--experimental-strip-types", script, "--out", output, ...(verify ? ["--verify"] : [])];
const run = (verify = false) => execFileSync(process.execPath, args(verify), options);
const rejected = (message: string, verify = false, output = target) => {
  const result = spawnSync(process.execPath, args(verify, output), options);
  assert.notEqual(result.status, 0);
  assert(result.stderr.includes(message), result.stderr);
};
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
try {
  await fs.writeFile(promptFile, "{}\n");
  rejected("冻结材料内容不一致 prompts.json", true);
} finally {
  await fs.writeFile(promptFile, saved);
}
run(true);
for (const reviewer of [1, 2]) {
  const file = `label-audit/reviewer-${reviewer}.template.json`;
  assert(snapshot.generated[file]);
  assert(!snapshot.generated[`label-audit/reviewer-${reviewer}.json`]);
  const sheet = JSON.parse(await fs.readFile(path.join(original, file), "utf8"));
  assert(sheet.decisions.every((decision: { label: unknown; reason: string; notes: string }) => decision.label === null && decision.reason === "" && decision.notes === ""));
}

const reviewerFile = path.join(repeated, "label-audit/reviewer-1.json");
const originalSheet = await fs.readFile(reviewerFile);
try {
  const sheet = JSON.parse(originalSheet.toString());
  const first = sheet.decisions[0];
  const automatic = JSON.parse(await fs.readFile(path.join(repeated, "label-audit", first.relationGroupId, "automatic-labels.json"), "utf8"));
  const label = automatic.find((entry: { id: string }) => entry.id === first.id);
  assert(label);
  first.label = label.label;
  first.reason = label.reason;
  first.notes = "人工表格保留功能的集成验证记录";
  sheet.decisions.reverse();
  const filled = JSON.stringify(sheet, null, 2) + "\n";
  await fs.writeFile(reviewerFile, filled);
  run();
  assert.equal(await fs.readFile(reviewerFile, "utf8"), filled);
  run(true);
  first.id = "unknown-audit-sample";
  await fs.writeFile(reviewerFile, JSON.stringify(sheet) + "\n");
  rejected("人工表格样本身份不一致");
  rejected("人工表格样本身份不一致", true);
} finally {
  await fs.writeFile(reviewerFile, originalSheet);
}

const recordings = JSON.parse(await fs.readFile(path.join(original, "model-recordings.json"), "utf8"));
assert.equal(Object.keys(recordings.entries).length, 197);
for (const policy of ["G1", "G2"]) {
  const recording = recordings.recordings.find((entry: { report: string; policy: string }) => entry.report.endsWith("real-round1/results.json.gz") && entry.policy === policy);
  assert.equal(recording.cacheFiles.length, 52);
  assert.equal(recording.subscriptions, null);
  for (const file of recording.cacheFiles) assert.deepEqual(recordings.entries[file], snapshot.artifacts[file]);
}
assert.equal(recordings.subscriptionCoverage, "missing-in-source");
const cacheFile = path.join(repository, recordings.recordings.find((entry: { policy: string }) => entry.policy === "G2").cacheFiles[1]);
const cacheWasPresent = Boolean(lstatSync(cacheFile, { throwIfNoEntry: false }));
const cacheArchive = path.join(repository, recordings.archives[0].file);
const cacheTexts = JSON.parse(gunzipSync(await fs.readFile(cacheArchive)).toString());
const cached = Buffer.from(cacheTexts[path.relative(path.dirname(cacheArchive), cacheFile)]);
await fs.mkdir(path.dirname(cacheFile), { recursive: true });
try {
  await fs.writeFile(cacheFile, Buffer.concat([cached, Buffer.from("\n")]));
  rejected("工作副本与归档不一致", true);
  await fs.rm(cacheFile);
  run(true);
} finally {
  if (cacheWasPresent) await fs.writeFile(cacheFile, cached);
  else await fs.rm(cacheFile, { force: true });
}
const manifestFile = path.join(repository, "packages/conflict-guard/bench/datasets/d1-v2/manifest.json");
const manifestWasPresent = Boolean(lstatSync(manifestFile, { throwIfNoEntry: false }));
const manifest = manifestWasPresent ? await fs.readFile(manifestFile) : undefined;
try {
  if (manifestWasPresent) await fs.rm(manifestFile);
  run(true);
} finally {
  if (manifest) await fs.writeFile(manifestFile, manifest);
}

const pathTests = await fs.mkdtemp(path.join(repository, ".test-workspaces/checkpoint-c-paths-"));
try {
  const outside = path.dirname(repository);
  const rootLink = path.join(pathTests, "directory-link");
  await fs.symlink(outside, rootLink, "dir");
  rejected("真实路径必须位于当前仓库", false, rootLink);
  for (const name of ["label-audit", "prompts.json"]) {
    const nested = path.join(pathTests, name === "label-audit" ? "nested-directory" : "nested-file");
    await fs.mkdir(nested);
    await fs.symlink(outside, path.join(nested, name), "dir");
    rejected("真实路径必须位于当前仓库", false, nested);
    assert.deepEqual(await fs.readdir(nested), [name]);
  }
  const dangling = path.join(pathTests, "dangling-link");
  await fs.symlink(path.join(pathTests, "missing"), dangling, "dir");
  rejected("ENOENT", false, dangling);
} finally {
  await fs.rm(pathTests, { recursive: true });
}
run(true);
const verification = { codeCommit: snapshot.codeCommit, checks: { deterministicExport: true, byteHashes: true, auditFraction: true, independentReviewerTemplates: true, reviewerDecisionsPreserved: true, filledReviewerAccepted: true, unknownReviewerSampleRejected: true, fourStatesThreeRuns: true, modifiedPromptRejected: true, archiveLabelsTracesChecked: true, completeModelCache: true, modifiedNonfirstCacheRejected: true, archiveOnlyInputsAccepted: true, outputSymlinksRejectedBeforeWrites: true, danglingSymlinkRejected: true, buildBeforeProductImport: true }, auditGroups: 40, cacheEntries: 197, generatedFiles: Object.keys(snapshot.generated).length + 1, modelCalls: 0, agentRuns: 0, holdoutPolicyEvaluations: 0 };
await fs.writeFile(path.join(repository, ".test-workspaces/checkpoint-c-verification.json"), JSON.stringify(verification, null, 2) + "\n");
console.log(JSON.stringify(verification));
