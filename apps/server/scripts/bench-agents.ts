import fs from "node:fs/promises";
import path from "node:path";
import http from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { createApp } from "../src/createApp.js";
import { loadConfig } from "../src/config.js";
import { attachRealtimeServer } from "../src/realtime.js";
import { redactSensitive } from "../src/agent/traceStore.js";
import type { AgentRun } from "@simplercp/shared";

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
dotenv.config({ path: path.join(repository, ".env") });
const { values } = parseArgs({ options: { dataset: { type: "string", default: "d3" }, injection: { type: "string", default: "on" }, repeat: { type: "string", default: "3" }, tasks: { type: "string" }, out: { type: "string" }, arbitration: { type: "string", default: "owner" }, "card-action": { type: "string", default: "accept" } } });
if (!["on", "off"].includes(values.injection!) || !["accept", "yield"].includes(values["card-action"]!)) throw new Error("Invalid benchmark configuration");
const repeat = Number(values.repeat); if (!Number.isInteger(repeat) || repeat < 1) throw new Error("repeat must be a positive integer");
const dataset = values.dataset === "d3" ? path.join(repository, "packages/conflict-guard/bench/datasets/d3-v0") : path.resolve(values.dataset!);
interface TaskPair { id: string; project: string; ownership: "same" | "cross"; files: string[]; tasks: [string, string] }
const manifest = JSON.parse(await fs.readFile(path.join(dataset, "manifest.json"), "utf8")) as { version: string; seedRoot: string; acceptance: string; tasks: TaskPair[] };
const selected = values.tasks ? manifest.tasks.filter((task) => values.tasks!.split(",").includes(task.id)) : manifest.tasks;
if (!selected.length) throw new Error("No tasks selected");
const evidence = values.out ? path.resolve(values.out) : path.join(repository, "docs/conflict-guard/evidence/stage-7-smoke");
await fs.mkdir(evidence, { recursive: true });
const temporaryRoot = path.join(repository, ".test-workspaces"); await fs.mkdir(temporaryRoot, { recursive: true });
const budgetFile = path.join(temporaryRoot, "stage7-run-budget.json");
const lock = await fs.open(`${budgetFile}.lock`, "wx");
try {
let budget: { used: number; runs: Array<{ taskId: string; injection: string; round: number; runId?: string }> };
try { budget = JSON.parse(await fs.readFile(budgetFile, "utf8")); }
catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; budget = { used: 0, runs: [] }; }
const root = await fs.mkdtemp(path.join(temporaryRoot, "stage7-agents-"));
const seedRoot = path.resolve(dataset, manifest.seedRoot);
const config = loadConfig({ ...process.env, CONFLICT_GUARD: "full", CONFLICT_GUARD_ARBITRATION: values.arbitration!, CONFLICT_GUARD_INTENT_INJECTION: values.injection!, SIMPLERCP_DATA_DIR: root, SIMPLERCP_TERMINAL_ENABLED: "false", SIMPLERCP_OPENCODE_PORT: "4196", SIMPLERCP_AGENT_RUN_TIMEOUT_MS: "240000", SIMPLERCP_AGENT_MAX_CONCURRENT_RUNS: "3" }, repository);
config.importRoots = [seedRoot];
const app = await createApp(config);
const server = http.createServer(app);
const realtime = attachRealtimeServer(server, app.locals.runtimeManager, app.locals.agentRuns, { members: app.locals.members });
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address(); if (!address || typeof address === "string") throw new Error("Server address unavailable");
const origin = `http://127.0.0.1:${address.port}`;
const runCommand = promisify(execFile);
const results: unknown[] = [];
async function join(projectId: string, name: string) {
  const response = await fetch(`${origin}/api/projects/${projectId}/members`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name }) });
  if (!response.ok) throw new Error("Member registration failed"); return (await response.json() as { member: { id: string } }).member.id;
}
async function createRun(projectId: string, memberId: string, task: TaskPair, index: number, round: number) {
  if (budget.used >= 40) throw new Error("Stage 7 run budget reached 40");
  budget.used += 1; const entry = { taskId: task.id, injection: values.injection!, round } as typeof budget.runs[number]; budget.runs.push(entry);
  await fs.writeFile(budgetFile, JSON.stringify(budget, null, 2) + "\n");
  const run = await app.locals.agentRuns.createRun({ projectId, memberId, contexts: task.files.map((file) => ({ type: "file" as const, path: file })), prompt: `${task.tasks[index]}\nUse edit or write tools for all code changes. Do not use bash to write files. Do not inspect parent directories, environment files, credentials, or other projects. If permission is rejected, read the reason, reread the affected files, and adapt your change. Before finishing run the existing tests. Use the files supplied as context; keep your task scope small.` });
  entry.runId = run.id; await fs.writeFile(budgetFile, JSON.stringify(budget, null, 2) + "\n"); return run;
}
async function execute(task: TaskPair, round: number) {
  const name = `${task.id}-${values.injection}-${round}`;
  const project = await app.locals.registry.importDirectory(name, path.join(seedRoot, task.project));
  const runtime = app.locals.runtimeManager.get(project.id);
  const alice = await join(project.id, "Alice"); const bob = task.ownership === "same" ? alice : await join(project.id, "Bob");
  const runs = [await createRun(project.id, alice, task, 0, round), await createRun(project.id, bob, task, 1, round)];
  const deadline = performance.now() + 330_000;
  const handled = new Set<string>(); let latest: AgentRun[] = [];
  while (performance.now() < deadline) {
    for (const card of runtime.conflictGuard!.arbitration.cards.list().filter((card) => card.status === "waiting" && card.suggestionStatus !== "analyzing" && !handled.has(card.id))) {
      if (values["card-action"] === "accept" && card.suggestion) for (const owner of card.owners) runtime.conflictGuard!.arbitration.act(card.id, owner, "accept");
      else runtime.conflictGuard!.arbitration.act(card.id, card.conflict.self.kind === "agent" ? card.conflict.self.ownerId : card.owners.at(-1)!, "yield");
      handled.add(card.id);
    }
    latest = await Promise.all(runs.map((run) => app.locals.agentRuns.getRun(project.id, run.id)));
    if (latest.every((run) => ["completed", "failed", "cancelled"].includes(run.status))) break;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  for (const run of latest.filter((run) => ["queued", "running"].includes(run.status))) await app.locals.agentRuns.cancelRun(project.id, run.id, run.memberId);
  const cleanupDeadline = performance.now() + 65_000;
  while (app.locals.agentRuns.hasActiveTasks()) {
    if (performance.now() > cleanupDeadline) throw new Error("Agent finalization exceeded its budget");
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  await runtime.documents.awaitIdle();
  let acceptance: { exitCode: number; stdout: string; stderr: string };
  try {
    const output = await runCommand(process.execPath, ["--experimental-strip-types", "--test", path.join(dataset, manifest.acceptance)], { cwd: runtime.project.workspacePath, env: { ...process.env, D3_WORKSPACE: runtime.project.workspacePath, D3_TASK: task.id }, timeout: 20_000, maxBuffer: 1024 * 1024 });
    acceptance = { exitCode: 0, ...output };
  } catch (error) { const failure = error as { code?: number; stdout?: string; stderr?: string }; acceptance = { exitCode: typeof failure.code === "number" ? failure.code : 1, stdout: failure.stdout ?? "", stderr: failure.stderr ?? "" }; }
  const traces = await Promise.all(runs.map(async (run) => ({ run: await app.locals.agentRuns.getRun(project.id, run.id), events: await app.locals.agentRuns.listTrace(project.id, run.id) })));
  const result = redactSensitive({ taskId: task.id, project: task.project, ownership: task.ownership, injection: values.injection, round, acceptance, arbitration: runtime.conflictGuard!.arbitration.stats(), cards: runtime.conflictGuard!.arbitration.cards.list(), intents: runtime.conflictGuard!.arbitration.board.list(), traces }, config.sensitiveValues);
  await fs.writeFile(path.join(evidence, `${name}.json`), JSON.stringify(result, null, 2) + "\n");
  await fs.writeFile(path.join(evidence, `${name}.jsonl`), await runtime.conflictGuard!.exportTrace());
  results.push({ name, success: acceptance.exitCode === 0, statuses: traces.map(({ run }) => run.status), rejected: traces.map(({ run }) => run.conflictGuard?.rejectedEdits ?? 0), interruptions: runtime.conflictGuard!.arbitration.stats(), budgetUsed: budget.used });
  await fs.writeFile(path.join(evidence, `results-${values.injection}.json`), JSON.stringify(results, null, 2) + "\n");
  await fs.writeFile(path.join(evidence, "run-budget.json"), JSON.stringify(budget, null, 2) + "\n");
  console.log(JSON.stringify(results.at(-1)));
}
try { for (let round = 1; round <= repeat; round += 1) for (const task of selected) { if (budget.used + 2 > 40) throw new Error("Stage 7 run budget reached 40"); await execute(task, round); } }
finally {
  await app.locals.agentRuns.dispose(); await app.locals.agentRuntime.dispose(); realtime.dispose(); await app.locals.runtimeManager.dispose();
  await new Promise<void>((resolve) => server.close(() => resolve()));
}
} finally { await lock.close(); await fs.unlink(`${budgetFile}.lock`); }
