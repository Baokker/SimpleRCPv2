import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { gunzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import { parseArgs } from "node:util";
import { canonicalJson } from "../dist/index.js";
import { recordedProviderConfiguration } from "./model-providers.ts";

const { values } = parseArgs({ options: { record: { type: "string", default: "../../docs/conflict-guard/evidence/stage-5-dev-report" }, cache: { type: "string", default: "bench/model-cache/stage5-dev-final" }, dataset: { type: "string", default: "bench/datasets/d1-v1" }, out: { type: "string" }, "use-existing": { type: "boolean", default: false }, plan: { type: "boolean", default: false } } });
if (values.plan) { console.log(JSON.stringify({ record: values.record, cache: values.cache, dataset: values.dataset, repetitions: 3, executed: false, modelCalls: 0 })); process.exit(0); }
const source = path.resolve(values.record!);
const reportFile = source.endsWith(".gz") ? source : path.join(source, "results.json.gz");
const directory = values.out ? path.resolve(values.out) : path.dirname(reportFile);
await fs.mkdir(directory, { recursive: true });
const read = async (file: string) => JSON.parse(gunzipSync(await fs.readFile(file)).toString());
const recorded = await read(reportFile);
const policies = Object.keys(recorded.policies).filter((id) => ["G1", "G2", "G3", "G4"].includes(id)).sort();
if (!policies.length) throw new Error("录制报告没有模型策略");
const configuration = path.join(directory, "adjudication-config.json");
await fs.writeFile(configuration, JSON.stringify(recorded.config, null, 2) + "\n");
const models: Record<string, string> = {};
for (const id of policies) for (const call of recorded.policies[id].model.calls) {
  if (models[call.adapter] && models[call.adapter] !== call.model) throw new Error("录制报告中同一适配器包含多个模型版本");
  models[call.adapter] = call.model;
}
const identities = path.join(directory, "adjudication-models.json");
await fs.writeFile(identities, JSON.stringify(models, null, 2) + "\n");
const providers = await recordedProviderConfiguration(Object.fromEntries(policies.map((id) => [id, recorded.policies[id]])), path.resolve(values.cache!));
const providerFile = path.join(directory, "adjudication-providers.json");
await fs.writeFile(providerFile, JSON.stringify(providers, null, 2) + "\n");
const subscriptions = Object.fromEntries(policies.filter((id) => Array.isArray(recorded.policies[id].model.subscriptions)).map((id) => [id, recorded.policies[id].model.subscriptions]));
const subscriptionFile = path.join(directory, "adjudication-subscriptions.json");
if (Object.keys(subscriptions).length) await fs.writeFile(subscriptionFile, JSON.stringify(subscriptions, null, 2) + "\n");
const comparable = (report: typeof recorded) => canonicalJson(Object.fromEntries(policies.map((id) => {
  const row = report.policies[id];
  return [id, { metrics: row.metrics, groups: row.groups, inputHashes: row.inputHashes, t03: row.t03, model: { tasks: row.model.tasks, successful: row.model.successful, completionRatio: row.model.completionRatio, p50Ms: row.model.p50Ms, p95Ms: row.model.p95Ms } }];
})));
const reference = comparable(recorded);
const rounds = await Promise.all([1, 2, 3].map(async (round) => {
  const output = path.join(directory, `replay-${round}`);
  if (!values["use-existing"]) await promisify(execFile)(process.execPath, ["--experimental-strip-types", "scripts/replay-run.ts", "--dataset", values.dataset!, "--split", recorded.split, "--policy", policies.join(","), "--provider-mode", "replay", "--config", configuration, "--models", identities, "--providers", providerFile, "--cache", values.cache!, "--out", output, "--k", String(recorded.replayOptions?.k ?? 2), ...(recorded.experiment ? ["--experiment", recorded.experiment] : []), ...(recorded.ablation ? ["--ablation", recorded.ablation] : []), ...(Object.keys(subscriptions).length ? ["--subscriptions", subscriptionFile] : [])], { cwd: process.cwd(), maxBuffer: 1024 * 1024 });
  const replayed = await read(path.join(output, "results.json.gz"));
  for (const field of ["dataset", "split", "seed", "config", "replayOptions", "experiment", "ablation"]) if (canonicalJson(replayed[field] ?? null) !== canonicalJson(recorded[field] ?? (field === "replayOptions" ? { k: 2 } : null))) throw new Error(`录放配置不一致：${field}`);
  const networkCalls = policies.reduce((sum, id) => sum + replayed.policies[id].model.httpCalls, 0);
  const cacheMisses = Object.fromEntries(policies.map((id) => [id, replayed.policies[id].model.cacheMisses]));
  const bytes = await fs.readFile(path.join(output, "results.json.gz"));
  const result = { round, recordMatches: comparable(replayed) === reference, sha256: createHash("sha256").update(bytes).digest("hex"), networkCalls, cacheMisses };
  console.log(JSON.stringify(result));
  return result;
}));
const sourceCacheMisses = Object.fromEntries(policies.map((id) => [id, recorded.policies[id].model.cacheMisses ?? null]));
const verification = { compared: "judgements, outcomes, intervals, metrics, input hashes, completion, recorded latency, T03", execution: values["use-existing"] ? "verify-existing-replays" : "three-independent-replays", rounds, sourceCacheMisses, cacheComplete: Object.values(sourceCacheMisses).every((value) => value === 0) && rounds.every((round) => Object.values(round.cacheMisses).every((value) => value === 0)), byteIdentical: new Set(rounds.map((round) => round.sha256)).size === 1, valid: rounds.every((round) => round.recordMatches && round.networkCalls === 0) };
await fs.writeFile(path.join(directory, "repeatability.json"), JSON.stringify(verification, null, 2) + "\n");
if (!verification.valid || !verification.byteIdentical) throw new Error("研判录放一致性校验失败");
