import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readTrace, validateTrace } from "@simplercp/conflict-guard";
import { runStage6Tests } from "./stage6-test-runner.js";

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const evidence = path.join(repository, "docs/conflict-guard/evidence/stage-6-smoke");
const summary = JSON.parse(await fs.readFile(path.join(evidence, "results.json"), "utf8"));
for (const name of ["human-agent", "agent-agent"]) {
  const filename = path.join(evidence, `${name}-runs.json`);
  const record = JSON.parse(await fs.readFile(filename, "utf8"));
  const workspace = record.workspace ?? path.join(repository, ".test-workspaces/stage6-real-smoke/workspaces", record.traces[0].run.projectId);
  record.tests = await runStage6Tests(workspace);
  validateTrace(readTrace(await fs.readFile(path.join(evidence, `${name}-trajectory.jsonl`), "utf8")));
  await fs.writeFile(filename, JSON.stringify(record, null, 2) + "\n");
  const entry = summary.find((item: { name: string }) => item.name === name);
  entry.tests = { exitCode: record.tests.exitCode, total: record.tests.total, passed: record.tests.passed, failed: record.tests.failed };
  entry.traceValid = true;
  console.log(JSON.stringify({ scenario: name, tests: record.tests.exitCode, traceValid: true }));
  if (record.tests.exitCode !== 0) process.exitCode = 1;
}
await fs.writeFile(path.join(evidence, "results.json"), JSON.stringify(summary, null, 2) + "\n");
