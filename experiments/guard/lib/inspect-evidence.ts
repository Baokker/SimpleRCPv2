import fs from "node:fs/promises";
import path from "node:path";
import { projectRoot } from "./common.js";

const results = path.join(projectRoot, "experiments/guard/results");
const sample = JSON.parse(await fs.readFile(path.join(results, "SAMPLE_CHECK.json"), "utf8"));
console.log(JSON.stringify(sample, null, 2));
const runRows = (await fs.readFile(path.join(results, "X2/x2-20261006035453/raw.jsonl"), "utf8")).split("\n").filter(Boolean).map(line => JSON.parse(line));
for (const run of runRows.filter(row => row.attempts.some((attempt: any) => attempt.attemptOutcome === "failed-env"))) {
  const trace = (await fs.readFile(run.tracePath, "utf8")).split("\n").filter(Boolean).map(line => JSON.parse(line));
  const tools = new Map<string, any>();
  for (const event of trace) if (event.type === "opencode.message.part.updated" && event.data?.part?.type === "tool") tools.set(event.data.part.callID, event.data.part);
  console.log(JSON.stringify({ id: run.id, failedAttempts: run.attempts.filter((attempt: any) => attempt.attemptOutcome === "failed-env").map((attempt: any) => ({ ...attempt, state: tools.get(attempt.request.callId)?.state })) }, null, 2));
}
