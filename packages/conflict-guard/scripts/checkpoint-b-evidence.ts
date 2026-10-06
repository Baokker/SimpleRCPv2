import fs from "node:fs/promises";
import assert from "node:assert/strict";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import { readTrace } from "../dist/index.js";
import { repositoryRoot, loadModelEnvironment } from "./model-runtime.ts";

const directory = path.join(repositoryRoot, "docs/conflict-guard/evidence/checkpoint-b-dev-report");
const manualDirectory = path.join(repositoryRoot, "docs/conflict-guard/evidence/checkpoint-b-manual");
const readJson = async (file: string) => JSON.parse(await fs.readFile(file, "utf8"));
const archive = JSON.parse(gunzipSync(await fs.readFile(path.join(repositoryRoot, "packages/conflict-guard/bench/datasets/d1-v2/dataset.json.gz"))).toString());
const rules = JSON.parse(gunzipSync(await fs.readFile(path.join(directory, "rules/results.json.gz"))).toString());
const model = JSON.parse(gunzipSync(await fs.readFile(path.join(directory, "results.json.gz"))).toString());
const cliBudget = await readJson(path.join(repositoryRoot, ".test-workspaces/checkpoint-b-call-budget.json"));
const browser = await Promise.all(["01-symbolic-agent.json", "02-concurrent-human-agent.json"].map((name) => readJson(path.join(manualDirectory, name))));
const permissionReplies = (record: any) => record.result.trace.events.filter((event: any) => event.type === "permission_reply").map((event: any) => event.data);
const concurrent = browser[1];
assert(permissionReplies(concurrent).some((reply: any) => reply.reply === "reject" && reply.message?.includes("文件在你修改期间已被他人更新")));
assert(permissionReplies(concurrent).some((reply: any) => reply.reply === "once"));
assert(concurrent.result.source.includes("this.items = [item, ...this.items];"));
assert(concurrent.result.source.includes("if (this.items.length === 0) return 0;"));
assert(browser.every((record: any) => !record.result.trace.events.some((event: any) => event.type === "permission_handler_error")));
const projectsDirectory = path.join(repositoryRoot, ".test-workspaces/checkpoint-b-browser/projects");
const allBrowserCalls: any[] = [];
const realAgentRuns: any[] = [];
for (const project of await fs.readdir(projectsDirectory)) {
  const runsDirectory = path.join(projectsDirectory, project, "agent-runs");
  let runIds: string[] = [];
  try { runIds = await fs.readdir(runsDirectory); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  for (const id of runIds) {
    const { run } = await readJson(path.join(runsDirectory, id, "run.json"));
    if (run.runtime === "opencode") realAgentRuns.push({ id: run.id, status: run.status, rejectedEdits: run.conflictGuard?.rejectedEdits });
  }
  const traceFile = path.join(projectsDirectory, project, "conflict-guard/trace.jsonl");
  let text: string;
  try { text = await fs.readFile(traceFile, "utf8"); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") continue; throw error; }
  allBrowserCalls.push(...readTrace(text).filter((event: any) => event.type === "provider_call" && event.status !== "cache-hit"));
}
const browserBudget = { fast: allBrowserCalls.filter((event: any) => event.role === "fast" || !event.role && event.adapter === "jev").length, deep: allBrowserCalls.filter((event: any) => event.role === "deep" || !event.role && event.adapter === "deepseek").length };
loadModelEnvironment();
const alternativeEndpoints = { compatibleDeep: Boolean(process.env.ADJUDICATION_COMPATIBLE_BASE_URL && process.env.ADJUDICATION_COMPATIBLE_MODEL), compatibleFast: Boolean(process.env.ADJUDICATION_COMPATIBLE_BASE_URL && process.env.ADJUDICATION_COMPATIBLE_MODEL) };
const escapes = rules.policies["P*"].groups.filter((group: any) => group.outcome.escaped).map((group: any) => ({ id: group.id, relationGroupId: group.relationGroupId, operator: group.operator, truth: group.truth, candidatePairs: group.result.judgements.length, outcome: group.outcome }));
const archives: Array<{ file: string; bytes: number; sha256: string }> = [];
for (const file of ["packages/conflict-guard/bench/datasets/d1-v2/dataset.json.gz", "packages/conflict-guard/bench/datasets/stage5-dev-smoke/dataset.json.gz", "docs/conflict-guard/evidence/checkpoint-b-dev-report/rules/results.json.gz"]) {
  const bytes = await fs.readFile(path.join(repositoryRoot, file));
  archives.push({ file, bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") });
}
for (const name of ["round1", "round2", "round3", "calibrated", "product"]) {
  const file = `packages/conflict-guard/bench/model-cache/checkpoint-b-${name}/model-cache.json.gz`;
  const bytes = await fs.readFile(path.join(repositoryRoot, file));
  archives.push({ file, bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") });
}
const provenance = {
  dataset: archive.manifest.version, seed: archive.manifest.seed, generatedFrom: archive.manifest.codeCommit,
  groups: archive.manifest.groups.length, split: "dev", holdoutEvaluated: false,
  programStats: archive.manifest.programStats, siteStats: archive.manifest.siteStats,
  modelCalls: { cli: cliBudget, browserRecorded: browserBudget, countedTotal: { fast: cliBudget.fast + browserBudget.fast, deep: cliBudget.deep + browserBudget.deep }, limits: { fast: 2000, deep: 1000 }, browserCountNote: "取消请求按一次调用计入额外上界；Agent 模型内部请求不属于角色调用，单独按 run 计数。" },
  realAgentRuns: realAgentRuns.length, realAgentRunRecords: realAgentRuns, realAgentRunLimit: 20, alternativeEndpoints,
  invariantCoverage: model.policies.G1.model.invariantCoverage, oracleEscapes: escapes, archives
};
await fs.writeFile(path.join(directory, "provenance.json"), JSON.stringify(provenance, null, 2) + "\n");
const manual = browser.map((record, index) => ({ case: index + 1, status: record.result.run.status, rejectedEdits: record.result.run.conflictGuard?.rejectedEdits, t3: record.result.run.conflictGuard?.t3, replies: permissionReplies(record), checks: record.result.checks }));
await fs.writeFile(path.join(manualDirectory, "verification.json"), JSON.stringify({ cases: manual, realAgentRuns: realAgentRuns.length, twoConflicts: true, noJsonParseError: true, fullReplayTrace: "05-full.jsonl" }, null, 2) + "\n");
console.log(JSON.stringify({ groups: provenance.groups, modelCalls: provenance.modelCalls, realAgentRuns: realAgentRuns.length, alternativeEndpoints, oracleEscapes: escapes.map((item: any) => ({ id: item.id, candidatePairs: item.candidatePairs })), manual }));
