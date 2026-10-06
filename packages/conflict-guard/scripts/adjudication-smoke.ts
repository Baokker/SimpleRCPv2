import fs from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { createReplayModelPolicy, replayTrace, inputHash, defaultAdjudicationConfig, type AdjudicationInput, type ZoneVerdict } from "../dist/index.js";
import { replayLibraries } from "./replay-libs.ts";
import { developmentSamples } from "./model-dataset.ts";
import { createModelRuntime, loadModelEnvironment } from "./model-runtime.ts";

const { values } = parseArgs({ args: process.argv.slice(2).filter((item) => item !== "--"), options: { dataset: { type: "string", default: "bench/datasets/d1-v1" }, out: { type: "string", default: "../../docs/conflict-guard/evidence/stage-5-smoke" }, count: { type: "string", default: "20" }, "dry-run": { type: "boolean", default: false } } });
const { samples } = await developmentSamples(path.resolve(values.dataset!)); const libs = await replayLibraries();
const selected: Array<{ relationGroupId: string; sampleId: string; input: AdjudicationInput; local: ZoneVerdict }> = [];
const groups = new Set<string>();
for (const { group, variant, trace, label } of samples) {
  if (groups.has(group.id)) continue;
  const requests = new Map<string, { input: AdjudicationInput; local: ZoneVerdict }>();
  replayTrace(trace, { policy: createReplayModelPolicy({ ...defaultAdjudicationConfig, strategy: "G2" }, new Map(), (input, local) => requests.set(inputHash(input), { input, local }), Object.keys(variant.baseline)), initialFiles: variant.baseline, libs });
  const request = [...requests.values()].at(-1);
  if (request) { groups.add(group.id); selected.push({ relationGroupId: group.id, sampleId: label.id, ...request }); }
}
const count = Number(values.count); if (!Number.isInteger(count) || count < 1 || count > 20) throw new Error("冒烟数量必须介于 1 与 20");
if (values["dry-run"]) { console.log(JSON.stringify({ availableGreyGroups: selected.length, requested: count })); process.exit(0); }
if (selected.length < count) throw new Error("开发集灰区关系组数量不足");
loadModelEnvironment();
const out = path.resolve(values.out!); await fs.mkdir(out, { recursive: true });
const reports: Record<string, unknown> = {};
for (const strategy of ["G2", "G1"] as const) {
  const service = createModelRuntime({ ...defaultAdjudicationConfig, strategy }, "record", path.resolve("bench/model-cache/smoke"));
  const results = [];
  for (const request of selected.slice(0, count)) {
    const verdict = await service.judge(request.input, request.local, new AbortController().signal);
    results.push({ relationGroupId: request.relationGroupId, sampleId: request.sampleId, verdict });
    await fs.writeFile(path.join(out, `${strategy}-checkpoint.json`), JSON.stringify({ results, calls: service.calls() }, null, 2) + "\n");
  }
  const latencies = results.map((row) => row.verdict.adjudication!.latencyMs).sort((left, right) => left - right);
  const completion = results.filter((row) => row.verdict.adjudication?.status === "success").length / count;
  reports[strategy] = { planned: count, completion, p50Ms: latencies[Math.ceil(count * 0.5) - 1], p95Ms: latencies[Math.ceil(count * 0.95) - 1], decisions: Object.fromEntries(["allow", "warn", "lock"].map((decision) => [decision, results.filter((row) => row.verdict.decision === decision).length])), calls: service.calls(), results, stats: service.stats() };
  console.log(JSON.stringify({ strategy, completion, ...service.stats() }));
  service.dispose();
}
await fs.writeFile(path.join(out, "results.json"), JSON.stringify({ split: "dev", dataset: values.dataset, config: defaultAdjudicationConfig, groups: count, providers: reports }, null, 2) + "\n");
