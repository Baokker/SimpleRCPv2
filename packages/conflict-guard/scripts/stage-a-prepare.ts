import fs from "node:fs/promises";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import { replayTrace, createReplayModelPolicy, inputHash, type AdjudicationConfig, type AdjudicationInput, type ZoneVerdict } from "../dist/index.js";
import { developmentSamples } from "./model-dataset.ts";
import { replayLibraries } from "./replay-libs.ts";
import { repositoryRoot } from "./model-runtime.ts";

const output = path.join(repositoryRoot, "docs/conflict-guard/experiment/v2/stage-A");
const config: AdjudicationConfig = JSON.parse(await fs.readFile(path.join(output, "config.json"), "utf8"));
const { samples, manifest } = await developmentSamples(path.join(repositoryRoot, "packages/conflict-guard/bench/datasets/d1-v3"));
const libs = await replayLibraries();
const sourceFiles = ["src/adjudication/declarations.ts", "src/adjudication/invariants.ts", "src/adjudication/syntax.ts", "src/adjudication/prompts.ts", "src/adjudication/adapters.ts", "src/adjudication/service.ts", "src/adjudication/config.ts", "src/replay/policies.ts", "src/coordination/session.ts", "src/coordination/pairState.ts", "src/routing/typecheck.ts", "src/semantic/changes.ts"];
const sourceHashes = Object.fromEntries(await Promise.all(sourceFiles.flatMap((file) => [file, file.replace(/^src\//, "dist/").replace(/\.ts$/, ".js")]).map(async (file) => [file, createHash("sha256").update(await fs.readFile(new URL(`../${file}`, import.meta.url))).digest("hex")])));
const requests = new Map<string, { input: AdjudicationInput; local: ZoneVerdict; samples: string[] }>();
const groups = [];
for (const [ordinal, sample] of samples.entries()) {
  const local = replayTrace(sample.trace, { policy: "P3", initialFiles: sample.variant.baseline, libs, seed: sample.group.seed });
  const collect = (input: AdjudicationInput, verdict: ZoneVerdict) => {
    const key = inputHash(input);
    const previous = requests.get(key);
    if (previous) previous.samples.push(sample.label.id);
    else requests.set(key, { input, local: verdict, samples: [sample.label.id] });
  };
  replayTrace(sample.trace, { policy: createReplayModelPolicy(config, new Map(), collect, Object.keys(sample.variant.baseline)), initialFiles: sample.variant.baseline, libs, seed: sample.group.seed });
  groups.push({ id: sample.label.id, relationGroupId: sample.group.id, programHash: sample.programHash, truth: sample.label.label, local });
  console.log(JSON.stringify({ progress: ordinal + 1, total: samples.length, sample: sample.label.id, requests: requests.size }));
}
const inputs = [...requests.values()];
await fs.writeFile(path.join(output, "prepared.json.gz"), gzipSync(JSON.stringify({ dataset: manifest.version, split: "dev", config, sourceHashes, requests: inputs, groups })));
console.log(JSON.stringify({ samples: samples.length, requests: inputs.length, complete: inputs.filter((row) => !row.input.syntax?.deferred).length, incomplete: inputs.filter((row) => row.input.syntax?.deferred).length, modelCalls: 0 }));
