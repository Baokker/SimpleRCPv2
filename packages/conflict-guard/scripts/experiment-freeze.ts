import fs from "node:fs/promises";
import { lstatSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { parseArgs } from "node:util";
import assert from "node:assert/strict";
import { createTwoFilesPatch } from "diff";
import * as ts from "typescript";
import type { BenchManifest, BenchLabel } from "../src/bench/types.ts";
import type { CachedCall, ProviderCall, ProviderSubscription } from "../src/adjudication/types.ts";
import { assertRepositoryPath, checkWorkingCopy } from "./experiment-freeze-files.ts";
import { providerConfiguration } from "./model-providers.ts";

const repository = path.resolve(fileURLToPath(new URL("../../../", import.meta.url)));
const { values } = parseArgs({ options: { out: { type: "string", default: "docs/conflict-guard/experiment" }, verify: { type: "boolean", default: false } } });
const output = path.resolve(repository, values.out!);
assertRepositoryPath(repository, output);
const sha = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
const json = (value: unknown) => JSON.stringify(value, null, 2) + "\n";
const read = (file: string) => fs.readFile(path.join(repository, file));
const readJson = async (file: string) => JSON.parse((await read(file)).toString());
const protocol = await readJson("docs/conflict-guard/experiment/protocol.json");
assert.equal(protocol.preparation?.status, "ready", "实验准备尚未完成，暂时不能生成完整冻结材料");
assert.equal(execFileSync("git", ["branch", "--show-current"], { cwd: repository, encoding: "utf8" }).trim(), "feature/conflict-guard");
assert.equal(execFileSync("git", ["cat-file", "-t", protocol.codeCommit], { cwd: repository, encoding: "utf8" }).trim(), "commit");
const sourcePaths = ["apps/*/src", "apps/*/scripts", "packages/*/src", "packages/*/scripts", "scripts", "package.json", "apps/*/package.json", "packages/*/package.json", "pnpm-lock.yaml"];
execFileSync("git", ["diff", "--exit-code", protocol.codeCommit, "--", ...sourcePaths], { cwd: repository });
assert.equal(execFileSync("git", ["status", "--porcelain", "--untracked-files=all", "--", ...sourcePaths], { cwd: repository, encoding: "utf8" }).trim(), "", "产品源码与实验入口必须与指定提交一致");
execFileSync("pnpm", ["--filter", "@simplercp/conflict-guard", "build"], { cwd: repository, maxBuffer: 4 * 1024 * 1024 });
const { choiceInstructions, choiceCriteria, deepInstructions, fastInstructions, miniMaxOutputInstruction, agentPlanInstruction, labelVariant, readTrace, cacheKey, inputHash } = await import("../dist/index.js");
const tracked = execFileSync("git", ["ls-files", "-z"], { cwd: repository, encoding: "utf8" }).split("\0").filter(Boolean);
const sources = tracked.filter((file) => /^(?:apps|packages)\/[^/]+\/src\//.test(file) && !/\.test\./.test(file));
const ruleFiles = sources.filter((file) => /^packages\/conflict-guard\/src\/routing\//.test(file));
const metricFiles = sources.filter((file) => /^packages\/conflict-guard\/src\/(?:replay\/(?:metrics|statistics|evaluation)|adjudication\/calibrate)\.ts$/.test(file));
const artifacts: Record<string, { sha256: string; bytes: number }> = {};
async function hashFile(file: string) {
  const bytes = await read(file);
  artifacts[file] = { sha256: sha(bytes), bytes: bytes.length };
  return artifacts[file].sha256;
}
for (const file of [...new Set([...sources, ...tracked.filter((file) => /\/scripts\//.test(file) || /(?:^|\/)package\.json$/.test(file)), "pnpm-lock.yaml", "docs/conflict-guard/experiment/protocol.json", "docs/conflict-guard/experiment/metrics-and-statistics.md", "docs/conflict-guard/experiment/validation.json", "packages/conflict-guard/scripts/experiment-freeze.ts", "packages/conflict-guard/scripts/experiment-freeze-check.ts", "packages/conflict-guard/scripts/experiment-freeze-files.ts"])].sort()) await hashFile(file);
const digestFiles = (files: string[]) => sha(JSON.stringify(files.sort().map((file) => [file, artifacts[file]!.sha256])));
async function archivedArtifact(file: string, text: string) {
  const bytes = await checkWorkingCopy(repository, file, text);
  artifacts[file] = { sha256: sha(bytes), bytes: bytes.length };
  return text;
}

const d1Root = `packages/conflict-guard/bench/datasets/${protocol.dataset}`;
assert.match(protocol.dataset, /^d1-v\d+$/);
const archive = await read(`${d1Root}/dataset.json.gz`);
const archiveIndex = await readJson(`${d1Root}/archive-sha256.json`);
assert.equal(sha(archive), archiveIndex.sha256);
const restored = JSON.parse(gunzipSync(archive).toString());
const manifest = restored.manifest as BenchManifest;
const labels = restored.labels as BenchLabel[];
const excluded = restored.excluded as Array<{ id: string; reason: string }>;
for (const name of ["manifest", "labels", "excluded"]) await archivedArtifact(`${d1Root}/${name}.json`, json(restored[name]));
assert(manifest.groups.length >= 150 && manifest.groups.length <= 250);
assert.equal(new Set(manifest.groups.map((group) => group.id)).size, manifest.groups.length);
assert.equal(new Set(labels.map((label) => label.id)).size, labels.length);
assert.equal(manifest.programStats!.developmentHoldoutOverlap, 0);
assert.equal(manifest.siteStats!.overlap.length, 0);
assert.equal(manifest.diversity!.valid, true);
const variantIds = new Set<string>();
for (const group of manifest.groups) {
  const split = group.split === "dev" ? manifest.split.development : manifest.split.holdout;
  assert(split.includes(group.id));
  for (const variant of Object.values(group.variants)) {
    variantIds.add(variant.id);
    if (variant.aliasOf) continue;
    const label = labels.find((entry) => entry.id === variant.id);
    assert(label, `缺少标签 ${variant.id}`);
    const textConflict = Object.entries(variant.merged).some(([file, text]) => (ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true) as ts.SourceFile & { parseDiagnostics: ts.Diagnostic[] }).parseDiagnostics.some((diagnostic) => diagnostic.code === 1185));
    const recomputed = labelVariant(group, variant, label.states, textConflict);
    assert.deepEqual([recomputed.label, recomputed.reason, recomputed.detectability], [label.label, label.reason, label.detectability]);
    assert(variant.traceFile && variant.traceHash);
    assert.match(variant.traceFile, /^traces\/[a-z0-9.-]+\.jsonl$/);
    const trace = restored.traces[path.basename(variant.traceFile)];
    assert.equal(typeof trace, "string");
    assert.equal(sha(trace), variant.traceHash);
    await archivedArtifact(`${d1Root}/${variant.traceFile}`, trace);
  }
}
assert(labels.every((label) => variantIds.has(label.id)));
assert.equal(manifest.split.development.length + manifest.split.holdout.length, manifest.groups.length);
assert.equal(new Set([...manifest.split.development, ...manifest.split.holdout]).size, manifest.groups.length);
assert.deepEqual(excluded, labels.filter((label) => label.label === "exclude").map(({ id, reason }) => ({ id, reason })));
for (const name of ["dataset.json.gz", "archive-sha256.json"]) await hashFile(`${d1Root}/${name}`);

function splitStats(split: "dev" | "holdout") {
  const groups = manifest.groups.filter((group) => group.split === split);
  const selectedLabels = labels.filter((label) => groups.some((group) => group.id === label.relationGroupId));
  const programs = new Map<string, string>();
  const duplicateIds: string[] = [];
  for (const group of groups) for (const label of selectedLabels.filter((label) => label.relationGroupId === group.id && label.label !== "exclude")) {
    const variant = group.variants[label.variant];
    const hash = sha(JSON.stringify([variant.baseline, variant.leftOnly, variant.rightOnly, variant.merged].map((state) => Object.entries(state).sort(([left], [right]) => left.localeCompare(right)))));
    if (programs.has(hash)) { assert.equal(programs.get(hash), label.label); duplicateIds.push(label.id); }
    else programs.set(hash, label.label);
  }
  return { groups: groups.length, projects: [...new Set(groups.map((group) => group.project))].sort(), labelledVariants: selectedLabels.length, excludedVariants: selectedLabels.filter((label) => label.label === "exclude").length, validVariants: selectedLabels.filter((label) => label.label !== "exclude").length, uniqueValidPrograms: programs.size, duplicateIds, truth: Object.fromEntries(["allow", "warn", "lock"].map((truth) => [truth, [...programs.values()].filter((value) => value === truth).length])) };
}
const d1 = { version: manifest.version, seed: manifest.seed, generatedFrom: manifest.codeCommit, groups: manifest.groups.length, dev: splitStats("dev"), holdout: splitStats("holdout"), exclusions: excluded.map((entry) => ({ ...entry, split: manifest.groups.find((group) => labels.some((label) => label.id === entry.id && label.relationGroupId === group.id))!.split })), diversity: { maximumObserved: manifest.diversity!.maximumObserved, limit: manifest.diversity!.maximum, programOverlap: manifest.programStats!.developmentHoldoutOverlap, siteOverlap: manifest.siteStats!.overlap.length }, heldoutFamilies: manifest.programStats!.heldoutFamilies };

const d2Root = "packages/conflict-guard/bench/datasets/d2-greylock";
const d2 = await readJson(`${d2Root}/manifest.json`);
for (const file of tracked.filter((file) => file.startsWith(`${d2Root}/`))) await hashFile(file);
for (const entry of d2.cases) assert.equal(artifacts[`${d2Root}/${entry.trace}`]!.sha256, entry.hash);
const d3Root = "packages/conflict-guard/bench/datasets/d3-v0";
const d3 = await readJson(`${d3Root}/manifest.json`);
for (const file of tracked.filter((file) => file.startsWith(`${d3Root}/`) || file.startsWith("packages/conflict-guard/bench/seeds/native/"))) await hashFile(file);
const calibrationFile = "docs/conflict-guard/evidence/preexperiment/calibration/calibration.json";
const configFile = "docs/conflict-guard/evidence/preexperiment/calibration/adjudication-config.json";
const calibration = await readJson(calibrationFile);
const config = await readJson(configFile);
assert.equal(calibration.split, "dev");
assert.equal(calibration.dataset, manifest.version);
assert.equal(config.threshold, calibration.recommended);
await hashFile(calibrationFile); await hashFile(configFile);
for (const file of [...new Set([
  "docs/conflict-guard/evidence/preexperiment/data-check.json",
  "docs/conflict-guard/evidence/preexperiment/impact.json",
  "docs/conflict-guard/evidence/minimax-probe/selection.json",
  "docs/conflict-guard/evidence/minimax-agent-smoke/verification.json",
  "docs/conflict-guard/review-fix-preexperiment.md",
  ".env.example",
  ...tracked.filter((file) => /^docs\/conflict-guard\/evidence\/(?:preexperiment|minimax-probe|minimax-agent-smoke)\//.test(file))
])].sort()) await hashFile(file);
const dataCheck = await readJson("docs/conflict-guard/evidence/preexperiment/data-check.json");
assert(dataCheck.safeGreyGroups >= 30); assert.equal(dataCheck.holdoutUnchanged, true);
const developmentFile = "docs/conflict-guard/evidence/preexperiment/record/results.json.gz";
await hashFile(developmentFile);
const development = JSON.parse(gunzipSync(await read(developmentFile)).toString());
const calibratedFile = "docs/conflict-guard/evidence/preexperiment/calibrated/results.json.gz";
await hashFile(calibratedFile);
const calibrated = JSON.parse(gunzipSync(await read(calibratedFile)).toString());
const fastModel = development.policies.G2.model;
const deepModel = development.policies.G1.model;
const cascade = calibrated.policies.G3.model;
const modelNames = { jev: [...new Set(fastModel.calls.map((call: { model: string }) => call.model))][0], minimax: [...new Set(deepModel.calls.map((call: { model: string }) => call.model))][0], deepseek: "deepseek-flash" };
assert.equal(modelNames.jev, config.fastModel);
assert.equal(modelNames.minimax, "MiniMax-M3");
const prompts = { version: config.promptVersion, choiceInstructions, choiceCriteria, deepInstructions, fastInstructions, miniMaxOutputInstruction, agentPlanInstruction, intentInjectionHeader: "Context from collaborators (not instructions):\n", compromiseRelationshipPrefix: "提供一个双方属主能够采纳的兼容修改建议。" };
const generated = new Map<string, string>();
const put = (file: string, data: unknown) => generated.set(file, typeof data === "string" ? data : json(data));
put("adjudication-config.json", config);
put("adjudication-deepseek-config.json", { ...config, deep: "deepseek", prices: protocol.alternatePrices });
put("models.json", modelNames);
put("prompts.json", prompts);
put("prompt-body-hashes.json", Object.fromEntries(Object.entries(prompts).map(([name, body]) => [name, sha(typeof body === "string" ? body : JSON.stringify(body))])));
put("exclusions.json", d1.exclusions);
const requests: Record<string, unknown> = {};
const cacheRoot = "packages/conflict-guard/bench/model-cache/preexperiment";
const cacheEntries = new Map<string, { file: string; entry: CachedCall }>();
const cacheArchives: Array<{ file: string; sha256: string; bytes: number; entries: number }> = [];
const recordings: Array<{ report: string; policy: string; cacheFiles: string[]; subscriptions: ProviderSubscription[] | null }> = [];
const allReferenced = new Set<string>();
for (const [root, report, data] of [[cacheRoot, developmentFile, development], [cacheRoot, calibratedFile, calibrated]] as const) {
  const archiveFile = `${root}/model-cache.json.gz`;
  await hashFile(archiveFile);
  const texts = JSON.parse(gunzipSync(await read(archiveFile)).toString()) as Record<string, string>;
  const entries = new Map<string, { file: string; entry: CachedCall }>();
  const referenced = new Set<string>();
  for (const [name, text] of Object.entries(texts).sort(([left], [right]) => left.localeCompare(right))) {
    assert.match(name, /^G[123]\/[a-f0-9]{64}\.json$/);
    assert.equal(typeof text, "string");
    const entry = JSON.parse(text) as CachedCall;
    assert.equal(path.basename(name, ".json"), entry.key);
    assert(entry.parameters, `缓存缺少请求参数 ${name}`);
    assert.equal(cacheKey(entry.input, entry.call.adapter, entry.call.model, entry.parameters), entry.key);
    assert.equal(entry.call.cacheKey, entry.key);
    assert.equal(entry.call.inputHash, inputHash(entry.input));
    assert.equal(entry.call.promptVersion, config.promptVersion);
    assert.equal(entry.input.promptVersion, config.promptVersion);
    assert(!entries.has(entry.key), `重复缓存身份 ${root}/${name}`);
    const file = `${root}/${name}`;
    await archivedArtifact(file, text);
    const cached = { file, entry };
    entries.set(entry.key, cached);
    cacheEntries.set(file, cached);
  }
  if (!cacheArchives.some((item) => item.file === archiveFile)) cacheArchives.push({ file: archiveFile, ...artifacts[archiveFile]!, entries: entries.size });
  for (const [policy, value] of Object.entries(data.policies) as Array<[string, { model: { calls: ProviderCall[]; subscriptions?: ProviderSubscription[] } }]>) {
    if (!value.model.calls.length) continue;
    const files = value.model.calls.map((call) => {
      assert(call.cacheKey, `调用缺少缓存身份 ${report}/${policy}`);
      const cached = entries.get(call.cacheKey);
      assert(cached, `调用缺少录放缓存 ${report}/${policy}/${call.cacheKey}`);
      for (const field of ["adapter", "model", "inputHash", "promptVersion", "decision", "confidence"] as const) assert.equal(cached.entry.call[field], call[field]);
      referenced.add(call.cacheKey);
      allReferenced.add(`${root}/${call.cacheKey}`);
      return cached.file;
    });
    const subscriptions = value.model.subscriptions ?? null;
    if (subscriptions) for (const subscription of subscriptions) {
      const cached = entries.get(subscription.cacheKey);
      assert(cached, `订阅缺少录放缓存 ${subscription.cacheKey}`);
      for (const field of ["adapter", "model", "inputHash", "promptVersion"] as const) assert.equal(cached.entry.call[field], subscription[field]);
      referenced.add(subscription.cacheKey);
    }
    recordings.push({ report, policy, cacheFiles: files, subscriptions });
  }
}
assert.equal(allReferenced.size, cacheEntries.size, "缓存归档与录制引用集合不一致");
put("model-recordings.json", {
  archives: cacheArchives,
  entries: Object.fromEntries([...cacheEntries.values()].map(({ file }) => [file, artifacts[file]])),
  recordings,
  subscriptionCoverage: recordings.every((recording) => recording.subscriptions !== null) ? "complete" : "missing-in-source",
  workingCopies: "归档是冻结输入；存在的展开文件必须与归档逐字节相同，缺失文件可由 data:artifacts 恢复。"
});
for (const [id, role] of [["G1", "deep"], ["G2", "fast"]] as const) {
  for (const call of development.policies[id].model.calls as ProviderCall[]) {
    const { entry } = cacheEntries.get(`${cacheRoot}/${id}/${call.cacheKey}.json`)!;
    assert.equal(entry.call.model, modelNames[role === "fast" ? "jev" : "minimax"]);
    if (requests[role]) assert.deepEqual(entry.parameters, requests[role]);
    else requests[role] = entry.parameters;
  }
}
put("request-parameters.json", requests);
put("providers.json", { jev: providerConfiguration("jev", requests.fast as Record<string, unknown>), minimax: providerConfiguration("minimax", requests.deep as Record<string, unknown>), deepseek: { baseUrl: protocol.alternatePrices.site } });
put("strategies.json", {
  baselines: { P0: { coordination: false }, P1: { prelock: "file" }, P2: { prelock: "symbol-neighborhood", k: 2 }, P3: { rules: true, grey: "warn" }, "P*": { truth: { allow: "allow", warn: "lock", lock: "lock" }, noCandidate: "allow" } },
  models: Object.fromEntries(["G0", "G1", "G2", "G3", "G4"].map((strategy) => [strategy, { ...config, strategy }])),
  P5: { mode: "full", arbitration: "owner", injection: "on", adjudication: { ...config, strategy: "G4" } },
  agentModes: protocol.experiments.find((entry: { id: string }) => entry.id === "X6").arbitration,
  ablations: protocol.experiments.find((entry: { id: string }) => entry.id === "X7").conditions
});

const strata = manifest.projects.map((project) => {
  const groups = manifest.groups.filter((group) => group.project === project);
  const exact = groups.length * protocol.audit.fraction;
  return { project, groups, count: Math.floor(exact), remainder: exact % 1 };
});
const extra = Math.ceil(manifest.groups.length * protocol.audit.fraction) - strata.reduce((sum, stratum) => sum + stratum.count, 0);
for (const stratum of [...strata].sort((a, b) => b.remainder - a.remainder || a.project.localeCompare(b.project)).slice(0, extra)) stratum.count += 1;
const sampled = strata.flatMap(({ groups, count }) => groups.sort((a, b) => sha(`${protocol.audit.seed}:${a.id}`).localeCompare(sha(`${protocol.audit.seed}:${b.id}`))).slice(0, count)).sort((a, b) => a.id.localeCompare(b.id));
assert.equal(sampled.length, manifest.groups.length * protocol.audit.fraction);
const sampleRows: Array<{ id: string; project: string; split: string; operator: string; variants: string[] }> = [];
for (const group of sampled) {
  const groupLabels = labels.filter((label) => label.relationGroupId === group.id);
  sampleRows.push({ id: group.id, project: group.project, split: group.split, operator: group.operator.id, variants: groupLabels.map((label) => label.id) });
  const lines = [`# ${group.id}`, "", `项目：${group.project}；算子：${group.operator.id}；划分：${group.split}；种子：${group.seed}。`, "", "leftOnly 是改动方单独修改，rightOnly 是依赖方单独修改，merged 是双方合并。完整文件与探针声明见 programs.json，四状态三次原始输出见 probe-results.json。", ""];
  const programs: Record<string, unknown> = {};
  for (const [kind, variant] of Object.entries(group.variants)) {
    if (variant.aliasOf) { lines.push(`## ${kind}`, "", `与 ${variant.aliasOf} 相同，按同一个样本核验。`, ""); continue; }
    programs[variant.id] = { site: variant.site, entryPoints: variant.entryPoints, probes: variant.probes, baselineReference: variant.baselineReference, expectedMergedObservations: variant.expectedMergedObservations, baseline: variant.baseline, leftOnly: variant.leftOnly, rightOnly: variant.rightOnly, merged: variant.merged };
    for (const side of ["leftOnly", "rightOnly"] as const) {
      lines.push(`## ${kind} / ${side}`, "");
      for (const file of [...new Set([...Object.keys(variant.baseline), ...Object.keys(variant[side])])].sort()) {
        if (variant.baseline[file] === variant[side][file]) continue;
        const display = createTwoFilesPatch(file, file, variant.baseline[file] ?? "", variant[side][file] ?? "").split("\n").map((line) => line.trimEnd()).join("\n").trimEnd();
        lines.push("```diff", display, "```", "");
      }
    }
  }
  put(`label-audit/${group.id}/changes.md`, lines.join("\n"));
  put(`label-audit/${group.id}/programs.json`, programs);
  put(`label-audit/${group.id}/probe-results.json`, Object.fromEntries(groupLabels.map((label) => [label.id, label.states])));
  put(`label-audit/${group.id}/automatic-labels.json`, groupLabels.map(({ states: _states, ...label }) => label));
}
const auditIndex = { ...protocol.audit, groups: sampled.length, totalGroups: manifest.groups.length, fraction: sampled.length / manifest.groups.length, perProject: Object.fromEntries(manifest.projects.map((project) => [project, sampled.filter((group) => group.project === project).length])), perSplit: { dev: sampled.filter((group) => group.split === "dev").length, holdout: sampled.filter((group) => group.split === "holdout").length }, selection: "总量为关系组数量的 20%，按项目比例使用最大余数分配，各项目按 SHA256(seed:groupId) 升序选择，选择过程不读取标签。", samples: sampleRows, responses: [1, 2].map((reviewer) => ({ template: `label-audit/reviewer-${reviewer}.template.json`, file: `label-audit/reviewer-${reviewer}.json` })) };
put("label-audit/index.json", auditIndex);
const auditHeader = ["# 独立标签抽检", "", "两位标注者分别填写 reviewer-1.json 与 reviewer-2.json，独立完成后交由负责人比较。阅读 changes.md、programs.json 和 probe-results.json；负责人保存 automatic-labels.json 供判断完成后核验。", "", "冻结模板参与哈希检查，人工填写结果单独保存。verify 检查样本身份与字段类型。allow 表示共享行为兼容，warn 表示合并观测与明确声明的可组合预期不同，lock 表示双方单独通过而合并失败，exclude 表示单方失败、文本冲突、超时或重复不一致。", "", `抽检 ${sampled.length}/${manifest.groups.length} 个关系组；开发集 ${auditIndex.perSplit.dev}，保留集 ${auditIndex.perSplit.holdout}。按项目比例使用最大余数分配，再按固定组号哈希选择。`, "", "| 关系组 | 项目 | 算子 | 修改 | 探针结果 |", "|---|---|---|---|---|"];
for (const row of sampleRows) auditHeader.push(`| ${row.id} | ${row.project} | ${row.operator} | [双方修改](${row.id}/changes.md) | [四状态原始结果](${row.id}/probe-results.json) |`);
put("label-audit/README.md", auditHeader.join("\n") + "\n");
const reviewerTemplates = [1, 2].map((reviewer) => ({ reviewer: `reviewer-${reviewer}`, independent: true, decisions: sampleRows.flatMap((row) => row.variants.map((id) => ({ relationGroupId: row.id, id, label: null, reason: "", notes: "" }))) }));
for (const template of reviewerTemplates) put(`label-audit/${template.reviewer}.template.json`, template);

// 预算只读取开发集与既有冒烟记录，不执行分类器评价或模型请求。
let agentStarts = 0; let followups = 0; let agentRequests = 0; let agentInput = 0; let agentOutput = 0; let guardFast = 0; let guardDeep = 0; let guardCost = 0;
for (const task of ["d3-01", "d3-02", "d3-03"]) for (const injection of ["on", "off"]) {
  const file = `docs/conflict-guard/evidence/stage-7-smoke/${task}-${injection}-1.json`;
  await hashFile(file);
  const record = await readJson(file);
  agentStarts += record.traces.length;
  for (const trace of record.traces) {
    const messages = new Map<string, { input: number; output: number }>();
    for (const event of trace.events) {
      const info = event.type === "opencode.message.updated" ? event.data?.info : undefined;
      if (info?.role === "assistant" && info.tokens && info.time?.completed) messages.set(info.id, { input: info.tokens.input + (info.tokens.cache?.read ?? 0) + (info.tokens.cache?.write ?? 0), output: info.tokens.output });
      if (event.type === "arbitration_continuation") followups += 1;
    }
    agentRequests += messages.size;
    for (const tokens of messages.values()) { agentInput += tokens.input; agentOutput += tokens.output; }
  }
  // 项目轨迹中的 provider_call 覆盖角色研判和折中建议。
  const traceFile = file.replace(/\.json$/, ".jsonl");
  await hashFile(traceFile);
  const trace = readTrace((await read(traceFile)).toString());
  for (const event of trace.filter((event) => event.type === "provider_call" && event.status !== "cache-hit")) {
    if (event.role === "fast" || event.adapter === "jev") guardFast += 1; else guardDeep += 1;
    guardCost += event.costUsd ?? 0;
  }
}
// 追加执行的事件名称从固定证据取得，统计结果单独保留。
await hashFile("docs/conflict-guard/evidence/stage-7-smoke/verification.json");
const holdoutCalls = Math.ceil(d1.holdout.uniqueValidPrograms * fastModel.httpCalls / d1.dev.uniqueValidPrograms);
const escalations = Math.ceil(holdoutCalls * cascade.escalations / cascade.judgements);
const ablationCalls = Math.ceil((d1.dev.uniqueValidPrograms + d1.holdout.uniqueValidPrograms) * fastModel.httpCalls / d1.dev.uniqueValidPrograms);
const fastCost = fastModel.httpCalls ? fastModel.costUsd / fastModel.httpCalls : 0;
const deepCost = deepModel.httpCalls ? deepModel.costUsd / deepModel.httpCalls : 0;
const minimaxSmoke = await readJson("docs/conflict-guard/evidence/minimax-agent-smoke/verification.json");
const rows: Array<{ experiment: string; fast: number; deep: number; agentBaseRuns: number; usd: number }> = [];
for (const id of ["X1", "X2", "X4"]) rows.push({ experiment: id, fast: 0, deep: 0, agentBaseRuns: 0, usd: 0 });
rows.push({ experiment: "X3b", fast: 4 * holdoutCalls, deep: 4 * holdoutCalls + 4 * escalations, agentBaseRuns: 0, usd: 4 * holdoutCalls * fastCost + (4 * holdoutCalls + 4 * escalations) * protocol.budget.deepseekUsdPerCall });
rows.push({ experiment: "X3", fast: 12 * holdoutCalls, deep: 4 * holdoutCalls + 8 * escalations, agentBaseRuns: 0, usd: 12 * holdoutCalls * fastCost + (4 * holdoutCalls + 8 * escalations) * deepCost });
assert.equal(protocol.budget.agentBaseRuns, protocol.budget.X5BaseRuns + protocol.budget.X6AdditionalBaseRuns);
const agentUnitCost = minimaxSmoke.costCny * config.prices.usdPerCurrencyUnit / minimaxSmoke.tasks.length;
for (const [id, runs] of [["X5", protocol.budget.X5BaseRuns], ["X6", protocol.budget.X6AdditionalBaseRuns]] as const) {
  const guardedRuns = id === "X5" ? runs / 3 : runs;
  const fast = Math.ceil(guardedRuns * guardFast / agentStarts); const deep = Math.ceil(guardedRuns * guardDeep / agentStarts);
  rows.push({ experiment: id, fast, deep, agentBaseRuns: runs, usd: runs * agentUnitCost + fast * fastCost + deep * deepCost });
}
rows.push({ experiment: "X7", fast: ablationCalls, deep: 0, agentBaseRuns: 0, usd: ablationCalls * fastCost });
rows.sort((left, right) => left.experiment.localeCompare(right.experiment));
const budget = { basis: { developmentSamples: d1.dev.uniqueValidPrograms, developmentFastCalls: fastModel.httpCalls, holdoutUniqueSamples: d1.holdout.uniqueValidPrograms, forecastCallsPerHoldoutRound: holdoutCalls, cascadeObservedEscalations: cascade.escalations, cascadeObservedJudgements: cascade.judgements, arbitrationSourceRuns: agentStarts, smokeFollowupEvents: followups, smokeAgentRequests: minimaxSmoke.requests, smokeAgentRuns: minimaxSmoke.tasks.length, smokeModel: minimaxSmoke.model, smokeCostCny: minimaxSmoke.costCny, smokeGuardCalls: { fast: guardFast, deep: guardDeep }, agentMeanUsd: agentUnitCost }, prices: config.prices, rows, totals: { fast: rows.reduce((sum, row) => sum + row.fast, 0), deep: rows.reduce((sum, row) => sum + row.deep, 0), agentBaseRuns: protocol.budget.agentBaseRuns, agentExecutionsIncludingFollowups: Math.ceil(protocol.budget.agentBaseRuns * (1 + followups / agentStarts)), agentHttpRequests: Math.ceil(protocol.budget.agentBaseRuns * minimaxSmoke.requests / minimaxSmoke.tasks.length), usd: rows.reduce((sum, row) => sum + row.usd, 0) }, stopRatio: protocol.budget.excessStopRatio, uncertainty: "开发集与三项实际 MiniMax 冒烟的均值外推；仲裁调用频次参考十二个既有 run。原币种 CNY 单列，固定记账系数 CNY 7 = USD 1 只用于预算估算。并发与任务难度可能改变调用次数，未知 usage 单列。" };
assert(Object.values(budget.totals).every((value) => Number.isFinite(value) && value >= 0), "预算估计存在无效数字");
assert(agentRequests > 0 && agentInput > 0 && agentOutput > 0, "冒烟记录缺少 Agent usage，不能估算费用");
put("budget.json", { ...budget, stopBeforeExceeding: Object.fromEntries(Object.entries(budget.totals).map(([category, estimate]) => [category, category === "usd" ? estimate * budget.stopRatio : Math.floor(estimate * budget.stopRatio)])) });
put("runtime-config.json", { ...protocol.session, arbitration: "owner", intentInjection: "on", modes: { P0: "off", P3: "rules", P5: "full" }, adjudication: config, models: modelNames });
put("label-audit/source.json", { codeCommit: protocol.codeCommit, dataset: d1.version, manifestSha256: artifacts[`${d1Root}/manifest.json`]!.sha256, labelsSha256: artifacts[`${d1Root}/labels.json`]!.sha256 });
const generatedHashes = () => Object.fromEntries([...generated].sort(([a], [b]) => a.localeCompare(b)).map(([file, text]) => [file, { sha256: sha(text), bytes: Buffer.byteLength(text) }]));
const snapshot = { version: protocol.version, status: protocol.status, readyForExperiments: false, codeCommit: protocol.codeCommit, productSourceSha256: digestFiles(sources), ruleVersion: `rules-sha256:${digestFiles(ruleFiles)}`, metricSourceSha256: digestFiles(metricFiles), datasets: { D1: d1, D2: { version: d2.version, cases: d2.caseCount, scenarios: d2.scenarios, traces: tracked.filter((file) => file.startsWith(`${d2Root}/traces/`)).length }, D3: { version: d3.version, tasks: d3.tasks.length, crossOwner: d3.tasks.filter((task: { ownership: string }) => task.ownership === "cross").length, sameOwner: d3.tasks.filter((task: { ownership: string }) => task.ownership === "same").length } }, calibration: { file: calibrationFile, threshold: config.threshold, samples: calibration.samples, lockCount: calibration.lockCount, allowCount: calibration.allowCount }, audit: auditIndex, environment: { node: process.version, pnpm: "9.0.0", openCode: "1.18.31", typescript: ts.version, modelNames, deepModelVersion: "供应方响应 MiniMax-M3，国内站 api.minimaxi.com。", compatibleEndpointConfigured: true, alternateDeepModel: "deepseek-flash", prices: config.prices }, artifacts: Object.fromEntries(Object.entries(artifacts).sort(([a], [b]) => a.localeCompare(b))), generated: generatedHashes(), executions: { stage8Experiments: 0, modelCalls: 0, agentRuns: 0, holdoutPolicyEvaluations: 0 } };
const lines = ["# 检查点 C 冻结清单", "", `状态：等待人工确认。协议 ${protocol.version}；日期 ${protocol.date}。本次只导出配置、哈希和标签抽检材料；X1 至 X7 尚未执行。`, "", "## 代码与环境", "", `评价代码提交：\`${protocol.codeCommit}\`。分支 feature/conflict-guard。产品源码 SHA-256：\`${snapshot.productSourceSha256}\`。冻结材料提交由 Git 保存，与评价代码提交分别追踪。`, "", `Node ${process.version}；pnpm 9.0.0；TypeScript ${ts.version}；OpenCode 与 SDK 1.18.31。pnpm-lock.yaml 的 SHA-256 为 \`${artifacts["pnpm-lock.yaml"]!.sha256}\`。逐文件哈希及字节数见 [freeze.json](freeze.json)。`, "", "## 数据集", "", "| 数据 | 版本 | 规模 | 清单 SHA-256 |", "|---|---|---|---|"];
for (const [id, version, size, root] of [["D1", d1.version, `${d1.groups} 组；dev ${d1.dev.groups}；holdout ${d1.holdout.groups}`, d1Root], ["D2", d2.version, `${d2.caseCount} 案例 + ${d2.scenarios} 场景；57 份轨迹`, d2Root], ["D3", d3.version, `${d3.tasks.length} 任务对；跨属主 10，同属主 3`, d3Root]]) lines.push(`| ${id} | ${version} | ${size} | \`${artifacts[`${root}/manifest.json`]!.sha256}\` |`);
lines.push("", `D1 原始生成提交 ${d1.generatedFrom}，固定种子 ${d1.seed}。归档 SHA-256：\`${sha(archive)}\`。清单、标签、剔除表与每份轨迹均与归档核对。开发集项目：${d1.dev.projects.join("、")}；保留集项目：${d1.holdout.projects.join("、")}。`, "", "| 划分 | 有标签变体 | 剔除变体 | 有效变体 | 去重后有效程序 |", "|---|---:|---:|---:|---:|");
for (const [split, stat] of [["dev", d1.dev], ["holdout", d1.holdout]] as const) lines.push(`| ${split} | ${stat.labelledVariants} | ${stat.excludedVariants} | ${stat.validVariants} | ${stat.uniqueValidPrograms} |`);
lines.push("", `跨项目归一化 token 相似度最大 ${d1.diversity.maximumObserved.toFixed(8)}，限制 ${d1.diversity.limit}；开发与保留项目的程序交集 ${d1.diversity.programOverlap}，站点交集 ${d1.diversity.siteOverlap}。仅保留集算子族：${d1.heldoutFamilies!.join("、")}。`, "", "| 剔除样本 | 划分 | 原因 |", "|---|---|---|");
for (const entry of d1.exclusions) lines.push(`| ${entry.id} | ${entry.split} | ${entry.reason} |`);
lines.push("", `总剔除率 ${excluded.length}/${labels.length} = ${(100 * excluded.length / labels.length).toFixed(2)}%。[抽检材料](label-audit/README.md)覆盖 ${sampled.length}/${manifest.groups.length} 个关系组，两位标注者独立填写 reviewer-1.json 与 reviewer-2.json。抽样按项目比例分配，使用固定种子和组号，不读取标签。`, "", "## 规则、会话与策略", "", `规则版本 \`${snapshot.ruleVersion}\`；指标源码 SHA-256 \`${snapshot.metricSourceSha256}\`。[会话参数](runtime-config.json)包括 k=${protocol.session.k}、函数体相邻范围 ${protocol.session.bodyUnrelatedMaxAdjacentLines} 行、判定队列 ${protocol.session.judgementFrameMs} ms、每次最多 ${protocol.session.maxJudgementsPerFrame} 次判定。`, "", "| 策略 | 冻结行为 |", "|---|---|", "| P0 | 无协调 |", "| P1 | 编辑开始时锁定文件 |", "| P2 | 编辑开始时锁定 k 跳符号范围 |", "| P3 / G0 | 本地规则，灰区提醒 |", "| P* | 候选对使用可执行真值：allow 放行，warn/lock 冻结 |", "| G1 | 灰区深判 |", "| G2 | 灰区快判 |", "| G3 | 快判置信度低于阈值、lock 或失败时升级深判 |", "| G4 | 人类编辑 G3，Agent 写入前和任务完成后 G1 |", "| P5 | full，属主仲裁，写入检查和完成复检开启，意图注入独立开关 |", "", `研判配置 ${config.version}；提示词 ${config.promptVersion}；级联阈值 ${config.threshold}。来源为[开发集校准](../evidence/preexperiment/calibration/calibration.json)，最终灰区样本 ${calibration.samples} 个，allow=${calibration.allowCount}、lock=${calibration.lockCount}。[四项曲线](../evidence/preexperiment/calibration/threshold.svg)。开发集新增 ${dataCheck.safeGreyGroups} 个灰区安全关系组，保留集内容保持原样。`, "", `[提示词全文](prompts.json) SHA-256 \`${sha(generated.get("prompts.json")!)}\`；[研判配置](adjudication-config.json) SHA-256 \`${sha(generated.get("adjudication-config.json")!)}\`。字段上限 3000 字符，每侧最多三个调用点，不变量开启。`, "", `快判 jev / ${modelNames.jev}；深判 minimax / ${modelNames.minimax}，国内站 https://api.minimaxi.com/v1；Agent 使用 MiniMax-M3。X3b 替代深判 deepseek-flash。人类编辑研判和 Agent 运行关闭推理，Agent 写入前及任务完成后深判开启推理。时点预算分别为 8000、30000、60000 ms，进度提示 2000 ms。供应方响应型号保留在原始输出中。`, "", `价格日期 ${config.prices.date}，站点 ${config.prices.site}。MiniMax 标准价格每百万 token：输入 CNY ${config.prices.deepInputPerMillion}，输出 CNY ${config.prices.deepOutputPerMillion}，缓存命中 CNY ${config.prices.deepCacheReadPerMillion}。快判输入 USD ${config.prices.fastInputPerMillion}，输出 USD 0。原币种费用单列，合计预算按固定记账系数 CNY 7 = USD 1 估算。`, "", "## 指标与统计", "", "[指标公式与统计方法](metrics-and-statistics.md)：Wilson 95% 区间，关系组 exact-two-sided McNemar，关系组 bootstrap 2000 次、种子 20261007，实验内 Holm 校正。空分母显示 N/A，重复一致率单列。T03：完成率≥95%，漏阻断≤10%，误阻断≤15%，一致率≥80%，p50≤3000ms，p95≤8000ms。X4 使用冻结 G2。", "", "## 实验命令、重复与预算", "", "以下命令在人工确认后执行，完整配置见 protocol.json；输出目录保存 command.txt、config.json、原始输出与 summary.md。", "", "| 实验 | 重复 | 快判调用预计 | 深判调用预计 | 初始 Agent run | 费用预计 USD |", "|---|---|---:|---:|---:|---:|");
for (const row of rows) { const experiment = protocol.experiments.find((entry: { id: string }) => entry.id === row.experiment); const repeat = ["X3", "X3b"].includes(row.experiment) ? "record 1 + replay 3 + live 3，每策略" : String(experiment.repetitions); lines.push(`| ${row.experiment} | ${repeat} | ${row.fast} | ${row.deep} | ${row.agentBaseRuns} | ${row.usd.toFixed(4)} |`); }
lines.push("", `总预计：快判 ${budget.totals.fast} 次，深判 ${budget.totals.deep} 次，初始 Agent ${budget.totals.agentBaseRuns} 个 run，Agent 内部 HTTP 请求约 ${budget.totals.agentHttpRequests} 次，费用约 USD ${budget.totals.usd.toFixed(4)}。角色调用与 Agent 内部模型调用分别统计。预算依据、token 与公式见 [budget.json](budget.json)。预计超过任一类别或费用的 120% 之前停止汇报；未知 usage 和失败调用单独记录。`, "", "X3 质量使用每策略一次 record，三次 replay 验证重现；三轮 live 用于真实延迟与重复一致率，独立调用、不复用缓存。X4 复用 X3 和既有开发集录制。X5 有 13×3×2×3×2=468 个初始 run；X6 复用 owner，只增加 10×2×3×2=120 个。既有冒烟 token 已包含追加执行，费用均值外推不重复乘追加次数。", "");
for (const experiment of protocol.experiments) {
  lines.push(`### ${experiment.id}`, "");
  if (experiment.command) lines.push("```sh", experiment.command, "```", "");
  for (const command of experiment.commands ?? []) lines.push("```sh", command, "```", "");
  lines.push(experiment.additionalWork, "");
}
lines.push("## 人工确认与范围", "", "本清单等待人工确认，readyForExperiments=false。两位标注者完成独立抽检后确认代码、配置、标签、公式和重复次数。D3 包含 Agent 与 Agent 任务，人与 Agent 的实验条件需要另行准备任务数据；当前注明未执行。模型型号以供应方响应标识为准，接口没有不可变发布标识时注明这一限制。", "", "## 验证命令", "", "```sh", "pnpm --filter @simplercp/conflict-guard experiment:freeze --verify", "pnpm --filter @simplercp/conflict-guard experiment:verify", "node scripts/verify-evidence-secrets.mjs", "```", "", "verify 构建对应源码，核对归档、标签规则、轨迹、抽样、配置和导出文件的逐字节内容，模型调用数为零。freeze.json 的其余导出内容全部参与哈希检查，人工表格单独保存。", "");
put("freeze.md", lines.join("\n"));
put("recording-integrity.md", [
  "# 冻结材料完整性", "",
  "每次导出与 verify 都在核验产品源码提交后构建 conflict-guard 包，随后加载构建结果。提示词、标签规则与缓存身份来自当前提交对应的源码。", "",
  `开发集录放归档包含 ${cacheEntries.size} 份缓存。G1、G2 的真实请求录制一次，级联复用完整缓存身份相同的响应。model-recordings.json 保存归档哈希、每份缓存的哈希和逐订阅时序；freeze.json 同时保存这些输入的哈希。`, "",
  "D1 与模型缓存直接读取已提交的压缩归档。工作目录中存在的展开文件必须与归档逐字节相同；新 checkout 可以直接导出和验证。运行需要展开文件的评价命令前使用 data:artifacts 恢复。", "",
  "```sh",
  `pnpm --filter @simplercp/conflict-guard data:artifacts --dataset bench/datasets/${protocol.dataset} --restore`,
  "pnpm --filter @simplercp/conflict-guard data:artifacts --cache bench/model-cache/preexperiment --restore",
  "```", "",
  "开发集录制同时保存 provider calls 与逐订阅记录。正式实验保存相同的请求身份和订阅时序，离线回放不读取 API key。", "",
  "冻结哈希覆盖 reviewer template，人工 reviewer 表格由标注者独立维护。重复导出保留已有人工表格；verify 接受有效的填写结果。人工表格的后续修改由 Git 记录，确认材料时同时提交两份独立意见。", "",
  "输出目录、全部生成文件与人工表格都核验真实路径。指向仓库外部的符号链接、失效的符号链接与工作副本内容不一致都会终止命令。全部路径及人工表格验证通过后才写入生成材料。", ""
].join("\n"));
snapshot.generated = generatedHashes();
put("freeze.json", snapshot);
for (const file of generated.keys()) assertRepositoryPath(repository, path.join(output, file));
const missingReviewers: Array<{ file: string; template: typeof reviewerTemplates[number]; replace?: boolean }> = [];
for (const template of reviewerTemplates) {
  const file = path.join(output, "label-audit", `${template.reviewer}.json`);
  assertRepositoryPath(repository, file);
  if (!lstatSync(file, { throwIfNoEntry: false })) {
    assert(!values.verify, `缺少人工表格 ${template.reviewer}`);
    missingReviewers.push({ file, template });
    continue;
  }
  const sheet = JSON.parse(await fs.readFile(file, "utf8"));
  assert.equal(sheet.reviewer, template.reviewer);
  assert.equal(sheet.independent, true);
  assert(Array.isArray(sheet.decisions));
  const identities = sheet.decisions.map((entry: { relationGroupId: string; id: string }) => [entry.relationGroupId, entry.id]).sort();
  const expected = template.decisions.map((entry) => [entry.relationGroupId, entry.id]).sort();
  if (!values.verify && JSON.stringify(identities) !== JSON.stringify(expected) && sheet.decisions.every((entry: { label: unknown; reason: string; notes: string }) => entry.label === null && entry.reason === "" && entry.notes === "")) missingReviewers.push({ file, template, replace: true });
  else assert.deepEqual(identities, expected, `人工表格样本身份不一致 ${template.reviewer}`);
  for (const entry of sheet.decisions) {
    assert([null, "allow", "warn", "lock", "exclude"].includes(entry.label));
    assert.equal(typeof entry.reason, "string");
    assert.equal(typeof entry.notes, "string");
  }
}
for (const [file, text] of generated) {
  const target = path.join(output, file);
  if (values.verify) assert.equal(await fs.readFile(target, "utf8"), text, `冻结材料内容不一致 ${file}`);
  else { await fs.mkdir(path.dirname(target), { recursive: true }); await fs.writeFile(target, text); }
}
for (const { file, template, replace } of missingReviewers) await fs.writeFile(file, json(template), { flag: replace ? "w" : "wx" });
console.log(json({ verified: values.verify, codeCommit: protocol.codeCommit, relationGroups: d1.groups, auditGroups: sampled.length, generatedFiles: generated.size, onlineCalls: 0, holdoutPolicyEvaluations: 0, readyForExperiments: false }).trim());
