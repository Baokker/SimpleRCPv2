import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../createApp.js";
import { joinMember } from "./memberTestHelper.js";
import { createTestWorkspace } from "./testWorkspace.js";

describe("Agent concurrency with fake runtime", () => {
  let root: string;
  let server: http.Server;
  let origin: string;
  let memberId: string;

  beforeEach(async () => {
    root = await createTestWorkspace("agent-concurrency-");
    const demoRoot = path.join(root, "demo", "workspace");
    await fs.mkdir(demoRoot, { recursive: true });
    const app = await createApp({
      port: 0,
      host: "127.0.0.1",
      publicOrigin: "http://127.0.0.1:5173",
      dataDir: path.join(root, "data"),
      demoProjectRoot: demoRoot,
      fakeAgentRuntime: true,
      agent: {
        baseUrl: "https://api.deepseek.com/v1",
        model: "fake-agent",
        maxConcurrentRuns: 2,
        runTimeoutMs: 10_000
      }
    });
    server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Server did not start");
    origin = `http://127.0.0.1:${address.port}`;
    const member = await joinMember(origin, "demo", { name: "Concurrency tester" });
    memberId = member.member.id;
  });

  afterEach(async () => {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await fs.rm(root, { recursive: true, force: true });
  });

  it("starts two sessions and fills the next slot when one finishes", async () => {
    const runs = await Promise.all([300, 300, 300].map((delay) => createRun(`fake-delay=${delay}`)));
    await waitFor(() => getRuns().then((items) => items.filter((run) => run.status === "running").length === 2));
    expect((await getRuns()).filter((run) => run.status === "queued")).toHaveLength(1);
    await waitFor(async () => (await getRuns()).every((run) => run.status === "completed"));
    expect(runs).toHaveLength(3);
  });

  it("serializes the same session and records tool attribution", async () => {
    const sessionResponse = await fetch(`${origin}/api/projects/demo/agent/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json", "X-SimpleRCP-Member": memberId },
      body: JSON.stringify({ title: "Shared session" })
    });
    const session = (await sessionResponse.json() as { session: { id: string } }).session;
    await createRun("fake-delay=250 fake-write=one.ts", session.id);
    await createRun("fake-delay=250 fake-write=two.ts", session.id);
    await waitFor(async () => (await getRuns()).every((run) => run.status === "completed"));
    const completed = await getRuns();
    expect(completed.filter((run) => run.sessionId === session.id)).toHaveLength(2);
    expect(completed.flatMap((run) => run.fileChanges ?? []).map((change) => change.attribution)).toContain("tool");
  });

  async function createRun(prompt: string, sessionId?: string) {
    const response = await fetch(`${origin}/api/projects/demo/agent/runs`, {
      method: "POST",
      headers: { "content-type": "application/json", "X-SimpleRCP-Member": memberId },
      body: JSON.stringify({ prompt, sessionId })
    });
    expect(response.status).toBe(202);
    return (await response.json() as { run: { id: string } }).run;
  }

  async function getRuns() {
    const response = await fetch(`${origin}/api/projects/demo/agent/runs`, {
      headers: { "X-SimpleRCP-Member": memberId }
    });
    return (await response.json() as { runs: Array<{ id: string; status: string; sessionId?: string; fileChanges?: Array<{ attribution?: string }> }> }).runs;
  }

  async function waitFor(predicate: () => Promise<boolean>) {
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
      if (await predicate()) return;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new Error("Timed out waiting for Agent runs");
  }
});
