import fs from "node:fs/promises";
import path from "node:path";
import http from "node:http";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import WebSocket from "ws";
import { WebsocketProvider } from "y-websocket";
import * as Y from "yjs";
import { createApp } from "../src/createApp.js";
import { loadConfig } from "../src/config.js";
import { attachRealtimeServer } from "../src/realtime.js";
import { redactSensitive } from "../src/agent/traceStore.js";
import type { AgentRun } from "@simplercp/shared";
import { runStage6Tests } from "./stage6-test-runner.js";

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
dotenv.config({ path: path.join(repository, ".env") });
const evidence = path.join(repository, "docs/conflict-guard/evidence/stage-6-smoke");
const workspaceRoot = path.join(repository, ".test-workspaces");
await fs.mkdir(workspaceRoot, { recursive: true });
const root = await fs.mkdtemp(path.join(workspaceRoot, "stage6-real-smoke-"));
await fs.mkdir(evidence, { recursive: true });
const config = loadConfig({ ...process.env, CONFLICT_GUARD: "full", SIMPLERCP_DATA_DIR: root, SIMPLERCP_OPENCODE_PORT: "4197", SIMPLERCP_AGENT_RUN_TIMEOUT_MS: "240000" }, repository);
config.terminalEnabled = false;
config.importRoots = [path.join(repository, "demo")];
const app = await createApp(config);
const server = http.createServer(app);
const realtime = attachRealtimeServer(server, app.locals.runtimeManager, app.locals.agentRuns, { members: app.locals.members });
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
if (!address || typeof address === "string") throw new Error("服务器地址无效");
const origin = `http://127.0.0.1:${address.port}`;
const providers: Array<{ provider: WebsocketProvider; document: Y.Doc }> = [];
const report: unknown[] = [];

async function member(projectId: string, name: string) {
  const response = await fetch(`${origin}/api/projects/${projectId}/members`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name }) });
  if (!response.ok) throw new Error("成员注册失败");
  return (await response.json() as { member: { id: string } }).member.id;
}
async function connect(projectId: string, roomId: string, file: string, memberId: string) {
  const document = new Y.Doc();
  const provider = new WebsocketProvider(`${origin}/yjs/${projectId}`, encodeURIComponent(`${roomId}:${file}`), document, { disableBc: true, params: { memberId }, WebSocketPolyfill: WebSocket as unknown as typeof globalThis.WebSocket });
  providers.push({ provider, document });
  await new Promise<void>((resolve, reject) => { provider.once("sync", (synced) => { if (synced) resolve(); }); provider.once("connection-error", reject); });
  return document;
}
async function complete(projectId: string, id: string) {
  const deadline = performance.now() + 300000;
  while (performance.now() < deadline) {
    const run = await app.locals.agentRuns.getRun(projectId, id) as AgentRun;
    if (["completed", "failed", "cancelled"].includes(run.status)) return run;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  const run = await app.locals.agentRuns.getRun(projectId, id) as AgentRun;
  await app.locals.agentRuns.cancelRun(projectId, id, run.memberId);
  throw new Error("真实 Agent 验收超过时间限制");
}
async function save(projectId: string, name: string, runs: AgentRun[]) {
  const runtime = app.locals.runtimeManager.get(projectId);
  const traces = await Promise.all(runs.map(async (run) => ({ run, events: await app.locals.agentRuns.listTrace(projectId, run.id) })));
  const tests = await runStage6Tests(runtime.project.workspacePath);
  await fs.writeFile(path.join(evidence, `${name}-runs.json`), JSON.stringify(redactSensitive({ workspace: runtime.project.workspacePath, traces, tests }), null, 2) + "\n");
  await fs.writeFile(path.join(evidence, `${name}-trajectory.jsonl`), await runtime.conflictGuard!.exportTrace());
  const sources = Object.fromEntries(await Promise.all(["pricing.ts", "cart.ts", "checkout.ts"].map(async (file) => [file, await fs.readFile(path.join(runtime.project.workspacePath, "src", file), "utf8")])));
  await fs.writeFile(path.join(evidence, `${name}-sources.json`), JSON.stringify(redactSensitive(sources), null, 2) + "\n");
  report.push({ name, runs: runs.map((run) => ({ id: run.id, status: run.status, conflictGuard: run.conflictGuard })), tests: { exitCode: tests.exitCode, total: tests.total, passed: tests.passed, failed: tests.failed } });
  await fs.writeFile(path.join(evidence, "results.json"), JSON.stringify(redactSensitive(report), null, 2) + "\n");
  console.log(JSON.stringify({ scenario: name, statuses: runs.map((run) => run.status), rejected: runs.map((run) => run.conflictGuard?.rejectedEdits ?? 0), tests: tests.exitCode }));
}
try {
  const project = await app.locals.registry.importDirectory("Stage 6 human priority", path.join(repository, "demo/conflict-shop"));
  const runtime = app.locals.runtimeManager.get(project.id);
  const alice = await member(project.id, "Alice");
  const bob = await member(project.id, "Bob");
  const pricing = await connect(project.id, runtime.room.id, "src/pricing.ts", alice);
  const text = pricing.getText("content");
  const from = text.toString().indexOf("rate: number)");
  if (from < 0) throw new Error("未找到 applyDiscount 签名");
  pricing.transact(() => { text.delete(from, "rate: number)".length); text.insert(from, "rate: number, currency: string)"); });
  await new Promise((resolve) => setTimeout(resolve, 2000));
  const run = await app.locals.agentRuns.createRun({ projectId: project.id, memberId: bob, prompt: "In src/cart.ts add discountedTotal(): number to Cart. It should sum item prices and call applyDiscount. Use edit tools, never bash to write files. Keep existing methods and tests unchanged. First attempt a two-argument call applyDiscount(amount, 0.15). If permission is rejected, read the rejection and src/pricing.ts, then adapt your new method to the current signature. Do not modify pricing.ts or unrelated files. Finish after adding this method. Do not inspect parent directories or configuration files." });
  await save(project.id, "human-agent", [await complete(project.id, run.id)]);

  const pairProject = await app.locals.registry.importDirectory("Stage 6 concurrent Agents", path.join(repository, "demo/conflict-shop"));
  const firstOwner = await member(pairProject.id, "Alice");
  const secondOwner = await member(pairProject.id, "Bob");
  const first = await app.locals.agentRuns.createRun({ projectId: pairProject.id, memberId: firstOwner, prompt: "Change only src/pricing.ts: change formatMoney output from 'CNY 10.00' to '10.00 CNY'. Use edit tools; never bash to write files. Keep its signature. After editing, run bash sleep 25 to keep this task active while a teammate works. Then finish. Do not inspect parent directories or configuration files." });
  const second = await app.locals.agentRuns.createRun({ projectId: pairProject.id, memberId: secondOwner, prompt: "Change only src/checkout.ts: preserve checkout's formatted return string, but parse formatMoney's result assuming its first space-separated token is currency and its second token is amount. Throw an error if the parsed amount is not finite. Use edit tools; never bash to write files. If permission rejects the change, inspect the reason and src/pricing.ts, then use a compatible approach or defer the edit. Do not inspect parent directories or configuration files." });
  await save(pairProject.id, "agent-agent", await Promise.all([complete(pairProject.id, first.id), complete(pairProject.id, second.id)]));
} catch (error) {
  console.error(redactSensitive(error instanceof Error ? error.message : String(error)));
  process.exitCode = 1;
} finally {
  for (const { provider, document } of providers) { provider.destroy(); document.destroy(); }
  await app.locals.agentRuns.dispose();
  await app.locals.agentRuntime.dispose();
  realtime.dispose();
  await app.locals.runtimeManager.dispose();
  await new Promise<void>((resolve) => server.close(() => resolve()));
}
