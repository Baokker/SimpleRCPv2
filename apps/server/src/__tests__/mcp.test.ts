import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../createApp.js";
import { knowledgeRunsAt } from "../knowledge/provider.js";
import type { AgentRun } from "@simplercp/shared";
import { getProjectMetadataPath } from "../projects.js";
import { createTestWorkspace } from "./testWorkspace.js";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { for (const close of cleanups.splice(0).reverse()) await close(); });

async function setup() {
  const root = await createTestWorkspace("knowledge-mcp-");
  const demo = path.join(root, "demo"); await fs.mkdir(demo);
  await fs.writeFile(path.join(demo, "README.md"), "# Rules\n\n- Preserve sharedHelper.\n- Keep session state isolated.\n");
  const app = await createApp({ port: 0, host: "127.0.0.1", publicOrigin: "http://127.0.0.1:5173", dataDir: path.join(root, "data"), demoProjectRoot: demo, terminalEnabled: false, knowledge: "full" });
  const server = http.createServer(app);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); if (!address || typeof address === "string") throw new Error("Server address missing");
  const origin = `http://127.0.0.1:${address.port}`;
  const client = new Client({ name: "knowledge-test", version: "1" });
  cleanups.push(async () => { await client.close(); await app.locals.agentRuns.dispose(); await app.locals.agentRuntime.dispose(); await app.locals.runtimeManager.dispose(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); await fs.rm(root, { recursive: true, force: true }); });
  const request = async (route: string, body?: unknown, memberId?: string, method = body === undefined ? "GET" : "POST") => {
    const response = await fetch(`${origin}/api/projects/demo/${route}`, { method, headers: { "content-type": "application/json", ...(memberId ? { "X-SimpleRCP-Member": memberId } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const text = await response.text(); if (!response.ok) throw new Error(`HTTP ${response.status}: ${text}`);
    return text ? JSON.parse(text) : undefined;
  };
  const { member } = await request("members", { name: "Importer" });
  const project = app.locals.registry.getProject("demo");
  await client.connect(new StreamableHTTPClientTransport(new URL(`${origin}/mcp/knowledge`), { requestInit: { headers: { Authorization: `Bearer ${app.locals.knowledgeMcpToken}` } } }));
  const tool = async (name: string, args: Record<string, unknown>) => {
    const result = await client.callTool({ name, arguments: { workspace: project.workspacePath, ...args } });
    const content = result.content as Array<{ type: string; text?: string }>;
    return { error: result.isError, data: JSON.parse(content.find(item => item.type === "text")!.text!) };
  };
  return { app, origin, client, request, member, project, tool };
}

describe("knowledge MCP endpoint", () => {
  it("authenticates SDK clients and restricts tool results to reviewed team cards", async () => {
    const { app, origin, client, request, member, project, tool } = await setup();
    expect((await fetch(`${origin}/mcp/knowledge`, { method: "POST", headers: { authorization: "Bearer invalid" } })).status).toBe(401);
    expect((await client.listTools()).tools.map(item => item.name)).toEqual(["knowledge_search", "knowledge_get", "knowledge_propose"]);
    const base = { type: "constraint", title: "sharedHelper rule", summary: "Preserve sharedHelper", content: "Preserve sharedHelper in session.js", tags: [] };
    const team = (await request("knowledge/cards", { ...base, scope: "team" }, member.id)).card;
    const personal = (await request("knowledge/cards", { ...base, title: "private sharedHelper", scope: "personal" }, member.id)).card;
    const runtime = app.locals.runtimeManager.get("demo");
    const draft = await runtime.knowledge.createDraft({ memberId: member.id, displayName: "Importer" }, { ...base, scope: "team", source: "event", provenance: { origin: "preset", author: { kind: "human", memberId: member.id, displayName: "Importer" }, evidenceRefs: { runIds: [], chatMessageIds: [], files: [] } } });
    expect((await tool("knowledge_search", { query: "sharedHelper" })).data.results.map((card: { id: string }) => card.id)).toEqual([team.id]);
    expect((await tool("knowledge_get", { id: team.id })).data.card.content).toContain("sharedHelper");
    expect((await tool("knowledge_get", { id: personal.id })).error).toBe(true);
    expect((await tool("knowledge_get", { id: draft.id })).error).toBe(true);
    expect((await tool("knowledge_search", { workspace: "/unregistered", query: "rule" })).error).toBe(true);
    await request("knowledge/config", { toolEnabled: false }, member.id, "PUT");
    expect((await tool("knowledge_search", { query: "sharedHelper" })).data).toEqual({ results: [], disabled: true });
    const log = await fs.readFile(path.join(getProjectMetadataPath(project), "knowledge/tool-calls.jsonl"), "utf8");
    expect(log.trim().split("\n")).toHaveLength(5);
    expect(log).not.toContain(app.locals.knowledgeMcpToken);
  });

  it("selects active runs at call time and requires a human to confirm proposals", async () => {
    const { app, request, member, project, tool } = await setup();
    const second = (await request("members", { name: "Bob" })).member;
    const team = (await request("knowledge/cards", { type: "constraint", title: "sharedHelper", summary: "sharedHelper", content: "Use sharedHelper", scope: "team" }, second.id)).card;
    const at = Date.now();
    const run = { id: "source-run", startedAt: new Date(at - 1000).toISOString(), finishedAt: new Date(at + 1000).toISOString(), status: "completed" } as AgentRun;
    const other = { ...run, id: "other-run", finishedAt: undefined, status: "running" } as AgentRun;
    expect(knowledgeRunsAt([run], at)).toEqual([run]);
    expect(knowledgeRunsAt([run, other], at)).toHaveLength(2);
    expect(knowledgeRunsAt([run], at + 2000)).toHaveLength(0);
    expect((await tool("knowledge_propose", { title: "Rule", summary: "Rule", content: "Preserve helper", type: "constraint" })).error).toBe(true);
    await request("knowledge/config", { proposeEnabled: true }, member.id, "PUT");
    expect((await tool("knowledge_propose", { title: "Rule", summary: "Rule", content: "Rule", type: "constraint" })).data.error).toContain("No active Agent run");
    const suggestion = await app.locals.runtimeManager.get("demo").capture.propose({ memberId: member.id, displayName: "Importer" }, run.id, { title: "Rule", summary: "Rule", content: "Preserve helper", type: "constraint", files: ["src/**"] });
    expect(suggestion).toMatchObject({ origin: "agent-self", state: "open", actors: { memberIds: [member.id], runIds: [run.id] } });
    const draft = (await request(`knowledge/inbox/${suggestion.id}/accept`, {}, member.id)).card;
    expect(draft).toMatchObject({ status: "draft", scope: "personal", provenance: { author: { kind: "agent", agentRunId: run.id } } });
    const confirmed = (await request(`knowledge/cards/${draft.id}/confirm`, {}, member.id)).card;
    expect(confirmed.review.confirmedBy).toContain(member.id);
  });

  it("imports source ranges into drafts and exports exact roundtrip entries", async () => {
    const { request, member, project } = await setup();
    await request("knowledge/config", { requireSecondConfirmForTeam: false }, member.id, "PUT");
    const imported = await request("knowledge/import", { files: ["README.md"] }, member.id);
    expect(imported.drafts).toHaveLength(2);
    for (const item of imported.drafts) {
      const draft = (await request(`knowledge/inbox/${item.suggestionId}/accept`, {}, member.id)).card;
      expect(draft.provenance.origin).toBe("preset");
      expect(draft.anchors[0].rangeAtCapture.start.line + 1).toBe(item.startLine);
      await request(`knowledge/cards/${draft.id}/confirm`, {}, member.id);
    }
    const exported = await request("knowledge/export/workspace", {}, member.id);
    expect(exported.path).toBe("AGENTS.md");
    expect(await fs.readFile(path.join(project.workspacePath, exported.path), "utf8")).toBe(exported.markdown);
    const reimported = await request("knowledge/import", { files: [exported.path] }, member.id);
    expect(reimported.drafts).toHaveLength(2);
    expect((await request("knowledge/export/workspace", {}, member.id)).path).toBe("AGENTS.knowledge.md");
  });

  it("preserves distinct proposals from a correction run and deduplicates repeated proposals", async () => {
    const { app, request, member } = await setup();
    const runtime = app.locals.runtimeManager.get("demo");
    const actor = { memberId: member.id, displayName: "Importer" };
    await runtime.capture.agentRun({ action: "start", runId: "previous-task", memberId: member.id, sessionId: "session", prompt: "Update session state" });
    await runtime.capture.agentRun({ action: "end", status: "completed", runId: "previous-task", memberId: member.id, sessionId: "session", prompt: "Update session state" });
    await runtime.capture.agentRun({ action: "start", runId: "correction-task", memberId: member.id, sessionId: "session", prompt: "不要直接修改 state，改用 sharedHelper" });
    const correction = (await runtime.capture.list(member.id)).find((item: { triggerType: string }) => item.triggerType === "agent.corrected");
    expect(correction).toBeDefined();

    const helperRule = { type: "constraint" as const, title: "Use sharedHelper", summary: "Use the shared helper for state changes", content: "Call sharedHelper when updating session state.", files: ["src/session.ts"] };
    const first = await runtime.capture.propose(actor, "correction-task", helperRule);
    const second = await runtime.capture.propose(actor, "correction-task", { ...helperRule, title: "Preserve session isolation", content: "Keep state isolated between sessions." });
    expect(new Set([correction.id, first.id, second.id]).size).toBe(3);
    expect(first).toMatchObject({ origin: "agent-self", triggerType: "agent.proposed", evidence: { draft: helperRule } });
    expect((await runtime.capture.propose(actor, "correction-task", helperRule)).id).toBe(first.id);
    const accepted = await request(`knowledge/inbox/${first.id}/accept`, {}, member.id);
    expect(accepted.card).toMatchObject({ title: helperRule.title, content: helperRule.content, provenance: { origin: "agent-self", author: { agentRunId: "correction-task" } } });
    expect((await runtime.capture.get(second.id)).evidence.draft.content).toBe("Keep state isolated between sessions.");
  });

  it("bounds the complete injection section including its heading and tool instructions", async () => {
    const { request, member } = await setup();
    const card = (await request("knowledge/cards", { type: "constraint", title: "sharedHelper", summary: "Preserve sharedHelper", content: "Use sharedHelper for state changes.", scope: "team" }, member.id)).card;
    await request("knowledge/config", { fixedCardIds: [card.id], maxTotalChars: 10_000 }, member.id, "PUT");
    const full = await request("knowledge/preview", { prompt: "Update state" }, member.id);
    expect(full.records.map((item: { id: string }) => item.id)).toEqual([card.id]);
    expect(full.totalChars).toBe(full.section.length);
    const budget = full.totalChars - 1;
    await request("knowledge/config", { maxTotalChars: budget }, member.id, "PUT");
    const limited = await request("knowledge/preview", { prompt: "Update state" }, member.id);
    expect(limited.totalChars).toBeLessThanOrEqual(budget);
    expect(limited.records).toEqual([]);
    expect(limited.section).toContain("knowledge_search");
    expect(limited.estimatedInjectionTokens).toBe(Math.ceil(limited.totalChars / 4));

    await request("knowledge/config", { maxTotalChars: 1 }, member.id, "PUT");
    const tiny = await request("knowledge/preview", { prompt: "Update state" }, member.id);
    expect(tiny).toMatchObject({ records: [], totalChars: 0, estimatedInjectionTokens: 0 });
    expect(tiny.section).toBeUndefined();
  });

  it("budgets contradiction annotations and marks only the cards actually injected", async () => {
    const { request, member } = await setup();
    const base = { type: "constraint", summary: "State rule", content: "Use the helper for state changes.", scope: "team" };
    const first = (await request("knowledge/cards", { ...base, title: "State rule A" }, member.id)).card;
    const second = (await request("knowledge/cards", { ...base, title: "State rule B" }, member.id)).card;
    await request(`knowledge/cards/${first.id}/relations`, { kind: "contradicts", cardId: second.id }, member.id);
    await request("knowledge/config", { fixedCardIds: [first.id, second.id], maxTotalChars: 10_000 }, member.id, "PUT");
    const full = await request("knowledge/preview", { prompt: "Update state" }, member.id);
    expect(full.records).toHaveLength(2);
    expect(full.section.match(/CONTRADICTS_ANOTHER_INJECTED_CARD/g)).toHaveLength(2);
    await request("knowledge/config", { maxTotalChars: full.totalChars - 1 }, member.id, "PUT");
    const limited = await request("knowledge/preview", { prompt: "Update state" }, member.id);
    expect(limited.records).toHaveLength(1);
    expect(limited.totalChars).toBeLessThan(full.totalChars);
    expect(limited.section).not.toContain("CONTRADICTS_ANOTHER_INJECTED_CARD");
  });
});
