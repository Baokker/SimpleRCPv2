import fs from "node:fs/promises";
import path from "node:path";
import http from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import dotenv from "dotenv";
import WebSocket from "ws";
import { WebsocketProvider } from "y-websocket";
import * as Y from "yjs";
import { createApp } from "../src/createApp.js";
import { loadConfig } from "../src/config.js";
import { attachRealtimeServer } from "../src/realtime.js";
import { redactSensitive } from "../src/agent/traceStore.js";
import type { AgentRun } from "@simplercp/shared";
import { createExperimentBudget, createRehearsalBudget } from "../../../packages/conflict-guard/scripts/experiment-budget.ts";
import { createAgentBenchmarkProxy } from "./agent-benchmark-proxy.ts";

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
dotenv.config({ path: path.join(repository, ".env") });
const { values } = parseArgs({ options: { dataset: { type: "string", default: "d3" }, policy: { type: "string", default: "P5" }, experiment: { type: "string", default: "X5" }, plan: { type: "boolean", default: false }, config: { type: "string" }, injection: { type: "string", default: "on" }, repeat: { type: "string", default: "3" }, tasks: { type: "string" }, scenarios: { type: "string" }, out: { type: "string" }, arbitration: { type: "string", default: "owner" }, "card-action": { type: "string", default: "accept" }, rehearsal: { type: "string" } } });
if (!["P0", "P3", "P5"].includes(values.policy!) || !["E3", "X5", "X6"].includes(values.experiment!) || !["owner", "all-human", "all-auto"].includes(values.arbitration!)) throw new Error("实验策略、编号或仲裁模式无效");
if (!["on", "off"].includes(values.injection!) || !["accept", "yield"].includes(values["card-action"]!)) throw new Error("Invalid benchmark configuration");
const repeat = Number(values.repeat); if (!Number.isInteger(repeat) || repeat < 1) throw new Error("repeat must be a positive integer");
const dataset = values.dataset === "d3" ? path.join(repository, "packages/conflict-guard/bench/datasets/d3-v0") : path.resolve(values.dataset!);
interface TaskPair { id: string; project: string; ownership: "same" | "cross"; files: string[]; tasks: [string, string]; humanSide?: boolean; humanEdits?: Array<{ file: string; find: string; replace: string }>; acceptanceTask?: string }
const manifest = JSON.parse(await fs.readFile(path.join(dataset, "manifest.json"), "utf8")) as { version: string; seedRoot: string; acceptance: string; tasks: TaskPair[] };
const scenarioTasks = values.scenarios ? await loadScenarioTasks(values.scenarios, manifest.tasks) : undefined;
const selected = scenarioTasks ?? (values.tasks ? manifest.tasks.filter((task) => values.tasks!.split(",").includes(task.id)) : manifest.tasks);
if (!selected.length) throw new Error("No tasks selected");
if (values.tasks && selected.length !== new Set(values.tasks.split(",")).size) throw new Error("部分任务编号不存在");
const agentRunsPerRound = selected.reduce((sum, task) => sum + (task.humanSide ? 1 : 2), 0);
if (values.plan) { console.log(JSON.stringify({ experiment: values.experiment, policy: values.policy, injection: values.injection, arbitration: values.arbitration, tasks: selected.length, repeat, agentBaseRuns: agentRunsPerRound * repeat, executed: false })); process.exit(0); }
const budget = values.rehearsal ? await createRehearsalBudget(values.rehearsal) : await createExperimentBudget(values.experiment!);
const evidence = values.out ? path.resolve(values.out) : path.join(repository, `docs/conflict-guard/experiment/${values.experiment}/${values.policy}/${values.injection}`);
await fs.mkdir(evidence, { recursive: true });
const temporaryRoot = path.join(repository, ".test-workspaces"); await fs.mkdir(temporaryRoot, { recursive: true });
const root = await fs.mkdtemp(path.join(temporaryRoot, "stage8-agents-"));
const seedRoot = path.resolve(dataset, manifest.seedRoot);
const portServer = http.createServer();
await new Promise<void>((resolve) => portServer.listen(0, "127.0.0.1", resolve));
const portAddress = portServer.address();
if (!portAddress || typeof portAddress === "string") throw new Error("OpenCode 端口分配失败");
const openCodePort = portAddress.port;
await new Promise<void>((resolve) => portServer.close(() => resolve()));
const config = loadConfig({ ...process.env, SIMPLERCP_AGENT_PROVIDER: "minimax", CONFLICT_GUARD: ({ P0: "off", P3: "rules", P5: "full" } as Record<string, string>)[values.policy!]!, CONFLICT_GUARD_ARBITRATION: values.arbitration!, CONFLICT_GUARD_INTENT_INJECTION: values.injection!, SIMPLERCP_DATA_DIR: root, SIMPLERCP_TERMINAL_ENABLED: "false", SIMPLERCP_OPENCODE_PORT: String(openCodePort), SIMPLERCP_AGENT_RUN_TIMEOUT_MS: "240000", SIMPLERCP_AGENT_MAX_CONCURRENT_RUNS: "3" }, repository);
const runtimeConfig = JSON.parse(await fs.readFile(values.config ? path.resolve(values.config) : path.join(repository, "docs/conflict-guard/experiment/runtime-config.json"), "utf8"));
for (const field of ["idleMs", "cursorLeaveLines", "maxBatchDurationMs", "activeIdleMs", "cursorDebounceMs", "bodyUnrelatedMaxAdjacentLines", "judgementFrameMs", "maxJudgementsPerFrame"] as const) if (runtimeConfig[field] !== undefined) config.conflictGuard![field] = runtimeConfig[field];
if (config.conflictGuard?.adjudication) {
  config.conflictGuard.adjudication.settings = { ...runtimeConfig.adjudication, strategy: "G4" };
  config.conflictGuard.adjudication.cacheDirectory = path.join(evidence, "model-cache");
}
if (!config.agent?.apiKey) throw new Error("Agent 模型凭据未配置");
if (!runtimeConfig.adjudication?.prices?.site || runtimeConfig.models?.minimax !== "MiniMax-M3") throw new Error("冻结配置缺少 MiniMax-M3 站点");
config.agent.baseUrl = runtimeConfig.adjudication.prices.site;
config.agent.model = runtimeConfig.models.minimax;
if (config.conflictGuard?.adjudication) config.conflictGuard.adjudication.minimax = { ...config.conflictGuard.adjudication.minimax, baseUrl: config.agent.baseUrl, model: config.agent.model };
const proxy = await createAgentBenchmarkProxy({ baseUrl: config.agent.baseUrl, apiKey: config.agent.apiKey, budget });
config.agent.baseUrl = proxy.baseUrl;
if (config.conflictGuard?.adjudication) config.conflictGuard.adjudication.fetch = async (url, init) => {
  await budget.consume(String(url).endsWith("/v1/systemone") ? "fast" : "deep");
  return fetch(url, init);
};
config.importRoots = [seedRoot];
const app = await createApp(config).catch(async (error) => { await proxy.dispose(); throw error; });
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
  await budget.consume("agentBaseRuns");
  const run = await app.locals.agentRuns.createRun({ projectId, memberId, contexts: task.files.map((file) => ({ type: "file" as const, path: file })), prompt: `${task.tasks[index]}\nExperiment execution identifier: ${randomUUID()}.\nUse edit or write tools for all code changes. Do not use bash to write files. Do not inspect parent directories, environment files, credentials, or other projects. If permission is rejected, read the reason, reread the affected files, and adapt your change. Before finishing run the existing tests. Use the files supplied as context; keep your task scope small.` });
  return run;
}
async function execute(task: TaskPair, round: number) {
  const name = `${task.id}-${values.policy}-${values.injection}-${values.arbitration}-${round}`;
  const project = await app.locals.registry.importDirectory(name, path.join(seedRoot, task.project));
  const runtime = app.locals.runtimeManager.get(project.id);
  const alice = await join(project.id, "Alice"); const bob = task.ownership === "same" ? alice : await join(project.id, "Bob");
  const runs = task.humanSide ? [await createRun(project.id, bob, task, 1, round)] : [await createRun(project.id, alice, task, 0, round), await createRun(project.id, bob, task, 1, round)];
  const humanDocuments: Array<{ document: Y.Doc; provider: WebsocketProvider }> = [];
  // Agent 启动时已通过上下文获得两个文件的旧内容；人的修改在 Agent 完成第一次工具调用之后写入，使 Agent 依据过时内容继续工作。60 秒内没有工具调用时按时间写入。
  const humanTrigger: { kind: "after-first-agent-tool" | "timeout" | "anchor-missing"; atMs: number }[] = [];
  const injectionStarted = performance.now();
  const agentUsedTool = async () => (await app.locals.agentRuns.listTrace(project.id, runs[0]!.id)).some((event: { type?: string; data?: { part?: { type?: string; state?: { status?: string } } } }) =>
    event.type === "opencode.message.part.updated" && event.data?.part?.type === "tool" && event.data.part.state?.status === "completed");
  const humanInjection = task.humanSide ? (async () => {
    while (performance.now() - injectionStarted < 60_000 && !await agentUsedTool()) await new Promise((resolve) => setTimeout(resolve, 100));
    humanTrigger.push({ kind: performance.now() - injectionStarted < 60_000 ? "after-first-agent-tool" : "timeout", atMs: Math.round(performance.now() - injectionStarted) });
    // 虚拟成员通过协同文档写入，守卫把它记为该成员正在进行的修改，而不是磁盘上的外部变更。
    for (const edit of task.humanEdits ?? []) {
      const document = new Y.Doc();
      const provider = new WebsocketProvider(`${origin.replace("http", "ws")}/yjs/${project.id}`, encodeURIComponent(`${runtime.room.id}:${edit.file}`), document,
        { disableBc: true, params: { memberId: alice }, WebSocketPolyfill: WebSocket as unknown as typeof globalThis.WebSocket });
      humanDocuments.push({ document, provider });
      await new Promise<void>((resolve, reject) => { provider.once("sync", (synced: boolean) => { if (synced) resolve(); }); provider.once("connection-error", reject); });
      const text = document.getText("content");
      const start = text.toString().indexOf(edit.find);
      // Agent 已先改写同一位置时，人的修改无法按原文定位，记录后跳过。
      if (start < 0) { humanTrigger.push({ kind: "anchor-missing", atMs: Math.round(performance.now() - injectionStarted) }); continue; }
      document.transact(() => { text.delete(start, edit.find.length); text.insert(start, edit.replace); });
    }
  })() : Promise.resolve();
  const deadline = performance.now() + 330_000;
  const handled = new Set<string>(); let latest: AgentRun[] = [];
  while (performance.now() < deadline) {
    proxy.assertHealthy();
    for (const card of (runtime.conflictGuard?.arbitration.cards.list() ?? []).filter((card) => card.status === "waiting" && card.suggestionStatus !== "analyzing" && !handled.has(card.id))) {
      if (values["card-action"] === "accept" && card.suggestion) for (const owner of card.owners) runtime.conflictGuard!.arbitration.act(card.id, owner, "accept");
      else runtime.conflictGuard!.arbitration.act(card.id, card.conflict.self.kind === "agent" ? card.conflict.self.ownerId : card.owners.at(-1)!, "yield");
      handled.add(card.id);
    }
    latest = await Promise.all(runs.map((run) => app.locals.agentRuns.getRun(project.id, run.id)));
    if (latest.every((run) => ["completed", "failed", "cancelled"].includes(run.status)) && await Promise.race([humanInjection.then(() => true), new Promise(() => false)])) break;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  for (const run of latest.filter((run) => ["queued", "running"].includes(run.status))) await app.locals.agentRuns.cancelRun(project.id, run.id, run.memberId);
  await humanInjection;
  for (const { document, provider } of humanDocuments) { provider.destroy(); document.destroy(); }
  const cleanupDeadline = performance.now() + 65_000;
  while (app.locals.agentRuns.hasActiveTasks()) {
    if (performance.now() > cleanupDeadline) throw new Error("Agent finalization exceeded its budget");
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  await runtime.documents.awaitIdle();
  let acceptance: { exitCode: number; stdout: string; stderr: string };
  try {
    const output = await runCommand(process.execPath, ["--experimental-strip-types", "--test", path.join(dataset, manifest.acceptance)], { cwd: runtime.project.workspacePath, env: { ...process.env, D3_WORKSPACE: runtime.project.workspacePath, D3_TASK: task.acceptanceTask ?? task.id }, timeout: 20_000, maxBuffer: 1024 * 1024 });
    acceptance = { exitCode: 0, ...output };
  } catch (error) { const failure = error as { code?: number; stdout?: string; stderr?: string }; acceptance = { exitCode: typeof failure.code === "number" ? failure.code : 1, stdout: failure.stdout ?? "", stderr: failure.stderr ?? "" }; }
  const traces = await Promise.all((await app.locals.agentRuns.listRuns(project.id)).map(async (run) => ({ run, events: await app.locals.agentRuns.listTrace(project.id, run.id) })));
  const tokens = traces.map(({ run }) => run.activity?.tokens);
  const prices = runtimeConfig.adjudication.prices;
  const agentNativeCost = tokens.reduce((sum, usage) => sum + (usage ? ((usage.input + usage.cacheWrite) * prices.deepInputPerMillion + usage.cacheRead * (prices.deepCacheReadPerMillion ?? prices.deepInputPerMillion) + usage.output * prices.deepOutputPerMillion) / 1e6 : 0), 0);
  const agentCostUsd = agentNativeCost * (prices.usdPerCurrencyUnit ?? 1);
  const guardEvents = runtime.conflictGuard ? await runtime.conflictGuard.exportTrace() : "";
  const guardCostUsd = guardEvents.split("\n").filter(Boolean).map((line) => JSON.parse(line)).filter((event) => event.type === "provider_call" && event.status !== "cache-hit").reduce((sum, event) => sum + (event.costUsd ?? 0), 0);
  await budget.consume("usd", agentCostUsd + guardCostUsd);
  const result = redactSensitive({ taskId: task.id, project: task.project, ownership: task.ownership, policy: values.policy, injection: values.injection, arbitrationMode: values.arbitration, round, initialRunIds: runs.map((run) => run.id), humanInjection: task.humanSide ? { member: "virtual-human", edits: task.humanEdits ?? [], trigger: humanTrigger[0] ?? null, anchorMissing: humanTrigger.some((item) => item.kind === "anchor-missing") } : null, acceptance, arbitration: runtime.conflictGuard?.arbitration.stats() ?? null, cards: runtime.conflictGuard?.arbitration.cards.list() ?? [], intents: runtime.conflictGuard?.arbitration.board.list() ?? [], agentCostUsd, agentNativeCost, agentCurrency: prices.currency ?? "USD", guardCostUsd, unknownUsageRuns: traces.filter(({ run }) => !run.activity?.tokens).map(({ run }) => run.id), traces }, config.sensitiveValues);
  await fs.writeFile(path.join(evidence, `${name}.json`), JSON.stringify(result, null, 2) + "\n");
  await fs.writeFile(path.join(evidence, `${name}.jsonl`), guardEvents);
  results.push({ name, taskId: task.id, ownership: task.ownership, round, success: acceptance.exitCode === 0, statuses: traces.map(({ run }) => run.status), rejected: traces.map(({ run }) => run.conflictGuard?.rejectedEdits ?? 0), interruptions: runtime.conflictGuard?.arbitration.stats() ?? null });
  await fs.writeFile(path.join(evidence, `results-${values.injection}.json`), JSON.stringify(results, null, 2) + "\n");
  await fs.writeFile(path.join(evidence, "run-budget.json"), JSON.stringify(await budget.snapshot(), null, 2) + "\n");
  console.log(JSON.stringify(results.at(-1)));
}
async function loadScenarioTasks(file: string, sourceTasks: TaskPair[]): Promise<TaskPair[]> {
  const scenarioFile = path.resolve(file);
  const definition = JSON.parse(await fs.readFile(scenarioFile, "utf8")) as { scenarios: Array<{ id: string; category: string; sourceTasks: string[]; initialCode: string[]; humanTask?: string; agentTask?: string; agentTasks?: string[]; agentPrompt?: string; agentPrompts?: string[]; humanEdits?: Array<{ file: string; find: string; replace: string }> }> };
  return definition.scenarios.map((scenario) => {
    const source = sourceTasks.find((task) => task.id === scenario.sourceTasks[0]);
    if (!source) throw new Error(`场景引用的任务不存在：${scenario.id}`);
    // agentPrompt 与 agentPrompts 是发给 Agent 的完整任务；缺省时沿用场景摘要。
    const tasks: [string, string] = scenario.category === "人与 Agent" ? [scenario.humanTask!, scenario.agentPrompt ?? scenario.agentTask!] : [scenario.agentPrompts?.[0] ?? scenario.agentTasks![0]!, scenario.agentPrompts?.[1] ?? scenario.agentTasks![1]!];
    // 场景类别决定属主关系，来源任务的 ownership 只描述 d3-v0 原任务。
    const ownership: TaskPair["ownership"] = scenario.category === "同属主的两个 Agent" ? "same" : "cross";
    return { ...source, id: scenario.id, ownership, tasks, humanSide: scenario.category === "人与 Agent", humanEdits: scenario.humanEdits, acceptanceTask: scenario.sourceTasks[0] };
  });
}
await fs.writeFile(path.join(evidence, "command.txt"), `pnpm --filter @simplercp/server bench:agents ${process.argv.slice(2).join(" ")}\n`);
await fs.writeFile(path.join(evidence, "config.json"), JSON.stringify({ dataset: manifest.version, policy: values.policy, injection: values.injection, arbitration: values.arbitration, repetitions: repeat, runtimeConfig, provider: config.agent.provider, model: config.agent.model }, null, 2) + "\n");
try { for (let round = 1; round <= repeat; round += 1) for (const task of selected) await execute(task, round); }
finally {
  await app.locals.agentRuns.dispose(); await app.locals.agentRuntime.dispose(); realtime.dispose(); await app.locals.runtimeManager.dispose();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await proxy.dispose();
  await fs.writeFile(path.join(evidence, "agent-requests.json"), JSON.stringify(proxy.records, null, 2) + "\n");
}
