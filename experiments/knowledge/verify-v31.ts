import assert from "node:assert/strict";
import path from "node:path";
import {configSchema, dataset, exists, readJson, readJsonl, root, writeJson} from "./common.js";
import {PlatformClient} from "./client.js";

const directory = path.join(root, ".work/preflight-v31");
const results = await readJsonl(path.join(directory, "results.jsonl"));
assert.equal(results.length, 4);
for (const pair of ["P01", "P03"]) {
  const rows = results.filter(row => row.pair === pair);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].ta.runId, rows[1].ta.runId);
  assert.ok(rows.every(row => row.recapQuality.validStructure && row.recapQuality.validCitations));
  const treated = rows.find(row => row.condition === "T3")!;
  assert.notEqual(treated.initiator, treated.cardOwner);
  assert.equal(treated.targetInjected, true);
  assert.ok(treated.reuseLatencyMs >= 0);
}
const file = path.join(directory, "cancel-check.json");
if (!await exists(file)) {
  const config = configSchema.parse(await readJson(path.join(root, "formal-v3.json")));
  const api = new PlatformClient(config);
  const data = await dataset();
  const running = await Promise.all(data.tasks.slice(0, 2).map(async task => {
    const raw = path.join(directory, `cancel-${task.id}`);
    const {project, members} = await api.create(task, raw, `cancel-check-${task.id}`);
    await api.configure(project, members[0], {injectEnabled: false, toolEnabled: false});
    const run = await api.run(project, members[0], task.prompt, path.join(raw, "started-run.json"));
    return {project, member: members[0], run, raw};
  }));
  await api.stop(new Error("Preflight cancellation verification"));
  const outcomes = await Promise.all(running.map(async item => {
    const {run} = await api.request(api.projectRoute(item.project, `agent/runs/${item.run.id}`), item.member);
    assert.ok(["cancelled", "completed"].includes(run.status));
    assert.equal(await exists(path.join(item.raw, "interruption.json")), true);
    return {runId: run.id, status: run.status, usage: run.usage ?? null};
  }));
  assert.throws(() => api.checkScheduling(), /cancellation verification/);
  await writeJson(file, {completed: true, outcomes});
}
console.log(JSON.stringify({episodes: 2, tb: 4, citationsValid: true, recipientDiffersFromOwner: true, cancellationVerified: true}));
