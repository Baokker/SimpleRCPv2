import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { expect, it } from "vitest";
import { createApp } from "../createApp.js";
import { createAgentRunStore } from "../agent/agentRunStore.js";
import { createTraceStore } from "../agent/traceStore.js";
import { getProjectMetadataPath } from "../projects.js";
import { createTestWorkspace } from "./testWorkspace.js";
import { joinMember } from "./memberTestHelper.js";
import type { AgentRun, AgentSession } from "@simplercp/shared";

it("personal run details and trace downloads belong to their owner; session deletion persists", async () => {
  const root = await createTestWorkspace("agent-privacy-");
  const workspace = path.join(root, "workspace");
  await fs.mkdir(workspace);
  const config = { port: 0, host: "127.0.0.1", publicOrigin: "http://127.0.0.1", dataDir: path.join(root, "data"), demoProjectRoot: workspace, terminalEnabled: false };
  let app = await createApp(config);
  let server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing server address");
  let origin = `http://127.0.0.1:${address.port}`;
  const request = (memberId: string, endpoint: string, init?: RequestInit) => fetch(`${origin}/api/projects/demo${endpoint}`, { ...init, headers: { ...init?.headers, "X-SimpleRCP-Member": memberId } });
  try {
    const alice = await joinMember(origin, "demo", { name: "Alice" });
    const bob = await joinMember(origin, "demo", { name: "Bob" });
    const session = await app.locals.agentRuns.createSession({ projectId: "demo", memberId: alice.member.id, title: "Personal work" });
    const metadata = getProjectMetadataPath(app.locals.registry.getProject("demo"));
    const store = createAgentRunStore("demo", metadata);
    const run = await store.create({ projectId: "demo", memberId: alice.member.id, sessionId: session.id, sessionScope: "personal", prompt: "Personal request", status: "completed", runtime: "opencode", provider: "deepseek", model: "deepseek-flash" });
    await createTraceStore(path.join(store.runsRoot, run.id, "trace.jsonl")).append({ type: "run_completed", summary: "Personal result" });
    await app.locals.agentRuns.dispose(); await app.locals.agentRuntime.dispose(); await app.locals.runtimeManager.dispose();
    expect(() => app.locals.runtimeManager.get("demo")).toThrow("closing");
    await new Promise<void>((resolve) => server.close(() => resolve()));
    app = await createApp(config);
    server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const restarted = server.address();
    if (!restarted || typeof restarted === "string") throw new Error("Missing restarted address");
    origin = `http://127.0.0.1:${restarted.port}`;
    await joinMember(origin, "demo", { name: "Alice", memberId: alice.member.id });
    await joinMember(origin, "demo", { name: "Bob", memberId: bob.member.id });
    expect(((await (await request(alice.member.id, "/agent/runs")).json()) as { runs: AgentRun[] }).runs.map((item) => item.id)).toContain(run.id);
    expect(((await (await request(bob.member.id, "/agent/runs")).json()) as { runs: AgentRun[] }).runs).toEqual([]);
    for (const endpoint of [`/agent/runs/${run.id}`, `/agent/runs/${run.id}/trace`, `/agent/runs/${run.id}/trace?download=true`]) {
      expect((await request(alice.member.id, endpoint)).status).toBe(200);
      expect((await request(bob.member.id, endpoint)).status).toBe(403);
    }
    expect((await request(bob.member.id, `/agent/runs/${run.id}/cancel`, { method: "POST" })).status).toBe(403);
    expect((await request(alice.member.id, `/agent/runs/${run.id}/cancel`, { method: "POST" })).status).toBe(200);
    expect((await request(bob.member.id, `/agent/sessions/${session.id}`, { method: "DELETE" })).status).toBe(403);
    expect((await request(alice.member.id, `/agent/sessions/${session.id}`, { method: "DELETE" })).status).toBe(204);
    expect(((await (await request(alice.member.id, "/agent/sessions")).json()) as { sessions: AgentSession[] }).sessions).toEqual([]);
    expect(((await (await request(alice.member.id, "/agent/runs")).json()) as { runs: AgentRun[] }).runs).toEqual([]);
    const persisted = JSON.parse(await fs.readFile(path.join(metadata, "agent-sessions", session.id, "session.json"), "utf8"));
    expect(persisted.session.deletedAt).toBeTruthy();
    expect((await request(alice.member.id, `/agent/sessions/${session.id}/runs`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ prompt: "Continue" }) })).status).toBe(400);
  } finally {
    await app.locals.agentRuns.dispose(); await app.locals.agentRuntime.dispose(); await app.locals.runtimeManager.dispose();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await fs.rm(root, { recursive: true, force: true });
  }
});
