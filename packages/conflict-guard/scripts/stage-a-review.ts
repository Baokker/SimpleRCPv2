import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { diffJson } from "diff";
import { replayTrace, createReplayModelPolicy, inputHash, type AdjudicationInput, type ZoneVerdict } from "../dist/index.js";
import { repositoryRoot } from "./model-runtime.ts";
import { developmentSamples } from "./model-dataset.ts";
import { replayLibraries } from "./replay-libs.ts";

const directory = path.join(repositoryRoot, "docs/conflict-guard/experiment/v2/stage-A");
const recorded = JSON.parse(gunzipSync(await fs.readFile(path.join(directory, "pair-v1/G1/results.json.gz"))).toString());
const responses = new Map<string, ZoneVerdict>(recorded.responses);
const historicalInputs = new Set<string>(recorded.inputs.map((row: { input: AdjudicationInput }) => inputHash(row.input)));
const requests = new Map<string, { input: AdjudicationInput; complete: boolean; samples: Set<string> }>();
const { samples } = await developmentSamples(path.join(repositoryRoot, "packages/conflict-guard/bench/datasets/d1-v3"));
const libs = await replayLibraries();
const groups = [];
for (const sample of samples) {
  const result = replayTrace(sample.trace, { initialFiles: sample.variant.baseline, libs, seed: sample.group.seed, policy: createReplayModelPolicy(recorded.config, responses, (input) => {
    const key = inputHash(input);
    const request = requests.get(key) ?? { input, complete: !input.syntax?.deferred, samples: new Set<string>() };
    request.samples.add(sample.label.id);
    requests.set(key, request);
  }, Object.keys(sample.variant.baseline)) });
  assert.deepEqual(result.errors, [], sample.label.id);
  groups.push({ id: sample.label.id, judgements: result.judgements.length, closures: result.coordinationEvents.filter((event) => event.type === "pair_closed").map((event) => ({ at: event.at, pairId: event.pairId, reason: event.closeReason })) });
  if (groups.length % 10 === 0) console.log(JSON.stringify({ samples: groups.length, total: samples.length, modelCalls: 0 }));
}
assert.ok(groups.find((group) => group.id === "d1-0026-conflict")!.judgements > 0);
assert.ok(groups.find((group) => group.id === "d1-0066-safe")!.closures.some((event) => event.reason === "no-semantic-change"));
assert.ok(groups.every((group) => group.closures.every((event) => typeof event.reason === "string")));
const sourceFiles = ["adjudication/declarations.ts", "adjudication/invariants.ts", "adjudication/syntax.ts", "adjudication/adapters.ts", "semantic/changes.ts", "coordination/session.ts", "coordination/pairState.ts"];
const sourceHashes = Object.fromEntries(await Promise.all(sourceFiles.map(async (file) => [file, createHash("sha256").update(await fs.readFile(new URL(`../src/${file}`, import.meta.url))).digest("hex")])));
const inputRows = [...requests].map(([hash, row]) => {
  const presentInRecording = historicalInputs.has(hash);
  const candidates = presentInRecording ? [] : recorded.inputs.filter((entry: { input: AdjudicationInput }) => entry.input.left.symbol === row.input.left.symbol && entry.input.right.symbol === row.input.right.symbol).map((entry: { input: AdjudicationInput }) => {
    const changes = diffJson(entry.input, row.input).filter((change) => change.added || change.removed);
    return { previousHash: inputHash(entry.input), changes, size: changes.reduce((sum, change) => sum + change.value.length, 0) };
  }).sort((left: { size: number }, right: { size: number }) => left.size - right.size);
  return { hash, complete: row.complete, presentInRecording, samples: [...row.samples], ...(!presentInRecording ? { difference: candidates[0] } : {}) };
});
const output = { source: "offline-replay-current-code", split: "dev", modelCalls: 0, samples: groups.length, historicalInputs: historicalInputs.size, currentInputs: requests.size, matchingInputs: inputRows.filter((row) => row.presentInRecording).length, missingInputs: inputRows.filter((row) => !row.presentInRecording), completeInputs: inputRows.filter((row) => row.complete).length, incompleteInputs: inputRows.filter((row) => !row.complete).length, sourceHashes, inputs: inputRows, groups };
await fs.writeFile(path.join(directory, "review-validation.json"), JSON.stringify(output, null, 2) + "\n");
console.log(JSON.stringify({ samples: output.samples, currentInputs: output.currentInputs, matchingInputs: output.matchingInputs, missingInputs: output.missingInputs.length, modelCalls: 0 }));
