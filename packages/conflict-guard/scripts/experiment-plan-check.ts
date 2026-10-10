import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createExperimentBudget } from "./experiment-budget.ts";

const repository = fileURLToPath(new URL("../../../", import.meta.url));
const protocol = JSON.parse(await fs.readFile(path.join(repository, "docs/conflict-guard/experiment/protocol.json"), "utf8"));
const rows = [];
for (const experiment of protocol.experiments) {
  for (const command of [experiment.command, ...(experiment.commands ?? [])]) {
    assert.equal(typeof command, "string");
    const { stdout } = await promisify(execFile)("/bin/sh", ["-c", `${command} --plan`], { cwd: repository, maxBuffer: 1024 * 1024 });
    const line = stdout.trim().split("\n").at(-1)!;
    const result = JSON.parse(line);
    assert.equal(result.executed, false);
    assert.equal(result.modelCalls ?? result.calls ?? 0, 0);
    rows.push({ experiment: experiment.id, command, result });
  }
}
if (protocol.status === "awaiting-human-confirmation") await assert.rejects(createExperimentBudget("X5"), /尚未获得人工确认/);
const output = path.join(repository, "docs/conflict-guard/evidence/preexperiment/entry-check.json");
await fs.writeFile(output, JSON.stringify({ commands: rows, pendingFreezeRejected: protocol.status === "awaiting-human-confirmation", modelCalls: 0, agentRuns: 0, holdoutPolicyEvaluations: 0 }, null, 2) + "\n");
console.log(JSON.stringify({ commands: rows.length, modelCalls: 0, agentRuns: 0, holdoutPolicyEvaluations: 0 }));
