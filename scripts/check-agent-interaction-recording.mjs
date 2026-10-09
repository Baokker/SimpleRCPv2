import assert from "node:assert/strict";
import fs from "node:fs/promises";

const evidence = new URL("../docs/foundation/evidence/agent-paid-check/", import.meta.url);
const runs = JSON.parse(await fs.readFile(new URL("runs.json", evidence), "utf8"));
assert.equal(runs.length, 6);
assert.equal(runs.filter((run) => run.status === "completed").length, 5);
assert.equal(runs.filter((run) => run.status === "cancelled").length, 1);
assert.ok(runs.every((run) => run.model === "deepseek-flash"));
const traces = new Map();
for (const run of runs) {
  const record = JSON.parse(await fs.readFile(new URL(`run-${run.id}-${run.status}.json`, evidence), "utf8"));
  assert.equal(record.run.id, run.id);
  assert.equal(record.run.status, run.status);
  traces.set(run.id, record.trace.events);
  if (run.status === "completed") assert.ok(run.output?.trim());
}

const cancelled = runs.find((run) => run.status === "cancelled");
const replacement = runs.find((run) => run.interruptsRunId === cancelled.id);
assert.ok(replacement);
assert.equal(replacement.status, "completed");
assert.equal(cancelled.interruptedByRunId, replacement.id);
assert.equal(cancelled.sessionId, replacement.sessionId);
assert.equal(cancelled.fileChanges.length, 0);
assert.ok(traces.get(cancelled.id).some((event) => event.type === "run_cancelled"));
const questionRuns = runs.filter((run) => traces.get(run.id).some((event) => event.type === "opencode.question.asked"));
assert.equal(questionRuns.length, 3);
for (const run of questionRuns) {
  assert.ok(traces.get(run.id).some((event) => event.type === "opencode.question.replied"));
  assert.equal(run.questions.length, 0);
}

const files = new Map();
for (const name of ["alice-readme.md", "bob-notes.md", "interrupt-readme.md", "team-guide.md", "streaming-check.md"]) {
  files.set(name, await fs.readFile(new URL(`files/${name}`, evidence), "utf8"));
}
assert.ok(files.get("alice-readme.md").includes("ALICE_ONLY_20261009"));
assert.ok(files.get("bob-notes.md").includes("BOB_ONLY_20261009"));
assert.ok(files.get("interrupt-readme.md").includes("FRENCH_NEW_20261009"));
assert.ok(!files.get("interrupt-readme.md").includes("CHINESE_OLD_20261009"));
assert.ok(files.get("team-guide.md").includes("TEAM_SHARED_20261009"));
assert.ok(files.get("streaming-check.md").includes("STREAMING_DONE_20261009"));
const { run: toolRun, recordedAt } = JSON.parse(await fs.readFile(new URL("tool-progress.json", evidence), "utf8"));
assert.equal(toolRun.activity.tools[0].summary, "sleep 30");
assert.ok(Date.parse(recordedAt) - Date.parse(toolRun.activity.tools[0].startedAt) >= 25_000);
assert.ok(toolRun.activity.messages.some((part) => part.text === "开始检查实时正文 STREAMING_20261009"));

const result = {
  model: "deepseek-flash", openCodeVersion: "1.18.31", conflictGuard: "off",
  runs: runs.length, completed: 5, interrupted: 1, questionsAnswered: questionRuns.length,
  recordedTokens: runs.reduce((sum, run) => sum + (run.activity?.tokens?.total ?? 0), 0),
  interruptedRunId: cancelled.id, replacementRunId: replacement.id,
  filesVerified: [...files.keys()], realToolSnapshotAt: recordedAt
};
if (process.argv.includes("--save")) await fs.writeFile(new URL("acceptance.json", evidence), `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify(result, null, 2));
