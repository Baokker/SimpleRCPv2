import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "@playwright/test";
import { createApp } from "../apps/server/src/createApp.ts";
import { loadConfig } from "../apps/server/src/config.ts";
import { attachRealtimeServer } from "../apps/server/src/realtime.ts";
import { redactSensitive } from "../apps/server/src/agent/traceStore.ts";

const repository = fileURLToPath(new URL("../", import.meta.url));
const require = createRequire(import.meta.url);
const { parse } = require("../apps/server/node_modules/dotenv/lib/main.js");
const environment = { ...process.env, ...parse(await fs.readFile(path.join(repository, ".env"), "utf8")) };
assert(environment.DEEPSEEK_API_KEY, "DEEPSEEK_API_KEY is required");
const root = path.join(repository, ".test-workspaces/main-agent-check");
const output = path.join(repository, "docs/foundation/evidence/main-agent-check");
await fs.mkdir(root, { recursive: true });
await fs.mkdir(output, { recursive: true });
const resumePath = process.argv.find((argument) => argument.startsWith("--resume="))?.slice("--resume=".length);
const runRoot = resumePath ? await fs.realpath(resumePath) : await fs.mkdtemp(path.join(root, "attempt-"));
assert.equal(path.dirname(runRoot), root, "Resume workspace must belong to this check");
process.env.TMPDIR = runRoot;
const serverPort = await availablePort();
const clientPort = await availablePort();
const config = loadConfig({ ...environment, PORT: String(serverPort), SIMPLERCP_PUBLIC_URL: `http://127.0.0.1:${clientPort}`, SIMPLERCP_DATA_DIR: path.join(runRoot, "data"), SIMPLERCP_OPENCODE_PORT: String(await availablePort()), SIMPLERCP_FAKE_AGENT_RUNTIME: "false", SIMPLERCP_TERMINAL_ENABLED: "false" }, repository);
config.demoProjectRoot = path.join(runRoot, "workspace");
if (!resumePath) {
  await fs.mkdir(config.demoProjectRoot);
  await fs.writeFile(path.join(config.demoProjectRoot, "README.md"), "# Agent interaction checks\n");
}
const app = await createApp(config);
const server = http.createServer(app);
const realtime = attachRealtimeServer(server, app.locals.runtimeManager, app.locals.agentRuns, { members: app.locals.members });
await new Promise((resolve) => server.listen(serverPort, "127.0.0.1", resolve));
process.env.VITE_SIMPLERCP_API_ORIGIN = `http://127.0.0.1:${serverPort}`;
const vitePackage = require.resolve("../apps/client/node_modules/vite/package.json");
const { createServer } = await import(pathToFileURL(path.join(path.dirname(vitePackage), "dist/node/index.js")).href);
const vite = await createServer({ root: path.join(repository, "apps/client"), configFile: path.join(repository, "apps/client/vite.config.ts"), server: { host: "127.0.0.1", port: clientPort, strictPort: true } });
await vite.listen();
const browser = await chromium.launch({ headless: true });
const aliceContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const bobContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const alice = await aliceContext.newPage(), bob = await bobContext.newPage();
const browserErrors = [];
for (const page of [alice, bob]) page.on("pageerror", (error) => browserErrors.push(error.message));
const result = resumePath ? JSON.parse(await fs.readFile(path.join(output, "acceptance.json"), "utf8")) : { model: config.agent.model, openCodeVersion: "1.18.31", startedAt: new Date().toISOString(), checks: {}, runIds: [] };
result.workspace = runRoot;
const runBudget = resumePath ? result.runIds.length + 4 : 6;
const runtime = app.locals.runtimeManager.get("demo");
const getRun = (id) => app.locals.agentRuns.getRun("demo", id);
let chatHandle;

try {
  const savedAliceId = resumePath ? (await getRun(result.runIds[0])).memberId : undefined;
  const savedBobId = resumePath ? (await app.locals.members.listMembers("demo")).find((member) => member.displayName === "Bob")?.memberId : undefined;
  await join(alice, "Alice", savedAliceId); await join(bob, "Bob", savedBobId);
  const aliceId = await identity(alice), bobId = await identity(bob);
  chatHandle = (await app.locals.agentRuns.createTeamAgent({ projectId: "demo", memberId: aliceId, name: `docs-${Date.now()}`, description: "项目文档助手" })).handle;
  if (!result.checks.personalInterruption) {
  await session(alice, "个人中断验证");
  await session(bob, "Bob 个人会话");
  const prompt = bob.getByTestId("agent-prompt");
  await prompt.fill("中文输入法检查");
  await prompt.dispatchEvent("keydown", { key: "Enter", code: "Enter", isComposing: true });
  assert.equal(await prompt.inputValue(), "中文输入法检查");
  assert.equal((await app.locals.agentRuns.listRuns("demo")).length, 0);
  result.checks.imePersonal = true;

  const first = await personal(alice, "Reply briefly that you are starting. Then use bash to execute sleep 60. Only after sleep, write chinese.md containing CHINESE_OLD. Do not change any other file.");
  await waitFor(async () => (await getRun(first)).activity?.tools.some((tool) => tool.name === "bash"));
  await waitFor(async () => (await alice.getByTestId("agent-current-tools").count()) > 0);
  assert.equal(await bob.locator(".agent-user-message").count(), 0);
  for (const endpoint of [`/agent/runs/${first}`, `/agent/runs/${first}/trace`, `/agent/runs/${first}/trace?download=true`]) assert.equal(await statusAs(bob, endpoint), 403);
  assert.equal((await app.locals.agentRuns.listVisibleRuns("demo", bobId)).length, 0);
  await alice.screenshot({ path: path.join(output, "01-personal-live.png") });
  result.checks.personalPrivacy = true;

  const replacement = await personal(alice, "Cancel the old requirement. Do not write chinese.md. Use the question tool to ask which language to use for french.md, with options French and English. After the answer, write french.md in the chosen language and include FRENCH_NEW. Do not call bash.");
  await waitFor(async () => (await getRun(replacement)).questions?.length > 0);
  await answer(alice, "French");
  await completed(replacement);
  const stopped = await getRun(first), next = await getRun(replacement);
  assert.equal(stopped.status, "cancelled"); assert.equal(next.interruptsRunId, first);
  assert.equal(stopped.interruptedByRunId, replacement);
  await assertMissing("chinese.md");
  assert((await fs.readFile(path.join(runtime.project.workspacePath, "french.md"), "utf8")).includes("FRENCH_NEW"));
  result.checks.personalInterruption = true; result.checks.questionPersonal = true;

  alice.once("dialog", (dialog) => dialog.accept());
  await alice.getByRole("button", { name: "删除会话 个人中断验证", exact: true }).click();
  await waitFor(async () => (await alice.getByRole("tab", { name: "个人中断验证", exact: true }).count()) === 0);
  await alice.reload(); await alice.getByTestId("collab-tab-agent").click();
  assert.equal(await alice.getByRole("tab", { name: "个人中断验证", exact: true }).count(), 0);
  result.checks.deleteSession = true;
  }

  await alice.getByTestId("collab-tab-chat").click(); await bob.getByTestId("collab-tab-chat").click();
  const chatPrompt = alice.getByTestId("chat-input");
  await chatPrompt.fill("中文输入法确认");
  await chatPrompt.dispatchEvent("keydown", { key: "Enter", code: "Enter", isComposing: true });
  assert.equal(await chatPrompt.inputValue(), "中文输入法确认");
  result.checks.imeChat = true;

  const chatStopped = await chat(alice, "@agent 请等待文档准备完成：使用 bash 执行 sleep 60，执行完成以后，创建 stop-check.md，用中文介绍项目的协作功能。仅修改这个文件。");
  await waitForTool(chatStopped, "bash");
  const stopCard = alice.getByTestId("chat-agent-card").last();
  await stopCard.getByRole("button", { name: "停止任务", exact: true }).last().click();
  await waitFor(async () => (await getRun(chatStopped)).status === "cancelled");
  await waitFor(async () => !app.locals.agentRuns.hasActiveTasks());
  await assertMissing("stop-check.md");
  result.checks.chatStop = true;

  const question = await chat(bob, "@agent 为项目创建 team.md 使用说明。请先通过 question 工具询问文档语言，提供 Chinese 和 French 选项。收到回答后，用所选语言编写说明，在文档最后附上编号 TEAM_DONE。无需执行 bash。");
  await waitFor(async () => (await getRun(question)).questions?.length > 0);
  await waitFor(async () => (await alice.getByTestId("agent-question").count()) > 0);
  assert((await alice.getByTestId("agent-question").last().innerText()).includes("等待 Bob 回答"));
  assert.equal(await statusAs(alice, `/agent/runs/${question}/questions/${(await getRun(question)).questions[0].id}/reply`, { method: "POST", body: { answers: [["Chinese"]] } }), 403);
  await bob.screenshot({ path: path.join(output, "02-chat-question.png") });
  await answer(bob, "Chinese"); await completed(question);
  assert((await fs.readFile(path.join(runtime.project.workspacePath, "team.md"), "utf8")).includes("TEAM_DONE"));
  result.checks.questionChat = true;

  const oldChat = await chat(bob, "@agent 请使用 bash 执行 sleep 60，等待准备工作完成以后，创建 previous-chat.md，用中文说明项目的会话功能。仅修改这个文件。");
  await waitForTool(oldChat, "bash");
  const newChat = await chat(alice, "@agent Stop the previous task. Do not write previous-chat.md. Write latest.md containing exactly LATEST_CHAT, then reply that the latest instruction is completed. Do not call bash.");
  await completed(newChat);
  assert.equal((await getRun(oldChat)).status, "cancelled");
  assert.equal((await getRun(newChat)).interruptsRunId, oldChat);
  await assertMissing("previous-chat.md");
  assert((await fs.readFile(path.join(runtime.project.workspacePath, "latest.md"), "utf8")).includes("LATEST_CHAT"));
  await waitFor(async () => (await bob.getByTestId("chat-transcript").innerText()).includes("LATEST_CHAT"));
  await alice.screenshot({ path: path.join(output, "03-chat-interrupted.png") });
  result.checks.chatInterruption = true;
  result.checks.sharedProgress = true;
  result.checks.streaming = (await getRun(newChat)).activity.messages.length > 0;
  result.checks.reasoningProvided = (await getRun(newChat)).activity.reasoning.some((part) => part.text.trim());
  assert.equal(browserErrors.length, 0, JSON.stringify(browserErrors));
  assert.equal(result.runIds.length, runBudget);
  result.passed = true;
  console.log(JSON.stringify({ checks: result.checks, runs: result.runIds.length, passed: true }));
} finally {
  await app.locals.agentRuns.dispose();
  const records = [];
  for (const id of result.runIds) {
    const run = await getRun(id);
    const events = await app.locals.agentRuns.listTrace("demo", id);
    records.push({ run, trace: { events } });
  }
  result.finishedAt = new Date().toISOString(); result.browserErrors = browserErrors;
  await fs.writeFile(path.join(output, "acceptance.json"), JSON.stringify(redactSensitive(result, config.sensitiveValues), null, 2));
  for (const record of records) await fs.writeFile(path.join(output, `run-${record.run.id}.json`), JSON.stringify(redactSensitive(record, config.sensitiveValues), null, 2));
  await browser.close(); await vite.close(); realtime.dispose();
  for (const sockets of [realtime.presence, realtime.documents, realtime.terminal]) { for (const client of sockets.clients) client.terminate(); sockets.close(); }
  await app.locals.agentRuntime.dispose(); await app.locals.runtimeManager.dispose();
  await new Promise((resolve) => server.close(resolve));
}

async function join(page, name, memberId) {
  if (memberId) await page.addInitScript((id) => sessionStorage.setItem("simplercp.memberId.demo", id), memberId);
  await page.goto(`http://127.0.0.1:${clientPort}/projects/demo`);
  await page.waitForFunction(() => document.querySelector('[data-testid="display-name"]') || document.querySelector('[data-testid="status-bar"]'));
  if (await page.getByTestId("display-name").isVisible()) {
    await page.getByTestId("display-name").fill(name);
    await page.getByTestId("join-project").click();
  }
  await page.getByTestId("status-bar").waitFor();
}
async function identity(page) { return page.evaluate(() => sessionStorage.getItem("simplercp.memberId.demo")); }
async function session(page, title) {
  await page.getByTestId("collab-tab-agent").click();
  await page.getByTestId("agent-new-session").click();
  await page.getByTestId("agent-session-title").fill(title);
  await page.getByTestId("agent-session-title").press("Enter");
  await page.getByRole("tab", { name: title, exact: true }).waitFor();
}
async function submit(page, testId, text) {
  assert(result.runIds.length < runBudget, "Real Agent run budget exhausted");
  const before = new Set((await app.locals.agentRuns.listRuns("demo")).map((run) => run.id));
  await page.getByTestId(testId).fill(text); await page.getByTestId(testId).press("Enter");
  let created;
  await waitFor(async () => { created = (await app.locals.agentRuns.listRuns("demo")).find((run) => !before.has(run.id)); return Boolean(created); });
  result.runIds.push(created.id); console.log(JSON.stringify({ runNumber: result.runIds.length, source: testId }));
  return created.id;
}
async function personal(page, text) { return submit(page, "agent-prompt", text); }
async function chat(page, text) { return submit(page, "chat-input", text.replace("@agent", `@${chatHandle}`)); }
async function answer(page, label) {
  const question = page.getByTestId("agent-question").last();
  await question.getByRole("radio", { name: new RegExp(`^${label}(?:\\s|$)`) }).check();
  await question.getByRole("button", { name: "发送回答", exact: true }).click();
}
async function completed(id) {
  await waitFor(async () => { const run = await getRun(id); if (run.status === "failed") throw new Error(run.failure?.guidance ?? run.error); return run.status === "completed"; });
  await waitFor(async () => !app.locals.agentRuns.hasActiveTasks());
}
async function waitForTool(id, name) {
  await waitFor(async () => {
    const run = await getRun(id);
    if (["failed", "completed", "cancelled"].includes(run.status)) throw new Error(`Task ended before ${name}: ${run.output ?? run.error ?? run.status}`);
    return run.activity?.tools.some((tool) => tool.name === name);
  });
}
async function statusAs(page, endpoint, input = {}) {
  return page.evaluate(async ({ endpoint, input }) => {
    const response = await fetch(`/api/projects/demo${endpoint}`, { method: input.method, headers: { "X-SimpleRCP-Member": sessionStorage.getItem("simplercp.memberId.demo"), "content-type": "application/json" }, body: input.body ? JSON.stringify(input.body) : undefined });
    return response.status;
  }, { endpoint, input });
}
async function assertMissing(file) { assert.equal((await fs.stat(path.join(runtime.project.workspacePath, file)).then(() => true, (error) => { if (error.code !== "ENOENT") throw error; return false; })), false); }
async function waitFor(condition) {
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) { if (await condition()) return; await new Promise((resolve) => setTimeout(resolve, 200)); }
  throw new Error("Agent acceptance timed out");
}
async function availablePort() {
  const candidate = http.createServer(); await new Promise((resolve) => candidate.listen(0, "127.0.0.1", resolve));
  const port = candidate.address().port; await new Promise((resolve) => candidate.close(resolve)); return port;
}
