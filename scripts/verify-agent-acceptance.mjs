import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { execFile } from "node:child_process";
import { createRequire } from "node:module";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { createApp } from "../apps/server/src/createApp.ts";
import { loadConfig } from "../apps/server/src/config.ts";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const require = createRequire(import.meta.url);
const { parse } = require("../apps/server/node_modules/dotenv/lib/main.js");
const environment = { ...process.env, ...parse(await fs.readFile(path.join(repositoryRoot, ".env"), "utf8")) };
assert(environment.DEEPSEEK_API_KEY, "DEEPSEEK_API_KEY is required");
const execFileAsync = promisify(execFile);
const workspaceRoot = path.join(repositoryRoot, ".test-workspaces");
await fs.mkdir(workspaceRoot, { recursive: true });
const root = await fs.mkdtemp(path.join(workspaceRoot, "agent-real-acceptance-"));
const demoRoot = path.join(root, "demo", "workspace");
await fs.mkdir(demoRoot, { recursive: true });
const openCodePort = await availablePort();
const config = loadConfig({ ...environment, CONFLICT_GUARD: "off", SIMPLERCP_AGENT_MAX_CONCURRENT_RUNS: "3", SIMPLERCP_FAKE_AGENT_RUNTIME: "false", SIMPLERCP_TERMINAL_ENABLED: "false", SIMPLERCP_OPENCODE_PORT: String(openCodePort), SIMPLERCP_DATA_DIR: path.join(root, "data") }, repositoryRoot);
config.demoProjectRoot = demoRoot;
const app = await createApp(config);
const server = http.createServer(app);
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
assert(address && typeof address !== "string");
const origin = `http://127.0.0.1:${address.port}`;
const results = { commit: (await execFileAsync("git", ["rev-parse", "HEAD"], { cwd: repositoryRoot })).stdout.trim(), source: "real OpenCode 1.18.31 and configured DeepSeek Provider", config: { mode: "off", maxConcurrentRuns: 3, model: config.agent.model }, scenarios: {} };

try {
  const firstMember = await join("demo", "Acceptance Alice");
  const secondProject = await app.locals.registry.createBlankProject("Acceptance second project");
  const secondMember = await join(secondProject.id, "Acceptance Bob");
  const firstWorkspace = app.locals.runtimeManager.get("demo").project.workspacePath;
  await app.locals.agentRuntime.prepareWorkspace(firstWorkspace);
  await app.locals.agentRuntime.prepareWorkspace(secondProject.workspacePath);

  const first = await app.locals.agentRuns.createRun({ projectId: "demo", memberId: firstMember, prompt: "Use the write tool to create a.ts containing exactly: export const alpha = true; then use the bash tool to run sleep 15. After sleep completes, reply exactly done. Do not edit any other file." });
  await waitFor(async () => (await trace("demo", first.id)).some((event) => event.type === "agent_write"));
  const second = await app.locals.agentRuns.createRun({ projectId: "demo", memberId: firstMember, prompt: "Use the write tool to create b.ts containing exactly: export const beta = true; Reply exactly done. Do not edit any other file." });
  await waitFor(async () => (await run("demo", second.id)).status === "completed");
  assert.equal((await run("demo", first.id)).status, "running", "The later run must finish while the earlier run is still running");
  await waitFor(async () => (await run("demo", first.id)).status === "completed");
  const finishedFirst = await run("demo", first.id);
  const finishedSecond = await run("demo", second.id);
  assert.deepEqual(finishedFirst.fileChanges.map((entry) => [entry.file, entry.attribution]), [["a.ts", "tool"]]);
  assert.deepEqual(finishedSecond.fileChanges.map((entry) => [entry.file, entry.attribution]), [["b.ts", "tool"]]);
  assert((await trace("demo", first.id)).some((event) => event.type === "run_completed" && event.data.overlappingRunIds.includes(second.id)));
  results.scenarios.laterStartEarlierFinish = { first: finishedFirst, second: finishedSecond, firstTrace: await trace("demo", first.id), secondTrace: await trace("demo", second.id) };

  await fs.writeFile(path.join(firstWorkspace, "original.ts"), "export const oldName = true;\n");
  await fs.writeFile(path.join(firstWorkspace, "removed.ts"), "export const removed = true;\n");
  const patch = "*** Begin Patch\n*** Update File: a.ts\n@@\n-export const alpha = true;\n+export const alpha = false;\n*** Add File: added.ts\n+export const added = true;\n*** Delete File: removed.ts\n*** Update File: original.ts\n*** Move to: moved.ts\n@@\n-export const oldName = true;\n+export const newName = true;\n*** End Patch";
  const patchRun = await app.locals.agentRuns.createRun({ projectId: "demo", memberId: firstMember, prompt: `Call the apply_patch tool exactly once with this patchText. Do not use bash, write or edit tools. Reply exactly done.\n${patch}` });
  await waitFor(async () => ["completed", "failed"].includes((await run("demo", patchRun.id)).status));
  const patchRecord = await run("demo", patchRun.id);
  assert.equal(patchRecord.status, "completed", patchRecord.error);
  const patchTrace = await trace("demo", patchRun.id);
  const patchEvent = patchTrace.find((event) => event.type === "opencode.message.part.updated" && event.data.part?.tool === "apply_patch" && event.data.part.state?.status === "completed");
  results.observations = { applyPatchAvailability: { patchRecord, observedTools: [...new Set(patchTrace.filter((event) => event.type === "opencode.message.part.updated" && event.data.part?.type === "tool").map((event) => event.data.part.tool))], patchEvent, trace: patchTrace } };
  if (patchEvent) {
    assert.deepEqual(patchRecord.fileChanges.map((entry) => entry.file).sort(), ["a.ts", "added.ts", "moved.ts", "original.ts", "removed.ts"]);
    assert(patchRecord.fileChanges.every((entry) => entry.attribution === "tool"));
  }

  const modelResponse = await fetch(`${config.agent.baseUrl}/models`, { headers: { Authorization: `Bearer ${config.agent.apiKey}` } });
  assert(modelResponse.ok, "Provider model inventory request failed");
  const availableModels = (await modelResponse.json()).data.map((entry) => entry.id);
  const nextModel = availableModels.includes("deepseek-chat") && config.agent.model !== "deepseek-chat" ? "deepseek-chat" : availableModels.find((id) => id !== config.agent.model);
  assert(nextModel, "A second configured Provider model is required");
  const projectOneRun = await app.locals.agentRuns.createRun({ projectId: "demo", memberId: firstMember, prompt: "Call the bash tool once to execute sleep 12, then reply exactly done. Do not change files." });
  const projectTwoRun = await app.locals.agentRuns.createRun({ projectId: secondProject.id, memberId: secondMember, prompt: "Call the bash tool once to execute sleep 4, then reply exactly done. Do not change files." });
  await waitFor(async () => (await trace("demo", projectOneRun.id)).some(isRunningBash) && (await trace(secondProject.id, projectTwoRun.id)).some(isRunningBash));
  const processBefore = (await execFileAsync("pgrep", ["-f", `opencode.exe serve.*--port=${openCodePort}`])).stdout.trim();
  await app.locals.agentSettings.update({ provider: "deepseek", model: nextModel, enabled: true });
  await waitFor(async () => (await run(secondProject.id, projectTwoRun.id)).status === "completed");
  assert.equal((await run("demo", projectOneRun.id)).status, "running");
  assert.equal(app.locals.agentRuntime.getCurrentModel(), config.agent.model);
  assert.equal((await execFileAsync("pgrep", ["-f", `opencode.exe serve.*--port=${openCodePort}`])).stdout.trim(), processBefore);
  await waitFor(async () => (await run("demo", projectOneRun.id)).status === "completed");
  const afterSwitch = await app.locals.agentRuns.createRun({ projectId: "demo", memberId: firstMember, prompt: "Do not call tools. Reply exactly connected." });
  await waitFor(async () => ["completed", "failed"].includes((await run("demo", afterSwitch.id)).status));
  const switched = await run("demo", afterSwitch.id);
  assert.equal(switched.status, "completed", switched.error);
  assert.equal(switched.model, nextModel);
  results.scenarios.crossProjectModelChange = { processBefore, nextModel, projectOne: await run("demo", projectOneRun.id), projectTwo: await run(secondProject.id, projectTwoRun.id), switched };

  const timeoutConfig = { ...config, dataDir: path.join(root, "timeout-data"), agent: { ...config.agent, openCodePort: await availablePort(), runTimeoutMs: 9_000 } };
  const timeoutApp = await createApp(timeoutConfig);
  const timeoutServer = http.createServer(timeoutApp);
  await new Promise((resolve) => timeoutServer.listen(0, "127.0.0.1", resolve));
  const timeoutAddress = timeoutServer.address();
  assert(timeoutAddress && typeof timeoutAddress !== "string");
  let timeoutDocument;
  try {
    const response = await fetch(`http://127.0.0.1:${timeoutAddress.port}/api/projects/demo/members`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "Timeout member" }) });
    assert.equal(response.status, 200);
    const timeoutMember = (await response.json()).member.id;
    const timeoutRun = await timeoutApp.locals.agentRuns.createRun({ projectId: "demo", memberId: timeoutMember, prompt: "Use write to create timeout.ts containing exactly export const timeout = true; Then use bash to run sleep 20. After sleep, reply done. Do not edit other files." });
    await waitFor(async () => (await timeoutApp.locals.agentRuns.listTrace("demo", timeoutRun.id)).some((event) => event.type === "agent_write"));
    const timeoutRuntime = timeoutApp.locals.runtimeManager.get("demo");
    timeoutDocument = await timeoutRuntime.documents.getDocument(timeoutRuntime.room.id, "timeout.ts");
    timeoutDocument.getText("content").insert(0, "// member update\n");
    await waitFor(async () => (await timeoutApp.locals.agentRuns.getRun("demo", timeoutRun.id)).status === "failed");
    const timeoutRecord = await timeoutApp.locals.agentRuns.getRun("demo", timeoutRun.id);
    const timeoutTrace = await timeoutApp.locals.agentRuns.listTrace("demo", timeoutRun.id);
    results.scenarios.timeoutAttribution = { runTimeoutMs: 9_000, timeoutRecord, trace: timeoutTrace };
    assert.equal(timeoutRecord.error, "Agent run exceeded 9000 ms");
    assert.deepEqual(timeoutRecord.fileChanges.map((entry) => [entry.file, entry.attribution]), [["timeout.ts", "tool"]]);
    assert(timeoutTrace.some((event) => event.type === "concurrent_change" && event.data.path === "timeout.ts"));
  } finally {
    await timeoutApp.locals.agentRuns.dispose();
    await timeoutApp.locals.agentRuntime.dispose();
    await timeoutApp.locals.runtimeManager.dispose();
    timeoutDocument?.destroy();
    await new Promise((resolve, reject) => timeoutServer.close((error) => error ? reject(error) : resolve()));
  }

  results.passed = true;
  console.log(JSON.stringify({ passed: Object.keys(results.scenarios), output: "docs/conflict-guard/evidence/self-acceptance/agent-real.json", model: nextModel }));
} finally {
  const outputPath = path.join(repositoryRoot, "docs/conflict-guard/evidence/self-acceptance/agent-real.json");
  let output = JSON.stringify(results, null, 2);
  for (const value of config.sensitiveValues.filter(Boolean)) output = output.split(value).join("[REDACTED]");
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, `${output}\n`);
  await app.locals.agentRuns.dispose();
  await app.locals.agentRuntime.dispose();
  await app.locals.runtimeManager.dispose();
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  await fs.rm(root, { recursive: true, force: true });
}

function run(projectId, runId) { return app.locals.agentRuns.getRun(projectId, runId); }
function trace(projectId, runId) { return app.locals.agentRuns.listTrace(projectId, runId); }
async function join(projectId, name) {
  const response = await fetch(`${origin}/api/projects/${projectId}/members`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name }) });
  assert.equal(response.status, 200);
  return (await response.json()).member.id;
}
function isRunningBash(event) { return event.type === "opencode.message.part.updated" && event.data.part?.tool === "bash" && event.data.part.state?.status === "running"; }
async function waitFor(predicate) {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("Timed out waiting for real Agent acceptance");
}
async function availablePort() {
  const candidate = http.createServer();
  await new Promise((resolve) => candidate.listen(0, "127.0.0.1", resolve));
  const address = candidate.address();
  assert(address && typeof address !== "string");
  const port = address.port;
  await new Promise((resolve, reject) => candidate.close((error) => error ? reject(error) : resolve()));
  return port;
}
