import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { gunzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import { parseArgs } from "node:util";
import { canonicalJson } from "../dist/index.js";

const { values } = parseArgs({ options: { record: { type: "string", default: "../../docs/conflict-guard/evidence/stage-5-dev-report" }, cache: { type: "string", default: "bench/model-cache/stage5-dev-final" }, dataset: { type: "string", default: "bench/datasets/d1-v1" } } });
const directory = path.resolve(values.record!);
const read = async (file: string) => JSON.parse(gunzipSync(await fs.readFile(file)).toString());
const recorded = await read(path.join(directory, "results.json.gz"));
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
const comparable = (report: typeof recorded) => canonicalJson(Object.fromEntries(policies.map((id) => {
  const row = report.policies[id];
  return [id, { metrics: row.metrics, groups: row.groups, inputHashes: row.inputHashes, t03: row.t03, model: { tasks: row.model.tasks, successful: row.model.successful, completionRatio: row.model.completionRatio, p50Ms: row.model.p50Ms, p95Ms: row.model.p95Ms } }];
})));
const reference = comparable(recorded);
const rounds: Array<{ round: number; recordMatches: boolean; sha256: string; networkCalls: number }> = [];
for (let round = 1; round <= 3; round += 1) {
  const output = path.join(directory, `replay-${round}`);
  await promisify(execFile)(process.execPath, ["--experimental-strip-types", "scripts/replay-run.ts", "--dataset", values.dataset!, "--policy", policies.join(","), "--provider-mode", "replay", "--config", configuration, "--models", identities, "--cache", values.cache!, "--out", output], { cwd: process.cwd(), maxBuffer: 1024 * 1024 });
  const replayed = await read(path.join(output, "results.json.gz"));
  const networkCalls = policies.reduce((sum, id) => sum + replayed.policies[id].model.httpCalls, 0);
  const bytes = await fs.readFile(path.join(output, "results.json.gz"));
  const result = { round, recordMatches: comparable(replayed) === reference, sha256: createHash("sha256").update(bytes).digest("hex"), networkCalls };
  rounds.push(result);
  console.log(JSON.stringify(result));
}
const verification = { compared: "judgements, outcomes, intervals, metrics, input hashes, completion, recorded latency, T03", rounds, byteIdentical: new Set(rounds.map((round) => round.sha256)).size === 1, valid: rounds.every((round) => round.recordMatches && round.networkCalls === 0) };
await fs.writeFile(path.join(directory, "repeatability.json"), JSON.stringify(verification, null, 2) + "\n");
if (!verification.valid || !verification.byteIdentical) throw new Error("研判录放一致性校验失败");
