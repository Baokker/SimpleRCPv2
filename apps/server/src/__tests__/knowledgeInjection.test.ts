import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../createApp.js";
import { attachRealtimeServer } from "../realtime.js";
import { createTestWorkspace } from "./testWorkspace.js";

const active: Array<{ close(): Promise<void> }> = [];

describe("knowledge agent injection", () => {
  it("previews, injects, excludes, and records post-run checks", async () => {
    const root = await createTestWorkspace("knowledge-injection-");
    const workspace = path.join(root, "source");
    await fs.mkdir(workspace, { recursive: true });
    await fs.writeFile(path.join(workspace, "README.md"), "Keep the project rule.\n");
    const app = await createApp({
      port: 0,
      host: "127.0.0.1",
      publicOrigin: "http://127.0.0.1:5173",
      dataDir: path.join(root, "data"),
      demoProjectRoot: workspace,
      terminalEnabled: false,
      fakeAgentRuntime: true,
      knowledge: "full",
      agent: { baseUrl: "https://api.deepseek.com/v1", model: "deepseek-chat" }
    });
    const server = http.createServer(app);
    const realtime = attachRealtimeServer(server, app.locals.runtimeManager, app.locals.agentRuns, { members: app.locals.members });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Server address missing");
    const origin = `http://127.0.0.1:${address.port}`;
    const close = async () => {
      realtime.dispose();
      await app.locals.agentRuns.dispose();
      await app.locals.agentRuntime.dispose();
      await app.locals.runtimeManager.dispose();
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
      await fs.rm(root, { recursive: true, force: true });
    };
    active.push({ close });

    const memberResponse = await fetch(`${origin}/api/projects/demo/members`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "Ada" }) });
    const memberId = (await memberResponse.json() as { member: { id: string } }).member.id;
    const secondMemberResponse = await fetch(`${origin}/api/projects/demo/members`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "Bob" }) });
    const secondMemberId = (await secondMemberResponse.json() as { member: { id: string } }).member.id;
    const headers = { "content-type": "application/json", "X-SimpleRCP-Member": memberId };
    const secondHeaders = { "content-type": "application/json", "X-SimpleRCP-Member": secondMemberId };
    const cardResponse = await fetch(`${origin}/api/projects/demo/knowledge/cards`, { method: "POST", headers, body: JSON.stringify({ type: "constraint", title: "Project rule", summary: "Keep the project rule", content: "The project rule must remain documented.", tags: ["rule"], scope: "team" }) });
    expect(cardResponse.status).toBe(201);
    const card = (await cardResponse.json() as { card: { id: string } }).card;

    const personalResponse = await fetch(`${origin}/api/projects/demo/knowledge/cards`, { method: "POST", headers, body: JSON.stringify({ type: "context", title: "Ada private note", summary: "Only Ada can use this note", content: "Private note", tags: [], scope: "personal" }) });
    expect(personalResponse.status).toBe(201);
    const personalCard = (await personalResponse.json() as { card: { id: string } }).card;
    const bobPreview = await fetch(`${origin}/api/projects/demo/agent/knowledge/preview`, { method: "POST", headers: secondHeaders, body: JSON.stringify({ prompt: "Ada private note" }) });
    expect((await bobPreview.json() as { records: Array<{ id: string }> }).records.map((item) => item.id)).not.toContain(personalCard.id);

    const preview = await fetch(`${origin}/api/projects/demo/agent/knowledge/preview`, { method: "POST", headers, body: JSON.stringify({ prompt: "Please follow the project rule" }) });
    expect(preview.status).toBe(200);
    expect((await preview.json() as { records: Array<{ id: string }> }).records.map((item) => item.id)).toContain(card.id);
    const excludedPreview = await fetch(`${origin}/api/projects/demo/knowledge/preview`, { method: "POST", headers, body: JSON.stringify({ prompt: "Please follow the project rule", knowledge: { excludeCardIds: [card.id] } }) });
    expect((await excludedPreview.json() as { records: Array<{ id: string }> }).records.map((item) => item.id)).not.toContain(card.id);
    const fixedConfig = await fetch(`${origin}/api/projects/demo/knowledge/config`, { method: "PUT", headers, body: JSON.stringify({ fixedCardIds: [card.id] }) });
    expect(fixedConfig.status).toBe(200);
    const fixedPreview = await fetch(`${origin}/api/projects/demo/agent/knowledge/preview`, { method: "POST", headers, body: JSON.stringify({ prompt: "Unrelated task" }) });
    expect((await fixedPreview.json() as { records: Array<{ id: string }> }).records.map((item) => item.id)).toContain(card.id);
    const previewCard = await fetch(`${origin}/api/projects/demo/knowledge/cards/${card.id}`, { headers });
    expect((await previewCard.json() as { card: { usage?: { injectedCount?: number } } }).card.usage?.injectedCount ?? 0).toBe(0);

    const injectedRunResponse = await fetch(`${origin}/api/projects/demo/agent/runs`, { method: "POST", headers, body: JSON.stringify({ prompt: "Follow the project rule fake-reply=done" }) });
    const injectedRunId = (await injectedRunResponse.json() as { run: { id: string } }).run.id;
    let injectedStatus = "queued";
    for (let attempt = 0; attempt < 100 && injectedStatus !== "completed"; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 20));
      const response = await fetch(`${origin}/api/projects/demo/agent/runs/${injectedRunId}`, { headers });
      injectedStatus = ((await response.json()) as { run: { status: string } }).run.status;
    }
    const injectedTrace = await fetch(`${origin}/api/projects/demo/agent/runs/${injectedRunId}/trace`, { headers });
    const injectedEvents = (await injectedTrace.json() as { events: Array<{ type: string; data?: Record<string, unknown> }> }).events;
    expect(injectedEvents.map((event) => event.type)).toContain("knowledge_injected");
    expect(String(injectedEvents.find((event) => event.type === "opencode.fake.started")?.data?.prompt)).toContain("Project rule");

    const created = await fetch(`${origin}/api/projects/demo/agent/runs`, { method: "POST", headers, body: JSON.stringify({ prompt: "Follow the project rule fake-reply=done", knowledge: { excludeCardIds: [card.id] } }) });
    expect(created.status).toBe(202);
    const runId = (await created.json() as { run: { id: string } }).run.id;
    let status = "queued";
    for (let attempt = 0; attempt < 100 && status !== "completed"; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 20));
      const response = await fetch(`${origin}/api/projects/demo/agent/runs/${runId}`, { headers });
      status = ((await response.json()) as { run: { status: string } }).run.status;
    }
    expect(status).toBe("completed");
    const trace = await fetch(`${origin}/api/projects/demo/agent/runs/${runId}/trace`, { headers });
    const events = (await trace.json() as { events: Array<{ type: string; data?: Record<string, unknown> }> }).events;
    expect(events.map((event) => event.type)).toContain("knowledge_post_check");
    const injected = events.find((event) => event.type === "knowledge_injected");
    expect(injected?.data?.cards).toEqual([]);

    const checkResponse = await fetch(`${origin}/api/projects/demo/knowledge/cards`, { method: "POST", headers, body: JSON.stringify({ type: "negative", title: "Written file check", summary: "The generated marker must remain present", content: "The generated marker must remain present after the Agent task.", scope: "team", tags: [], anchors: [{ file: "README.md", startLine: 1, endLine: 1 }], check: { kind: "regex-present", pattern: "Written by fake Agent", fileGlob: "README.md" } }) });
    expect(checkResponse.status).toBe(201);
    const checkedRunResponse = await fetch(`${origin}/api/projects/demo/agent/runs`, { method: "POST", headers, body: JSON.stringify({ prompt: "Write the guarded file fake-write=README.md fake-reply=checked" }) });
    const checkedRunId = (await checkedRunResponse.json() as { run: { id: string } }).run.id;
    let checkedStatus = "queued";
    for (let attempt = 0; attempt < 100 && checkedStatus !== "completed"; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 20));
      const response = await fetch(`${origin}/api/projects/demo/agent/runs/${checkedRunId}`, { headers });
      checkedStatus = ((await response.json()) as { run: { status: string } }).run.status;
    }
    expect(checkedStatus).toBe("completed");
    const checkedTrace = await fetch(`${origin}/api/projects/demo/agent/runs/${checkedRunId}/trace`, { headers });
    const checkedEvents = (await checkedTrace.json() as { events: Array<{ type: string; data?: Record<string, unknown> }> }).events;
    const postCheck = checkedEvents.find((event) => event.type === "knowledge_post_check");
    expect(postCheck?.data?.hits).toEqual(expect.arrayContaining([expect.objectContaining({ file: "README.md", checkResult: { passed: true, message: "Check passed" } })]));
  });
});

afterEach(async () => {
  await Promise.all(active.splice(0).map((item) => item.close()));
});
