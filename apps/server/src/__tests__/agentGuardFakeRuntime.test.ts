import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { attachRealtimeServer } from "../realtime.js";
import { createApp } from "../createApp.js";
import { createTestWorkspace } from "./testWorkspace.js";

let root: string;
let running: Awaited<ReturnType<typeof startServer>> | undefined;
const memberSockets: WebSocket[] = [];

beforeEach(async () => {
  root = await createTestWorkspace("agent-guard-fake-");
  await fs.mkdir(path.join(root, "workspace"), { recursive: true });
  await fs.writeFile(path.join(root, "workspace", "README.md"), "# Fake Agent\n");
});

afterEach(async () => {
  await running?.close();
  for (const socket of memberSockets) socket.close();
  memberSockets.length = 0;
  running = undefined;
  await fs.rm(root, { recursive: true, force: true });
});

describe("Agent Guard fake runtime permissions", () => {
  it("handles bash, edit move targets, v2 events, and sub-session events", async () => {
    running = await startServer();
    const memberId = await joinMember(running.origin, "student", "student");
    const ownerId = await joinMember(running.origin, "teacher", "owner");

    for (const [marker, expectedTraceType] of [
      ["bash", "opencode.permission.asked"],
      ["edit", "opencode.permission.asked"],
      ["v2", "opencode.permission.v2.asked"],
      ["sub-session", "opencode.permission.asked"]
    ] as const) {
      const run = await createRun(running.origin, memberId, `fake-permission=${marker} fake-reply=${marker}-done`);
      const approval = await waitForApproval(running.origin, ownerId, run.id);
      await approve(running.origin, ownerId, approval.id);
      const completed = await waitForRun(running.origin, memberId, run.id, "completed");
      expect(completed.output).toContain(`${marker}-done`);
      const trace = await readTrace(running.origin, memberId, run.id);
      expect(trace.some((event) => event.type === expectedTraceType)).toBe(true);
    }
  }, 30_000);

  it("keeps a run alive when the permission reply endpoint returns 404", async () => {
    running = await startServer();
    const memberId = await joinMember(running.origin, "student", "student");
    const ownerId = await joinMember(running.origin, "teacher", "owner");
    const run = await createRun(running.origin, memberId, "fake-permission=bash fake-reply-404 fake-reply=reply-404-done");
    const approval = await waitForApproval(running.origin, ownerId, run.id);
    await approve(running.origin, ownerId, approval.id);
    const completed = await waitForRun(running.origin, memberId, run.id, "completed");
    expect(completed.output).toContain("reply-404-done");
    const trace = await readTrace(running.origin, memberId, run.id);
    expect(trace).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "permission_reply_failed" })
    ]));
  }, 30_000);

  it("cancels a run while its permission request is awaiting approval", async () => {
    running = await startServer();
    const memberId = await joinMember(running.origin, "student", "student");
    const ownerId = await joinMember(running.origin, "teacher", "owner");
    const run = await createRun(running.origin, memberId, "fake-permission=bash fake-delay=1000 fake-reply=never");
    const approval = await waitForApproval(running.origin, ownerId, run.id);
    const response = await fetch(`${running.origin}/api/projects/demo/agent/runs/${run.id}/cancel`, {
      method: "POST",
      headers: headers(memberId),
      body: JSON.stringify({ memberId })
    });
    expect(response.status).toBe(200);
    const cancelled = await waitForRun(running.origin, memberId, run.id, "cancelled");
    expect(cancelled.status).toBe("cancelled");
    await waitForNoApproval(running.origin, ownerId, approval.id);
  }, 30_000);

  it("does not enqueue a permission request after an Agent run is cancelled", async () => {
    running = await startServer();
    const memberId = await joinMember(running.origin, "student", "student-before-permission");
    const run = await createRun(running.origin, memberId, "fake-permission=bash fake-delay=1000 fake-reply=never");
    await waitForRun(running.origin, memberId, run.id, "running");
    const response = await fetch(`${running.origin}/api/projects/demo/agent/runs/${run.id}/cancel`, {
      method: "POST",
      headers: headers(memberId),
      body: JSON.stringify({ memberId })
    });
    expect(response.status).toBe(200);
    await expect(waitForRun(running.origin, memberId, run.id, "cancelled")).resolves.toMatchObject({ status: "cancelled" });
    await new Promise((resolve) => setTimeout(resolve, 100));
    const approvalsResponse = await fetch(`${running.origin}/api/projects/demo/guard/approvals`, { headers: headers(memberId) });
    expect((await approvalsResponse.json() as { approvals: unknown[] }).approvals).toHaveLength(0);
  }, 30_000);

  it("lets an owner who joins after enqueue approve the pending request", async () => {
    running = await startServer();
    const memberId = await joinMember(running.origin, "student", "student");
    const run = await createRun(running.origin, memberId, "fake-permission=bash fake-reply=late-owner");
    await waitForRun(running.origin, memberId, run.id, "running");
    const ownerId = await joinMember(running.origin, "teacher", "late-owner");
    const approval = await waitForApproval(running.origin, ownerId, run.id);
    await approve(running.origin, ownerId, approval.id);
    await expect(waitForRun(running.origin, memberId, run.id, "completed")).resolves.toMatchObject({ output: expect.stringContaining("late-owner") });
  }, 30_000);
});

async function startServer() {
  const app = await createApp({
    port: 4000,
    host: "127.0.0.1",
    publicOrigin: "http://127.0.0.1:5173",
    dataDir: path.join(root, "data"),
    demoProjectRoot: path.join(root, "workspace"),
    guardMode: "full",
    guardLlmMode: "off",
    guardApprovalTimeoutMs: 5_000,
    fakeAgentRuntime: true,
    agent: { baseUrl: "http://127.0.0.1:1", model: "fake", openCodePort: 4097, runTimeoutMs: 10_000 }
  });
  const server = http.createServer(app);
  const realtime = attachRealtimeServer(server, app.locals.runtimeManager, app.locals.agentRuns, { members: app.locals.members });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Server did not expose a local port");
  return {
    origin: `http://127.0.0.1:${address.port}`,
    async close() {
      realtime.dispose();
      for (const socketServer of [realtime.presence, realtime.documents, realtime.terminal]) {
        for (const client of socketServer.clients) client.terminate();
        socketServer.close();
      }
      await app.locals.agentRuns.dispose();
      await app.locals.agentRuntime.dispose();
      await app.locals.runtimeManager.dispose();
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  };
}

function headers(memberId: string) {
  return { "content-type": "application/json", "x-simplercp-member": memberId };
}

async function joinMember(origin: string, role: string, label: string) {
  const response = await fetch(`${origin}/api/projects/demo/members`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: `Fake Agent ${label}`, role, userId: `fake-agent-${label}`, connectionId: `fake-agent-${label}-connection` })
  });
  expect(response.status).toBe(200);
  const body = await response.json() as { member: { id: string } };
  const memberSocket = new WebSocket(`${origin.replace("http", "ws")}/ws?projectId=demo&memberId=${body.member.id}`);
  memberSockets.push(memberSocket);
  await new Promise<void>((resolve, reject) => {
    memberSocket?.once("open", () => resolve());
    memberSocket?.once("error", reject);
  });
  const roomResponse = await fetch(`${origin}/api/projects/demo/room`, { headers: headers(body.member.id) });
  const room = (await roomResponse.json() as { room: { id: string } }).room;
  memberSocket.send(JSON.stringify({ type: "ready", roomId: room.id, memberId: body.member.id }));
  await new Promise((resolve) => setTimeout(resolve, 25));
  return body.member.id;
}

async function createRun(origin: string, memberId: string, prompt: string) {
  const response = await fetch(`${origin}/api/projects/demo/agent/runs`, {
    method: "POST",
    headers: headers(memberId),
    body: JSON.stringify({ prompt })
  });
  expect(response.status).toBe(202);
  return (await response.json() as { run: { id: string } }).run;
}

async function waitForApproval(origin: string, memberId: string, runId: string) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const response = await fetch(`${origin}/api/projects/demo/guard/approvals`, { headers: headers(memberId) });
    const approvals = (await response.json() as { approvals: Array<{ id: string }> }).approvals;
    if (approvals[0]) return approvals[0];
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  const runResponse = await fetch(`${origin}/api/projects/demo/agent/runs/${runId}`, { headers: headers(memberId) });
  const run = (await runResponse.json() as { run: { status: string; error?: string } }).run;
  const trace = await readTrace(origin, memberId, runId);
  throw new Error(`Agent approval did not appear; run=${run.status}; error=${run.error ?? "none"}; trace=${trace.map((event) => event.type).join(",")}`);
}

async function approve(origin: string, memberId: string, approvalId: string) {
  const response = await fetch(`${origin}/api/projects/demo/guard/approvals/${approvalId}`, {
    method: "POST",
    headers: headers(memberId),
    body: JSON.stringify({ approve: true })
  });
  expect(response.status).toBe(200);
}

async function waitForRun(origin: string, memberId: string, runId: string, status: string) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const response = await fetch(`${origin}/api/projects/demo/agent/runs/${runId}`, { headers: headers(memberId) });
    const run = (await response.json() as { run: { status: string; output?: string } }).run;
    if (run.status === status) return run;
    if (run.status === "failed") throw new Error(`Agent run failed: ${run.output ?? "unknown"}`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Agent run did not reach ${status}`);
}

async function waitForNoApproval(origin: string, memberId: string, approvalId: string) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const response = await fetch(`${origin}/api/projects/demo/guard/approvals`, { headers: headers(memberId) });
    const approvals = (await response.json() as { approvals: Array<{ id: string }> }).approvals;
    if (!approvals.some((approval) => approval.id === approvalId)) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("Cancelled approval remained pending");
}

async function readTrace(origin: string, memberId: string, runId: string) {
  const response = await fetch(`${origin}/api/projects/demo/agent/runs/${runId}/trace`, { headers: headers(memberId) });
  return (await response.json() as { events: Array<{ type: string }> }).events;
}
