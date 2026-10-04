import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readTrace, validateTraceDetailed } from "../packages/conflict-guard/dist/index.js";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const memberId = process.argv[2];
assert(memberId, "A project member ID is required");
const outputRoot = path.join(repositoryRoot, "docs/conflict-guard/evidence/self-acceptance");
const headers = { "X-SimpleRCP-Member": memberId };
const stateResponse = await fetch("http://127.0.0.1:4201/api/projects/demo/conflict-guard/state", { headers });
const traceResponse = await fetch("http://127.0.0.1:4201/api/projects/demo/conflict-guard/trace", { headers });
assert.equal(stateResponse.status, 200);
assert.equal(traceResponse.status, 200);
const state = await stateResponse.json();
const source = await traceResponse.text();
const events = readTrace(source);
const validation = validateTraceDetailed(events);
const texts = new Map();
const batches = [];
for (const event of events) {
  if (event.type === "doc_open" || event.type === "mirror_resync") texts.set(event.file, event.text);
  if (event.type === "edit") {
    let text = texts.get(event.file);
    let offset = 0;
    for (const op of event.ops) {
      const start = op.from + offset;
      text = text.slice(0, start) + op.inserted + text.slice(start + op.deleted.length);
      offset += op.inserted.length - op.deleted.length;
    }
    texts.set(event.file, text);
  }
  if (event.type === "batch_closed") {
    const text = texts.get(event.file);
    batches.push({ id: event.id, memberId: event.actor.memberId, file: event.file, ranges: event.ranges, lines: event.ranges.map((range) => lineRange(text, range)), closeReason: event.closeReason });
  }
}
const edits = events.filter((event) => event.type === "edit" && event.origin?.kind === "human");
const elapsedMs = edits.at(-1).at - edits[0].at;
assert(elapsedMs >= 120_000, "The browser observation must contain at least two minutes of edits");
assert.equal(new Set(edits.map((event) => event.origin.memberId)).size, 2);
const counts = Object.fromEntries([...new Set(batches.map((batch) => batch.memberId))].map((id) => [id, batches.filter((batch) => batch.memberId === id).length]));
assert(Object.values(counts).every((count) => count >= 2));
const finalText = await fs.readFile(path.join(repositoryRoot, ".test-workspaces/observe-acceptance/workspaces/demo/src/index.js"), "utf8");
assert.equal(texts.get("src/index.js"), finalText);
const observation = { source: "Playwright CLI with two independent browser sessions and keyboard editing", commit: events.find((event) => event.type === "session_start").gitCommit, mode: "observe", elapsedMs, batchCounts: counts, batches, state: { ...state, changeSets: state.changeSets.map((changeSet) => ({ ...changeSet, files: changeSet.files.map((file) => ({ ...file, lines: file.ranges.map((range) => lineRange(finalText, range)) })) })) }, finalText, validation };
await fs.mkdir(outputRoot, { recursive: true });
await fs.writeFile(path.join(outputRoot, "browser-state.json"), `${JSON.stringify(state, null, 2)}\n`);
await fs.writeFile(path.join(outputRoot, "browser-trace.jsonl"), source);
await fs.writeFile(path.join(outputRoot, "browser-observation.json"), `${JSON.stringify(observation, null, 2)}\n`);
console.log(JSON.stringify({ elapsedMs, batchCounts: counts, validation }));

function lineRange(text, range) {
  return { start: text.slice(0, range.start).split("\n").length, end: text.slice(0, Math.max(range.start, range.end - 1)).split("\n").length };
}
