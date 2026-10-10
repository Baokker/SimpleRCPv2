import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import http from "node:http";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { gzipSync } from "node:zlib";
import { parseArgs } from "node:util";
import { createApp } from "../apps/server/src/createApp.ts";
import { loadConfig } from "../apps/server/src/config.ts";
import { redactSensitive } from "../apps/server/src/agent/traceStore.ts";
import { attachRealtimeServer } from "../apps/server/src/realtime.ts";

const repository = fileURLToPath(new URL("../", import.meta.url));
const { values } = parseArgs({ options: { tasks: { type: "string", default: "edit-reject-adjust,write-new-file,read-two-edit" } } });
const selectedTasks = values.tasks.split(",");
assert(selectedTasks.length > 0 && selectedTasks.every((task) => ["edit-reject-adjust", "write-new-file", "read-two-edit"].includes(task)), "冒烟任务无效");
process.loadEnvFile(path.join(repository, ".env"));
const selection = JSON.parse(await fs.readFile(path.join(repository, "docs/conflict-guard/evidence/minimax-probe/selection.json"), "utf8"));
const output = path.join(repository, "docs/conflict-guard/evidence/minimax-agent-smoke", `attempt-${new Date().toISOString().replace(/[:.]/g, "-")}`);
const budgetFile = path.join(repository, ".test-workspaces/minimax-probe-budget.json");
const lock = await fs.open(`${budgetFile}.lock`, "wx");
const requests = [];
const scenarios = [];
const connections = [];
const require = createRequire(new URL("../apps/server/package.json", import.meta.url));
const { WebsocketProvider } = require("y-websocket");
const Y = require("yjs");
const WebSocket = require("ws");
let app;
let server;
let proxy;
let realtime;
let pending = Promise.resolve();
try {
  const budget = JSON.parse(await fs.readFile(budgetFile, "utf8"));
  assert(budget.agentRuns + selectedTasks.length <= budget.limits.agentRuns, "MiniMax Agent 冒烟预算不足");
  await fs.mkdir(output, { recursive: true });
  const workspace = await fs.mkdtemp(path.join(repository, ".test-workspaces/minimax-agent-"));
  const secrets = Object.entries(process.env).filter(([name, value]) => /KEY|TOKEN|SECRET|PASSWORD/i.test(name) && value).map(([, value]) => value);
  const save = (name, value) => fs.writeFile(path.join(output, name), JSON.stringify(redactSensitive(value, secrets), null, 2) + "\n");
  proxy = http.createServer((request, response) => {
    void forward(request, response).catch((error) => { requests.push({ errorType: error.name, message: redactSensitive(error.message, secrets) }); response.destroy(); console.error(JSON.stringify({ proxyError: error.name })); });
  });
  async function forward(request, response) {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = Buffer.concat(chunks).toString();
    const requestData = body ? JSON.parse(body) : undefined;
    pending = pending.then(async () => {
      assert(budget.requests < budget.limits.requests, "MiniMax 请求预算已经耗尽");
      budget.requests += 1;
      await fs.writeFile(budgetFile, JSON.stringify(budget, null, 2) + "\n");
    });
    await pending;
    const record = { sequence: requests.length + 1, request: requestData, path: request.url, startedAt: new Date().toISOString() };
    requests.push(record);
    const target = `${selection.baseUrl.replace(/\/v1$/, "")}${request.url}`;
    const controller = new AbortController();
    response.once("close", () => { if (!response.writableEnded) controller.abort(); });
    const upstream = await fetch(target, { method: request.method, headers: { Authorization: `Bearer ${process.env.MINIMAX_API_KEY}`, "content-type": "application/json" }, ...(body ? { body } : {}), signal: controller.signal });
    record.httpStatus = upstream.status;
    response.writeHead(upstream.status, { "content-type": upstream.headers.get("content-type") ?? "application/json" });
    const collected = [];
    if (upstream.body) {
      const stream = Readable.fromWeb(upstream.body);
      stream.on("data", (chunk) => collected.push(chunk));
      await pipeline(stream, response);
    } else response.end();
    record.responseText = Buffer.concat(collected).toString();
    record.finishedAt = new Date().toISOString();
  }
  const proxyOrigin = await listen(proxy);
  const config = loadConfig({ ...process.env, SIMPLERCP_AGENT_PROVIDER: "minimax", MINIMAX_MODEL: selection.model, MINIMAX_BASE_URL: selection.baseUrl, CONFLICT_GUARD_DEEP_JUDGE: "minimax", CONFLICT_GUARD: "rules", SIMPLERCP_DATA_DIR: path.join(workspace, "data"), SIMPLERCP_OPENCODE_PORT: String(await port()), SIMPLERCP_AGENT_RUN_TIMEOUT_MS: "240000", SIMPLERCP_TERMINAL_ENABLED: "false", SIMPLERCP_FAKE_AGENT_RUNTIME: "false" }, repository);
  config.importRoots = [path.join(repository, "demo")];
  config.agent.baseUrl = `${proxyOrigin}/v1`;
  app = await createApp(config);
  server = http.createServer(app);
  realtime = attachRealtimeServer(server, app.locals.runtimeManager, app.locals.agentRuns, { members: app.locals.members });
  const origin = await listen(server);
  const tasks = [
    { id: "edit-reject-adjust", files: ["src/pricing.ts", "src/cart.ts"], prompt: "使用 read 阅读 src/pricing.ts 与 src/cart.ts。尝试使用 edit 为 applyDiscount 增加第三个必填参数 season: string，保留原有两个参数与 export。如果审批拒绝，请阅读拒绝原因，重新阅读双方文件，保持原有两个参数，并增加显式处理 rate 小于 0 的 RangeError。只修改 applyDiscount，使用 edit 工具，不使用 bash 写文件。完成后运行现有测试。" },
    { id: "write-new-file", files: ["src/types.ts"], prompt: "使用 read 阅读 src/types.ts，使用 write 创建 src/roundMoney.ts，导出 roundMoney(amount: number): number，返回 Math.round(amount * 100) / 100。禁止修改任何已有文件，完成后运行现有测试。" },
    { id: "read-two-edit", files: ["src/pricing.ts", "src/checkout.ts"], prompt: "必须先分别使用 read 阅读 src/pricing.ts 和 src/checkout.ts，然后使用 edit 在 formatMoney 中增加 Number.isFinite(amount) 检查，不满足时抛出 RangeError。保持签名与正常输出相同，只修改 formatMoney。完成后运行现有测试。" }
  ];
  for (const task of tasks.filter((task) => selectedTasks.includes(task.id))) {
    const project = await app.locals.registry.importDirectory(`MiniMax ${task.id}`, path.join(repository, "demo/conflict-shop"));
    const runtime = app.locals.runtimeManager.get(project.id);
    const memberId = await join(origin, project.id, "Alice");
    if (task.id === "edit-reject-adjust") {
      const bob = await join(origin, project.id, "Bob");
      const document = new Y.Doc();
      const provider = new WebsocketProvider(`${origin}/yjs/${project.id}`, encodeURIComponent(`${runtime.room.id}:src/cart.ts`), document, { disableBc: true, params: { memberId: bob }, WebSocketPolyfill: WebSocket });
      connections.push({ document, provider });
      await new Promise((resolve, reject) => { provider.on("sync", (synced) => { if (synced) resolve(); }); provider.once("connection-error", reject); });
      const text = document.getText("content");
      const position = text.toString().indexOf("applyDiscount(amount, 0.1)");
      assert(position >= 0);
      document.transact(() => { text.delete(position, "applyDiscount(amount, 0.1)".length); text.insert(position, "applyDiscount(amount + 0, 0.1)"); });
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
    budget.agentRuns += 1;
    await fs.writeFile(budgetFile, JSON.stringify(budget, null, 2) + "\n");
    const started = await app.locals.agentRuns.createRun({ projectId: project.id, memberId, prompt: `${task.prompt}\n禁止阅读环境变量、环境文件、凭据或父目录。`, contexts: task.files.map((file) => ({ type: "file", path: file })) });
    const deadline = Date.now() + 300000;
    let run;
    do {
      run = await app.locals.agentRuns.getRun(project.id, started.id);
      if (["completed", "failed", "cancelled"].includes(run.status)) break;
      assert(Date.now() < deadline, "Agent 冒烟超过时限");
      await new Promise((resolve) => setTimeout(resolve, 250));
    } while (true);
    const events = await app.locals.agentRuns.listTrace(project.id, started.id);
    const completedTools = events.filter((event) => event.type === "opencode.message.part.updated" && event.data.part?.type === "tool" && event.data.part.state?.status === "completed").map((event) => event.data.part.tool);
    const result = { task: task.id, run, tools: [...new Set(completedTools)], permissionEvents: events.filter((event) => event.type.includes("permission") || event.type.includes("t2_")), events };
    scenarios.push(result);
    await save(`${task.id}.json`, result);
    await fs.writeFile(path.join(output, `${task.id}.jsonl`), await runtime.conflictGuard.exportTrace());
    console.log(JSON.stringify({ task: task.id, status: run.status, tools: result.tools, rejected: run.conflictGuard?.rejectedEdits, requests: budget.requests, agentRuns: budget.agentRuns }));
    assert.equal(run.status, "completed", run.error);
    assert(completedTools.includes(task.id === "write-new-file" ? "write" : "edit"), "所需工具没有成功执行");
    if (task.id === "edit-reject-adjust") assert((run.conflictGuard?.rejectedEdits ?? 0) >= 1, "未触发写入前拒绝");
    if (task.id === "read-two-edit") assert(events.filter((event) => event.type === "opencode.message.part.updated" && event.data.part?.tool === "read" && event.data.part.state?.status === "completed").length >= 2, "没有完成两次文件读取");
  }
  await save("summary.json", { model: selection.model, baseUrl: selection.baseUrl, provider: "minimax", thinking: "disabled", passed: true, tasks: scenarios.map(({ task, run, tools }) => ({ task, runId: run.id, status: run.status, files: run.fileChanges, tools, rejected: run.conflictGuard?.rejectedEdits })), budget });
} finally {
  for (const { document, provider } of connections) { provider.destroy(); document.destroy(); }
  realtime?.dispose();
  if (app) { await app.locals.agentRuns.dispose(); await app.locals.agentRuntime.dispose(); await app.locals.runtimeManager.dispose(); }
  if (server) await new Promise((resolve) => server.close(resolve));
  if (proxy) await new Promise((resolve) => proxy.close(resolve));
  await fs.mkdir(output, { recursive: true });
  const safe = redactSensitive({ requests, scenarios }, Object.entries(process.env).filter(([name]) => /KEY|TOKEN|SECRET|PASSWORD/i.test(name)).map(([, value]) => value).filter(Boolean));
  await fs.writeFile(path.join(output, "transport.json.gz"), gzipSync(JSON.stringify(safe) + "\n"));
  await lock.close(); await fs.unlink(`${budgetFile}.lock`);
}

async function join(origin, projectId, name) {
  const response = await fetch(`${origin}/api/projects/${projectId}/members`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name }) });
  assert.equal(response.status, 200);
  return (await response.json()).member.id;
}
async function listen(server) {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert(address && typeof address !== "string");
  return `http://127.0.0.1:${address.port}`;
}
async function port() { const server = http.createServer(); const origin = await listen(server); await new Promise((resolve) => server.close(resolve)); return Number(new URL(origin).port); }
