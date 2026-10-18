import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { it } from "node:test";
import { matchingReferenceRows } from "./regressionCoverage.js";

const results = new URL("../results/", import.meta.url);
const selection = JSON.parse(await fs.readFile(new URL("FINAL_RUNS.json", results), "utf8")).regressionV1_5;
const rows = async (directory: string) => (await fs.readFile(new URL(`${directory}/raw.jsonl`, results), "utf8")).trim().split("\n").map(line => JSON.parse(line));
const x1 = await rows(selection.X1);
const oldX1 = await rows(selection.previous.X1);
const x2 = await rows(selection.X2a);
const oldX2 = await rows(selection.previous.X2a);
const callRun = x2.find(row => row.allCalls.length > 1)!;
assert.ok(callRun);

it("accepts the complete saved X1 and X2a records and tool calls", () => {
  assert.equal(matchingReferenceRows(oldX1, x1, "X1").size, 3585);
  const reference = matchingReferenceRows(oldX2, x2, "X2a");
  assert.equal(reference.size, 720);
  for (const row of x2) matchingReferenceRows(reference.get(row.id)!.allCalls, row.allCalls, row.id);
});

it("rejects duplicate X1 records even when the row count and statistics are unchanged", () => {
  const duplicate = x1.find(row => row.id === "B0-D1-v2-001")!;
  const corrupted = x1.map(row => row.id === "B0-D1-v2-002" ? duplicate : row);
  assert.equal(corrupted.length, x1.length);
  assert.throws(() => matchingReferenceRows(oldX1, corrupted, "X1"), /ID/);
});

it("rejects a missing X1 record", () => {
  assert.throws(() => matchingReferenceRows(oldX1, x1.slice(1), "X1"), /ID/);
});

it("rejects duplicate records in the reference run", () => {
  assert.throws(() => matchingReferenceRows([...oldX1, oldX1[0]], x1, "X1"), /ID/);
});

it("rejects a missing tool call within an otherwise complete X2a run", () => {
  assert.throws(() => matchingReferenceRows(callRun.allCalls, callRun.allCalls.slice(1), callRun.id), /ID/);
});

it("rejects duplicate tool calls with the original call count", () => {
  const calls = [...callRun.allCalls];
  calls[1] = calls[0];
  assert.throws(() => matchingReferenceRows(callRun.allCalls, calls, callRun.id), /ID/);
});

it("rejects an extra current record absent from the reference set", () => {
  assert.throws(() => matchingReferenceRows(oldX1.slice(1), x1, "X1"), /ID/);
});
