import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { gzipSync, gunzipSync } from "node:zlib";
import { parseArgs } from "node:util";
import { replayTrace, replayOutcome, createReplayModelPolicy, inputHash, calculateReplayMetrics, type AdjudicationConfig, type AdjudicationInput, type ZoneVerdict, type ProviderMode } from "../dist/index.js";
import { developmentSamples } from "./model-dataset.ts";
import { replayLibraries } from "./replay-libs.ts";
import { createModelRuntime, loadModelEnvironment, repositoryRoot } from "./model-runtime.ts";

const { values } = parseArgs({ options: { policy: { type: "string", default: "G1" }, prompt: { type: "string", default: "pair-v4" }, mode: { type: "string", default: "replay" }, threshold: { type: "string", default: "0" }, out: { type: "string" }, dataset: { type: "string", default: "packages/conflict-guard/bench/datasets/d1-v3" }, experiment: { type: "string", default: "stage-A" }, "allow-source-change": { type: "boolean", default: false } } });
loadModelEnvironment();
if (!["G1", "G2", "G3"].includes(values.policy!) || !["pair-v1", "pair-v4", "pair-v5"].includes(values.prompt!) || !["record", "replay"].includes(values.mode!)) throw new Error("阶段 A 参数无效");
if (values["allow-source-change"] && values.mode !== "replay") throw new Error("仅允许回放时跳过输入来源哈希校验");
if (values.policy === "G3" && values.mode !== "replay") throw new Error("级联阈值使用离线缓存");
if (values.mode === "record" && process.env.ADJUDICATION_BUDGET_SCOPE !== values.experiment!.toLowerCase().replace("stage-", "stage-")) throw new Error("真实录制必须使用登记的阶段预算");
if (values.mode === "record" && values.policy === "G2" && !process.env.TYPESAFE_PROXY_URL) throw new Error("Jev 真实录制需要配置代理");
if (values.mode === "replay" && values.policy !== "G3" && !values.out) throw new Error("深判和快判回放需要通过 --out 指定独立结果目录");
const output = path.join(repositoryRoot, "docs/conflict-guard/experiment/v2", values.experiment!);
const outputName = values.policy === "G3" ? `G3-${Number(values.threshold)}` : values.policy!;
const directory = values.out ? path.resolve(values.out) : path.join(output, values.prompt!, outputName);
if (existsSync(path.join(directory, "calls.jsonl"))) throw new Error("结果调用日志已存在，请指定独立结果目录");
const prepared = JSON.parse(gunzipSync(await fs.readFile(path.join(output, "prepared.json.gz"))).toString());
if (!values["allow-source-change"]) for (const [file, expected] of Object.entries(prepared.sourceHashes)) assert.equal(createHash("sha256").update(await fs.readFile(new URL(`../${file}`, import.meta.url))).digest("hex"), expected, `输入来源变化：${file}`);
const config: AdjudicationConfig = { ...prepared.config, promptVersion: values.prompt, strategy: values.policy, threshold: Number(values.threshold) };
const models = JSON.parse(await fs.readFile(path.join(output, "models.json"), "utf8"));
const providers = JSON.parse(await fs.readFile(path.join(output, "providers.json"), "utf8"));
const name = values.policy === "G3" ? `G3-${config.threshold}` : values.policy!;
await fs.mkdir(directory, { recursive: true });
await fs.writeFile(path.join(directory, "calls.jsonl"), "", { flag: "wx" });
const cache = path.join(repositoryRoot, ".test-workspaces/stage-a-cache", values.prompt!, values.policy!);
let writes = Promise.resolve();
let proxyFailure: string | undefined;
const service = createModelRuntime(config, values.mode as ProviderMode, cache, (call) => {
  if (call.errorType?.startsWith("proxy-")) proxyFailure = call.errorType;
  writes = writes.then(() => fs.appendFile(path.join(directory, "calls.jsonl"), JSON.stringify(call) + "\n"));
  console.log(JSON.stringify({ policy: name, status: call.status, role: call.role, latencyMs: Math.round(call.latencyMs), calls: service.stats().calls }));
}, models, undefined, undefined, providers);
const responses = new Map<string, ZoneVerdict>();
const inputs = new Map<string, { input: AdjudicationInput; local: ZoneVerdict }>();
async function resolveInput(input: AdjudicationInput, local: ZoneVerdict) {
  const key = inputHash(input);
  if (responses.has(key)) return;
  inputs.set(key, { input, local });
  responses.set(key, await service.judge(input, local, new AbortController().signal));
  if (proxyFailure) { await writes; throw new Error(`Jev 代理请求失败：${proxyFailure}`); }
}
for (const request of prepared.requests) await resolveInput({ ...request.input, promptVersion: values.prompt }, request.local);
const { samples, manifest } = await developmentSamples(path.resolve(repositoryRoot, values.dataset!));
assert.equal(manifest.version, prepared.dataset);
assert.deepEqual(samples.map((sample) => [sample.label.id, sample.programHash]), prepared.groups.map((row: any) => [row.id, row.programHash]));
const libs = await replayLibraries();
const groups = [];
for (const [ordinal, sample] of samples.entries()) {
  const { group, variant, label, trace } = sample;
  let result;
  for (let pass = 0; ; pass += 1) {
    if (pass > trace.length) throw new Error("模型回放输入未能稳定");
    const missing = new Map<string, { input: AdjudicationInput; local: ZoneVerdict }>();
    result = replayTrace(trace, { initialFiles: variant.baseline, libs, seed: group.seed, policy: createReplayModelPolicy(config, responses, (input, local) => { if (!responses.has(inputHash(input))) missing.set(inputHash(input), { input, local }); }, Object.keys(variant.baseline)) });
    if (!missing.size) break;
    for (const request of missing.values()) await resolveInput(request.input, request.local);
  }
  const outcome = replayOutcome({ truth: label.label as "allow" | "warn" | "lock", variantKind: variant.kind, operatorFamily: group.operator.family, detectability: label.detectability, baseline: variant.baseline, merged: variant.merged, trace, result });
  groups.push({ id: label.id, relationGroupId: group.id, programHash: sample.programHash, outcome, result: { ...result, events: undefined } });
  if ((ordinal + 1) % 5 === 0 || ordinal + 1 === samples.length) console.log(JSON.stringify({ policy: name, progress: ordinal + 1, total: samples.length, calls: service.stats().calls, inputs: inputs.size }));
}
await writes;
const report = { dataset: manifest.version, split: "dev", config, sourceHashes: prepared.sourceHashes, mode: values.mode, metrics: calculateReplayMetrics(groups.map((row) => row.outcome)), model: { ...service.stats(), cacheMisses: service.cacheMisses(), calls: service.calls(), subscriptions: service.subscriptions(), providers: service.providerConfiguration }, inputs: [...inputs.values()], responses: [...responses], groups };
await fs.writeFile(path.join(directory, "results.json.gz"), gzipSync(JSON.stringify(report)));
const shellWord = (value: string) => `'${value.replace(/'/g, "'\\''")}'`;
const sourceChange = values["allow-source-change"] ? " --allow-source-change" : "";
await fs.writeFile(path.join(directory, "command.txt"), `ADJUDICATION_BUDGET_SCOPE=${values.experiment!.toLowerCase().replace("stage-", "stage-")} node --experimental-strip-types scripts/stage-a-evaluate.ts --experiment ${values.experiment} --dataset ${shellWord(values.dataset!)} --policy ${values.policy} --prompt ${values.prompt} --mode ${values.mode} --threshold ${values.threshold}${sourceChange}${values.out ? ` --out ${shellWord(directory)}` : ""}\n`);
await fs.writeFile(path.join(directory, "config.json"), JSON.stringify({ config, models, providers }, null, 2) + "\n");
service.dispose();
console.log(JSON.stringify({ policy: name, samples: groups.length, inputs: inputs.size, calls: service.stats().calls, cacheMisses: service.cacheMisses(), costUsd: service.stats().costUsd }));
