import fs from "node:fs/promises";
import path from "node:path";
import {spawn} from "node:child_process";
import {once} from "node:events";
import {platformRoot, root, exec, readJsonl, writeJson} from "./common.js";

const prefix = "experiments/knowledge/runs/";
const config = "experiments/knowledge/formal-v3.json";
const steps = [
  {id: "EXP3", command: "k3", name: "exp3-freeze-v3", count: 198, args: ["--conditions", "C0,C2,C5"]},
  {id: "EXP4", command: "k4", name: "exp4-freeze-v3", count: 54, args: ["--conditions", "T0,T3", "--shared-episode"]}
];
const first = process.argv[2] ?? "EXP3";
const last = process.argv[3] ?? "EXP4";
const start = steps.findIndex(step => step.id === first), end = steps.findIndex(step => step.id === last);
if (start < 0 || end < start) throw new Error("Unknown formal experiment range");
const commit = (await exec("git", ["rev-parse", "HEAD"], {cwd: platformRoot})).stdout.trim();
const freeze = (await exec("git", ["rev-parse", "knowledge-exp-freeze-v3"], {cwd: platformRoot})).stdout.trim();
if (commit !== freeze) throw new Error("Formal runs require the knowledge-exp-freeze-v3 commit");
async function command(binary: string, args: string[], log: string) {
  const file = await fs.open(log, "a", 0o600);
  const child = spawn(binary, args, {cwd: platformRoot, stdio: ["ignore", file.fd, file.fd]});
  const [code, signal] = await once(child, "exit");
  await file.close();
  if (code !== 0) throw new Error(`Experiment command failed: ${code}/${signal}; ${log}`);
}
for (const step of steps.slice(start, end + 1)) {
  const output = path.join(root, "runs", step.name);
  await fs.mkdir(output, {recursive: true});
  const args = ["--filter", "@simplercp/experiments", "experiment", step.command, "--config", config, "--out", prefix + step.name, ...step.args];
  await writeJson(path.join(output, "command.json"), {binary: "pnpm", args, freeze: "knowledge-exp-freeze-v3", commit});
  console.log(JSON.stringify({step: step.id, status: "running", output}));
  await command("pnpm", args, path.join(output, "runner.log"));
  const rows = await readJsonl(path.join(output, "results.jsonl"));
  if (rows.some(row => !row.completed || row.commit !== freeze || row.provider !== "minimax" || row.model !== "MiniMax-M3") || new Set(rows.map(row => row.key)).size !== rows.length || step.count !== null && rows.length !== step.count) throw new Error(`Unexpected formal result metadata or sample count: ${step.id}`);
  await command("pnpm", ["--filter", "@simplercp/experiments", "experiment", "summarize", "--config", config, "--source", prefix + step.name], path.join(output, "summary.log"));
  await command(path.join(root, "analysis/.venv/bin/python"), [path.join(root, "analysis/analyze.py"), path.join(output, "results.jsonl"), "--out", path.join(output, "analysis/statistics")], path.join(output, "analysis.log"));
  await writeJson(path.join(output, "checkpoint.json"), {step: step.id, completed: true, samples: rows.length, checkedAt: new Date().toISOString(), failures: rows.filter(row => row.failed || row.runStatus && row.runStatus !== "completed").map(row => ({key: row.key, failureReason: row.failureReason ?? row.runStatus}))});
  console.log(JSON.stringify({step: step.id, status: "completed", samples: rows.length}));
}
