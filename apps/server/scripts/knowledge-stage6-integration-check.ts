import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "dotenv";
import { createOpenAICompatibleClient, extractAgentRecapDraft } from "@simplercp/knowledge";
import { createApp } from "../src/createApp.js";
import { loadConfig } from "../src/config.js";
import { redactSensitive } from "../src/agent/traceStore.js";
import type { AgentRun, AgentTraceEvent } from "@simplercp/shared";

const repository = fileURLToPath(new URL("../../../", import.meta.url));
const env = parse(await fs.readFile(path.join(repository, ".env"), "utf8"));
if (!env.MINIMAX_API_KEY || !env.DEEPSEEK_API_KEY) throw new Error("Both configured provider keys are required");
const sensitive = [env.MINIMAX_API_KEY, env.DEEPSEEK_API_KEY];
const evidenceRoot = path.join(repository, "docs/knowledge/evidence/stage-6");
await fs.mkdir(evidenceRoot, { recursive: true });
const output = async (file: string, value: unknown) => fs.writeFile(path.join(evidenceRoot, file), JSON.stringify(redactSensitive(value, sensitive), null, 2) + "\n");

const minimaxBase = env.MINIMAX_BASE_URL || "https://api.minimaxi.com/v1";
const minimaxModel = env.MINIMAX_MODEL || "MiniMax-M2";
const minimal = await fetch(`${minimaxBase}/chat/completions`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${env.MINIMAX_API_KEY}` }, body: JSON.stringify({ model: minimaxModel, messages: [{ role: "user", content: "Reply with OK only." }], max_tokens: 100, reasoning_split: true }), signal: AbortSignal.timeout(60_000) });
const minimalBody = await minimal.json() as { choices?: Array<{ message?: { content?: string; reasoning_content?: string } }>; usage?: unknown };
await output("minimax-endpoint.json", { baseUrl: minimaxBase, model: minimaxModel, status: minimal.status, content: minimalBody.choices?.[0]?.message?.content, hasReasoningField: Boolean(minimalBody.choices?.[0]?.message?.reasoning_content), usage: minimalBody.usage });
if (!minimal.ok) throw new Error(`MiniMax verification HTTP ${minimal.status}`);
const llm = createOpenAICompatibleClient({ provider: "minimax", baseUrl: minimaxBase, model: minimaxModel, apiKey: env.MINIMAX_API_KEY });
const scenarios = {
  revised: { file: "src/session.ts", run: { id: "run-revised", prompt: "Update session setup", ownerId: "Alice" }, agentDiff: "-export function sharedHelper(state) { return state; }\n+export function setup(state) { return state; }", memberDiff: "+export function sharedHelper(state) { return state; }", whatHappened: "Agent removed the existing sharedHelper from src/session.ts", correction: "Bob restored sharedHelper in src/session.ts", chatMessages: [{ author: "Bob", text: "共享 helper 需要保留，请恢复 sharedHelper。" }] },
  corrected: { file: "src/session.ts", previousRun: { id: "run-previous", prompt: "Update session state", diff: "+state.name = name;" }, nextRun: { id: "run-corrected", prompt: "不要直接写 state，改用 sharedHelper", diff: "+sharedHelper(state, name);" }, whatHappened: "Agent wrote session state directly in src/session.ts", correction: "Alice requested sharedHelper for session state mutations" }
};
const recaps = [];
for (const [scenario, evidence] of Object.entries(scenarios)) for (let attempt = 1; attempt <= 3; attempt++) {
  const startedAt = Date.now();
  const result = await extractAgentRecapDraft(evidence, { client: llm, model: minimaxModel, language: "zh" });
  recaps.push({ scenario, attempt, provider: "minimax", model: minimaxModel, durationMs: Date.now() - startedAt, fallback: result.fallback, citationCount: result.draft.evidenceCitations.length, draft: result.draft });
  await output("recaps.json", recaps);
  console.log(JSON.stringify({ scenario, attempt, fallback: result.fallback, citations: result.draft.evidenceCitations.length, rule: result.draft.rule }));
}
if (process.argv.includes("--recaps-only")) process.exit(0);

const root = path.join(repository, "artifacts/stage6-mcp-real");
const config = loadConfig({ ...env, AGENT_LLM_PROVIDER: "deepseek", KNOWLEDGE: "full", KNOWLEDGE_LLM_PROVIDER: "minimax", SIMPLERCP_DATA_DIR: path.join(root, "data"), SIMPLERCP_TERMINAL_ENABLED: "false", SIMPLERCP_OPENCODE_PORT: "4297" }, repository);
config.port = 0; config.demoProjectRoot = path.join(repository, "demo/stage6-mcp-workspace");
const app = await createApp(config);
const server = http.createServer(app);
await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
const address = server.address(); if (!address || typeof address === "string") throw new Error("Server did not start");
const origin = `http://127.0.0.1:${address.port}`;
app.locals.knowledgeMcpUrl = `${origin}/mcp/knowledge`;
const request = async (route: string, body?: unknown, memberId?: string, method = body === undefined ? "GET" : "POST") => {
  const response = await fetch(`${origin}/api/projects/demo/${route}`, { method, headers: { "content-type": "application/json", ...(memberId ? { "X-SimpleRCP-Member": memberId } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const content = await response.text(); if (!response.ok) throw new Error(String(redactSensitive(`HTTP ${response.status}: ${content}`, sensitive)));
  return JSON.parse(content);
};
try {
  const author = (await request("members", { name: "Alice" })).member;
  const initiator = (await request("members", { name: "Bob" })).member;
  await request("knowledge/config", { injectEnabled: false, toolEnabled: true, proposeEnabled: true, requireSecondConfirmForTeam: false }, author.id, "PUT");
  const card = (await request("knowledge/cards", { type: "constraint", title: "Session 状态修改入口", summary: "session.js 的状态修改使用 sharedHelper.js 的 setSessionValue", content: "修改 session.js 时必须通过 sharedHelper.js 的 setSessionValue 修改状态，保留共享 helper。", scope: "team", anchors: [{ file: "session.js", startLine: 1, endLine: 2 }], tags: ["session"] }, author.id)).card;
  const results = [];
  for (const [scenario, prompt] of [
    ["prompted", "先用 knowledge_search 查询项目的 Session 约束，再用 knowledge_get 阅读命中的卡片。给 session.js 添加 renameSession(state, name) 方法，运行 npm test。最后用 knowledge_propose 提议保留 Session 状态修改入口的知识草稿。"],
    ["spontaneous", "给 session.js 添加 setLocale(state, locale) 方法，遵守项目约定并运行 npm test。"]
  ]) {
    const created = (await request("agent/runs", { prompt, contexts: [{ type: "file", path: "session.js" }] }, initiator.id)).run as AgentRun;
    let run = created;
    const deadline = Date.now() + 240_000;
    while (["queued", "running"].includes(run.status) && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 500));
      run = (await request(`agent/runs/${run.id}`, undefined, initiator.id)).run;
    }
    if (["queued", "running"].includes(run.status)) throw new Error("MCP smoke exceeded 240 seconds");
    const events = (await request(`agent/runs/${run.id}/trace`, undefined, initiator.id)).events as AgentTraceEvent[];
    const toolCalls = events.filter(event => event.type === "knowledge_tool_call");
    results.push({ scenario, run, toolCalls, searchHit: toolCalls.some(event => event.data?.tool === "knowledge_search" && (event.data.resultIds as string[]).includes(card.id)), injected: events.find(event => event.type === "knowledge_injected")?.data });
    console.log(JSON.stringify({ scenario, status: run.status, toolCalls: toolCalls.map(event => event.data?.tool) }));
    await output("mcp-smoke.json", results);
  }
  const inbox = await request("knowledge/inbox", undefined, initiator.id);
  await output("mcp-inbox.json", inbox);
  const proposals = inbox.suggestions.filter((item: { origin: string }) => item.origin === "agent-self");
  if (proposals.length) {
    const draft = (await request(`knowledge/inbox/${proposals[0].id}/accept`, {}, initiator.id)).card;
    const confirmed = (await request(`knowledge/cards/${draft.id}/confirm`, {}, initiator.id)).card;
    await output("mcp-proposal-confirm.json", { draft, confirmed });
  }
  await output("mcp-reuse.json", await request("knowledge/metrics/reuse", undefined, initiator.id));
  const imported = await request("knowledge/import", { files: ["CONTRIBUTING.md"] }, author.id);
  await output("import-real.json", imported);
} finally {
  await app.locals.agentRuns.dispose(); await app.locals.agentRuntime.dispose(); await app.locals.runtimeManager.dispose();
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
}
