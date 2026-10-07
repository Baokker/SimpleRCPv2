import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import {configSchema, dataset, readJson, readJsonl, root, RunStore, writeJson} from "./common.js";
import {PlatformClient} from "./client.js";
import {runK4} from "./k4.js";

const source = path.join(root, "runs/k4-episode-final-review/raw/P01-T3-same-session-1");
const directory = path.join(root, ".work/k4-resume-validation-v2");
await fs.mkdir(path.dirname(directory), {recursive: true});
const raw = path.join(directory, "raw/P01-T3-same-session-1");
await fs.cp(source, raw, {recursive: true, force: false, errorOnExist: true});
await fs.unlink(path.join(raw, "confirmed-card.json"));
const config = configSchema.parse(await readJson(path.join(root, "review-fixes-system.json")));
const data = await dataset(), api = new PlatformClient(config);
const saved = await readJson(path.join(raw, "project.json"));
const before = (await api.request(api.projectRoute(saved.project, "agent/runs"), saved.members[0])).runs.map((run: {id: string}) => run.id).sort();
const store = await new RunStore(directory).open("k4", config, data);
try {
  await runK4(data, config, store, [{pair: data.transfers.find(pair => pair.id === "P01")!, condition: "T3", variant: "same-session", repetition: 1}]);
} finally {await store.close();}
const after = (await api.request(api.projectRoute(saved.project, "agent/runs"), saved.members[0])).runs.map((run: {id: string}) => run.id).sort();
assert.deepEqual(after, before);
const result = (await readJsonl(path.join(directory, "results.jsonl")))[0];
assert.equal(result.captureBypassed, true);
assert.equal(result.naturallyTriggered, true);
assert.equal(result.cardScope, "team");
await writeJson(path.join(root, "runs/k4-episode-final-review/resume-validation.json"), {newRuns: 0, captureBypassed: result.captureBypassed, naturallyTriggered: result.naturallyTriggered, cardId: result.cardId, cardScope: result.cardScope, targetInjected: result.targetInjected});
console.log("K4 continuation passed; no new Agent runs");
