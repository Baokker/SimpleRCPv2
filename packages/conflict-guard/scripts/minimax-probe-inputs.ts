import fs from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { createReplayModelPolicy, defaultAdjudicationConfig, replayTrace, inputHash, type AdjudicationInput } from "../dist/index.js";
import { developmentSamples } from "./model-dataset.ts";
import { replayLibraries } from "./replay-libs.ts";

const { values } = parseArgs({ options: { dataset: { type: "string", default: "bench/datasets/d1-v2" }, out: { type: "string", default: "../../docs/conflict-guard/evidence/minimax-probe/inputs.json" } } });
const { samples } = await developmentSamples(path.resolve(values.dataset!));
const inputs = new Map<string, AdjudicationInput>();
const origins: Record<string, unknown> = {};
const libs = await replayLibraries();
for (const sample of samples) {
  const policy = createReplayModelPolicy({ ...defaultAdjudicationConfig, strategy: "G1" }, new Map(), (input) => {
    const hash = inputHash(input);
    if (inputs.size < 5 && !inputs.has(hash)) {
      inputs.set(hash, input);
      origins[hash] = { sample: sample.label.id, relationGroup: sample.group.id, split: "dev" };
    }
  }, Object.keys(sample.variant.baseline));
  replayTrace(sample.trace, { policy, initialFiles: sample.variant.baseline, libs, seed: sample.group.seed });
  if (inputs.size === 5) break;
}
if (inputs.size !== 5) throw new Error("开发集不足五个不同的灰区输入");
const output = path.resolve(values.out!);
await fs.mkdir(path.dirname(output), { recursive: true });
await fs.writeFile(output, JSON.stringify([...inputs.values()], null, 2) + "\n");
await fs.writeFile(path.join(path.dirname(output), "input-origins.json"), JSON.stringify(origins, null, 2) + "\n");
console.log(JSON.stringify({ inputs: inputs.size, split: "dev", onlineCalls: 0 }));
