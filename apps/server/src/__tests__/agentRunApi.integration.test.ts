import fs from "node:fs";
import fsPromises from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "dotenv";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { createApp } from "../createApp.js";
import { attachRealtimeServer } from "../realtime.js";
import { createTestWorkspace } from "./testWorkspace.js";

const environmentPath = fileURLToPath(new URL("../../../../.env", import.meta.url));
const environment = fs.existsSync(environmentPath)
  ? parse(fs.readFileSync(environmentPath))
  : {};
const apiKey = environment.DEEPSEEK_API_KEY?.trim();
const baseUrl = environment.DEEPSEEK_BASE_URL?.trim();
const model = environment.DEEPSEEK_MODEL?.trim();
const configured = Boolean(apiKey && baseUrl && model);
let root: string;

beforeEach(async () => {
  root = await createTestWorkspace("agent-run-api-");
  const demoRoot = path.join(root, "demo", "workspace");
  await fsPromises.mkdir(demoRoot, { recursive: true });
  await fsPromises.writeFile(path.join(demoRoot, "README.md"), "# Agent API test\n");
});

afterEach(async () => {
  await fsPromises.rm(root, { recursive: true, force: true });
});

describe.skipIf(!configured)("Agent run API with OpenCode", () => {
  it("reports Provider request failures as failed runs without a completion event", async () => {
    const running = await startServer(
      undefined,
      "invalid-simplercp-integration-key"
    );

    try {
      const memberId = await joinAgentTester(running.origin);
      const created = await createRun(
        running.origin,
        memberId,
        "Reply with exactly: this request should fail"
      );
      const failed = await waitForRun(
        running.origin,
        created.id,
        (run) => run.status === "failed"
      );

      expect(failed.status).toBe("failed");
      expect(failed.output).toBeUndefined();
      expect(failed.error).toContain("OpenCode Provider request failed");

      const traceResponse = await fetch(
        `${running.origin}/api/projects/demo/agent/runs/${created.id}/trace`
      );
      const traceBody = await traceResponse.json() as {
        events: Array<{ type: string; summary?: string }>;
      };
      const eventTypes = traceBody.events.map((event) => event.type);
      expect(eventTypes).toContain("opencode.session.error");
      expect(eventTypes).toContain("run_failed");
      expect(eventTypes).not.toContain("run_completed");
      expect(traceBody.events.at(-1)?.summary).toContain(
        "OpenCode Provider request failed"
      );

      const eventsResponse = await fetch(
        `${running.origin}/api/projects/demo/events`
      );
      const eventsBody = await eventsResponse.json() as {
        events: Array<{
          type: string;
          memberId?: string;
          payload?: Record<string, unknown>;
        }>;
      };
      expect(eventsBody.events).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: "agent_task_started",
            memberId,
            payload: expect.objectContaining({
              runId: created.id,
              promptPreview: "Reply with exactly: this request should fail"
            })
          }),
          expect.objectContaining({
            type: "agent_task_failed",
            memberId,
            payload: expect.objectContaining({
              runId: created.id,
              error: expect.stringContaining("OpenCode Provider request failed")
            })
          })
        ])
      );
    } finally {
      await running.close();
    }
  }, 120_000);

  it("executes a member task and persists ordered trace events", async () => {
    const running = await startServer();

    try {
      const memberResponse = await fetch(`${running.origin}/api/projects/demo/members`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "Agent Tester",
          userId: "agent-tester",
          connectionId: "agent-test-connection"
        })
      });
      const memberBody = await memberResponse.json() as { member: { id: string } };
      const socket = new WebSocket(
        `${running.origin.replace("http", "ws")}/ws?projectId=demo`
      );
      const realtimeMessages: Array<Record<string, unknown>> = [];
      socket.on("message", (data) => {
        realtimeMessages.push(JSON.parse(data.toString()) as Record<string, unknown>);
      });
      await new Promise<void>((resolve, reject) => {
        socket.once("open", resolve);
        socket.once("error", reject);
      });
      const createResponse = await fetch(
        `${running.origin}/api/projects/demo/agent/runs`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            memberId: memberBody.member.id,
            prompt: "Do not use tools. Reply with exactly: agent run completed"
          })
        }
      );
      const created = await createResponse.json() as { run: AgentRunResult };

      expect(createResponse.status).toBe(202);
      expect(created.run.status).toBe("queued");

      const completed = await waitForCompletedRun(running.origin, created.run.id);
      expect(completed.output?.trim().toLowerCase()).toBe("agent run completed");
      expect(completed.sessionId).toBeTruthy();
      await waitForCondition(() =>
        realtimeMessages.some(
          (message) =>
            message.type === "agent_run_updated" &&
            (message.run as AgentRunResult | undefined)?.id === created.run.id &&
            (message.run as AgentRunResult | undefined)?.status === "completed"
        ) &&
        realtimeMessages.some(
          (message) =>
            message.type === "agent_trace_appended" &&
            message.runId === created.run.id
        )
      );
      socket.close();

      const traceResponse = await fetch(
        `${running.origin}/api/projects/demo/agent/runs/${created.run.id}/trace`
      );
      const traceBody = await traceResponse.json() as {
        events: Array<{ sequence: number; type: string }>;
      };
      expect(traceBody.events.map((event) => event.sequence)).toEqual(
        traceBody.events.map((_, index) => index + 1)
      );
      expect(traceBody.events.map((event) => event.type)).toEqual(
        expect.arrayContaining([
          "run_queued",
          "run_started",
          "assistant_message",
          "run_completed"
        ])
      );
      expect(
        traceBody.events.some((event) => event.type.startsWith("opencode."))
      ).toBe(true);

      const downloadResponse = await fetch(
        `${running.origin}/api/projects/demo/agent/runs/${created.run.id}/trace?download=true`
      );
      const downloadedEvents = (await downloadResponse.text())
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line) as { sequence: number; type: string });
      expect(downloadResponse.headers.get("content-type")).toContain(
        "application/x-ndjson"
      );
      expect(downloadResponse.headers.get("content-disposition")).toContain(
        `trace-${created.run.id}.jsonl`
      );
      expect(downloadedEvents.map((event) => event.sequence)).toEqual(
        traceBody.events.map((event) => event.sequence)
      );

      const otherMemberResponse = await fetch(
        `${running.origin}/api/projects/demo/members`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            name: "Other Member",
            userId: "other-member",
            connectionId: "other-member-connection"
          })
        }
      );
      const otherMember = await otherMemberResponse.json() as {
        member: { id: string };
      };
      const foreignContinue = await fetch(
        `${running.origin}/api/projects/demo/agent/runs`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            memberId: otherMember.member.id,
            sessionId: completed.sessionId,
            prompt: "Continue this session"
          })
        }
      );
      expect(foreignContinue.status).toBe(400);

      const continuedResponse = await fetch(
        `${running.origin}/api/projects/demo/agent/runs`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            memberId: memberBody.member.id,
            sessionId: completed.sessionId,
            prompt: "Do not use tools. Reply with exactly: session continued"
          })
        }
      );
      const continuedBody = await continuedResponse.json() as {
        run: AgentRunResult;
      };
      expect(continuedResponse.status).toBe(202);
      const continued = await waitForCompletedRun(
        running.origin,
        continuedBody.run.id
      );
      expect(continued.sessionId).toBe(completed.sessionId);
      expect(continued.runtimeSessionId).toBe(completed.runtimeSessionId);
      expect(continued.output?.trim().toLowerCase()).toBe("session continued");

      const continuedAgainResponse = await fetch(
        `${running.origin}/api/projects/demo/agent/sessions/${completed.sessionId}/runs`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            memberId: memberBody.member.id,
            prompt: "Do not use tools. Reply with exactly: session continued twice"
          })
        }
      );
      const continuedAgainBody = await continuedAgainResponse.json() as {
        run: AgentRunResult;
      };
      expect(continuedAgainResponse.status).toBe(202);
      const continuedAgain = await waitForCompletedRun(
        running.origin,
        continuedAgainBody.run.id
      );
      expect(continuedAgain.sessionId).toBe(completed.sessionId);
      expect(continuedAgain.runtimeSessionId).toBe(completed.runtimeSessionId);
      expect(continuedAgain.output?.trim().toLowerCase()).toBe(
        "session continued twice"
      );
    } finally {
      await running.close();
    }
  }, 120_000);

  it("marks interrupted tasks as failed when their persisted state is read", async () => {
    const runId = "interrupted-run";
    const createdAt = "2026-09-18T00:00:00.000Z";
    const runDirectory = path.join(
      root,
      "data",
      "projects",
      "demo",
      "agent-runs",
      runId
    );
    await fsPromises.mkdir(runDirectory, { recursive: true });
    await fsPromises.writeFile(
      path.join(runDirectory, "run.json"),
      `${JSON.stringify({
        version: 1,
        run: {
          id: runId,
          projectId: "demo",
          memberId: "previous-member",
          prompt: "Previous task",
          status: "running",
          runtime: "opencode",
          provider: "deepseek",
          model,
          createdAt,
          startedAt: createdAt
        }
      }, null, 2)}\n`,
      "utf8"
    );
    const running = await startServer();

    try {
      const response = await fetch(
        `${running.origin}/api/projects/demo/agent/runs/${runId}`
      );
      const body = await response.json() as { run: AgentRunResult & { error?: string } };
      expect(body.run.status).toBe("failed");
      expect(body.run.error).toBe("Agent run was interrupted by a server restart");

      const traceResponse = await fetch(
        `${running.origin}/api/projects/demo/agent/runs/${runId}/trace`
      );
      const traceBody = await traceResponse.json() as {
        events: Array<{ type: string; summary?: string }>;
      };
      expect(traceBody.events.at(-1)).toMatchObject({
        type: "run_failed",
        summary: "Agent run was interrupted by a server restart"
      });
    } finally {
      await running.close();
    }
  });

  it("cancels a run that exceeds its configured duration", async () => {
    const running = await startServer(500);

    try {
      const memberId = await joinAgentTester(running.origin);
      const created = await createRun(
        running.origin,
        memberId,
        "Use the bash tool to run sleep 20, then reply with done."
      );
      const failed = await waitForRun(
        running.origin,
        created.id,
        (run) => run.status === "failed"
      );
      expect(failed).toMatchObject({
        status: "failed",
        error: "Agent run exceeded 500 ms"
      });
    } finally {
      await running.close();
    }
  }, 120_000);

  it("records file changes from an OpenCode coding task", async () => {
    const running = await startServer();

    try {
      const memberId = await joinAgentTester(running.origin);
      const created = await createRun(
        running.origin,
        memberId,
        "Use the file editing tools to create agent-created.txt in the project root. Its entire content must be exactly: agent file created"
      );
      const completed = await waitForCompletedRun(running.origin, created.id);
      expect(completed.fileChanges).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            file: "agent-created.txt",
            status: "added"
          })
        ])
      );
      await expect(
        fsPromises.readFile(
          path.join(root, "data", "projects", "demo", "workspace", "agent-created.txt"),
          "utf8"
        ).then((content) => content.trimEnd())
      ).resolves.toBe("agent file created");

      const traceResponse = await fetch(
        `${running.origin}/api/projects/demo/agent/runs/${created.id}/trace`
      );
      const traceBody = await traceResponse.json() as {
        events: Array<{ type: string; data?: Record<string, unknown> }>;
      };
      expect(traceBody.events).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: "file_changes",
            data: expect.objectContaining({
              files: expect.arrayContaining([
                expect.objectContaining({ file: "agent-created.txt" })
              ])
            })
          })
        ])
      );
    } finally {
      await running.close();
    }
  }, 120_000);

  it("stops an active Agent task before deleting its project directory", async () => {
    const running = await startServer();

    try {
      const projectResponse = await fetch(`${running.origin}/api/projects`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Delete Agent Project" })
      });
      const projectBody = await projectResponse.json() as {
        project: { id: string };
      };
      const projectId = projectBody.project.id;
      const memberResponse = await fetch(
        `${running.origin}/api/projects/${projectId}/members`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            name: "Delete Tester",
            userId: "delete-tester",
            connectionId: "delete-test-connection"
          })
        }
      );
      const memberBody = await memberResponse.json() as { member: { id: string } };
      const createResponse = await fetch(
        `${running.origin}/api/projects/${projectId}/agent/runs`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            memberId: memberBody.member.id,
            prompt: "Use the bash tool to run sleep 5, then reply with done."
          })
        }
      );
      const created = await createResponse.json() as { run: AgentRunResult };
      await waitForProjectRun(
        running.origin,
        projectId,
        created.run.id,
        (run) => run.status === "running" && Boolean(run.sessionId)
      );

      const deleteResponse = await fetch(
        `${running.origin}/api/projects/${projectId}`,
        { method: "DELETE" }
      );
      expect(deleteResponse.status).toBe(200);
      await new Promise((resolve) => setTimeout(resolve, 6_000));
      await expect(
        fsPromises.stat(path.join(root, "data", "projects", projectId))
      ).rejects.toThrow();
    } finally {
      await running.close();
    }
  }, 120_000);

  it("keeps one project run active and cancels queued and running tasks", async () => {
    const running = await startServer();

    try {
      const memberId = await joinAgentTester(running.origin);
      const first = await createRun(
        running.origin,
        memberId,
        "Use the bash tool to run sleep 20, then reply with done."
      );
      await waitForRun(
        running.origin,
        first.id,
        (run) => run.status === "running" && Boolean(run.sessionId)
      );

      const settingsResponse = await fetch(`${running.origin}/api/agent/settings`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          provider: "deepseek",
          model: `${model}-other`,
          enabled: true
        })
      });
      expect(settingsResponse.status).toBe(400);
      await expect(settingsResponse.json()).resolves.toMatchObject({
        error: "Agent settings cannot change while tasks are active"
      });

      const second = await createRun(
        running.origin,
        memberId,
        "Reply with exactly: second task"
      );
      expect(second.status).toBe("queued");

      const otherMemberResponse = await fetch(
        `${running.origin}/api/projects/demo/members`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            name: "Cancel Tester",
            userId: "cancel-tester",
            connectionId: "cancel-test-connection"
          })
        }
      );
      const otherMember = await otherMemberResponse.json() as {
        member: { id: string };
      };
      const foreignCancel = await fetch(
        `${running.origin}/api/projects/demo/agent/runs/${first.id}/cancel`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ memberId: otherMember.member.id })
        }
      );
      expect(foreignCancel.status).toBe(400);

      const cancelSecond = await fetch(
        `${running.origin}/api/projects/demo/agent/runs/${second.id}/cancel`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ memberId })
        }
      );
      expect(cancelSecond.status).toBe(200);
      await expect(cancelSecond.json()).resolves.toMatchObject({
        run: { id: second.id, status: "cancelled" }
      });

      const cancelFirst = await fetch(
        `${running.origin}/api/projects/demo/agent/runs/${first.id}/cancel`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ memberId })
        }
      );
      expect(cancelFirst.status).toBe(200);
      await expect(cancelFirst.json()).resolves.toMatchObject({
        run: { id: first.id, status: "cancelled" }
      });
      await waitForRun(
        running.origin,
        first.id,
        (run) => run.status === "cancelled"
      );
    } finally {
      await running.close();
    }
  }, 120_000);
});

interface AgentRunResult {
  id: string;
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  sessionId?: string;
  runtimeSessionId?: string;
  output?: string;
  error?: string;
  contexts?: Array<{ type: "file"; path: string }>;
  fileChanges?: Array<{
    file: string;
    patch?: string;
    additions: number;
    deletions: number;
    status?: "added" | "deleted" | "modified";
  }>;
}

async function waitForCompletedRun(origin: string, runId: string) {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    const response = await fetch(
      `${origin}/api/projects/demo/agent/runs/${runId}`
    );
    const body = await response.json() as { run: AgentRunResult };
    if (body.run.status === "completed") return body.run;
    if (body.run.status === "failed" || body.run.status === "cancelled") {
      throw new Error(
        `Agent run ended with ${body.run.status}: ${body.run.error ?? "no error message"}`
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("Agent run did not complete within 90 seconds");
}

async function waitForRun(
  origin: string,
  runId: string,
  predicate: (run: AgentRunResult) => boolean
) {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    const response = await fetch(
      `${origin}/api/projects/demo/agent/runs/${runId}`
    );
    const body = await response.json() as { run: AgentRunResult };
    if (predicate(body.run)) return body.run;
    if (body.run.status === "failed") {
      throw new Error("Agent run failed while waiting for state");
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Agent run did not reach the expected state within 90 seconds");
}

async function waitForProjectRun(
  origin: string,
  projectId: string,
  runId: string,
  predicate: (run: AgentRunResult) => boolean
) {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    const response = await fetch(
      `${origin}/api/projects/${projectId}/agent/runs/${runId}`
    );
    const body = await response.json() as { run: AgentRunResult };
    if (predicate(body.run)) return body.run;
    if (body.run.status === "failed") {
      throw new Error(`Agent run failed: ${body.run.error ?? "no error message"}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Agent run did not reach the expected state within 90 seconds");
}

async function joinAgentTester(origin: string) {
  const response = await fetch(`${origin}/api/projects/demo/members`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      name: "Queue Tester",
      userId: "queue-tester",
      connectionId: "queue-test-connection"
    })
  });
  const body = await response.json() as { member: { id: string } };
  return body.member.id;
}

async function createRun(origin: string, memberId: string, prompt: string) {
  const response = await fetch(`${origin}/api/projects/demo/agent/runs`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ memberId, prompt })
  });
  expect(response.status).toBe(202);
  const body = await response.json() as { run: AgentRunResult };
  return body.run;
}

async function startServer(runTimeoutMs?: number, agentApiKey = apiKey) {
  const app = await createApp({
    port: 4000,
    host: "127.0.0.1",
    publicOrigin: "http://127.0.0.1:5173",
    dataDir: path.join(root, "data"),
    demoProjectRoot: path.join(root, "demo", "workspace"),
    agent: {
      apiKey: agentApiKey,
      baseUrl: baseUrl!,
      model: model!,
      openCodePort: await getAvailablePort(),
      runTimeoutMs
    }
  });
  const server = http.createServer(app);
  const realtime = attachRealtimeServer(
    server,
    app.locals.runtimeManager,
    app.locals.agentRuns
  );
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Server did not expose a local port");
  }
  return {
    origin: `http://127.0.0.1:${address.port}`,
    async close() {
      realtime.dispose();
      for (const webSocketServer of [
        realtime.presence,
        realtime.documents,
        realtime.terminal
      ]) {
        for (const client of webSocketServer.clients) client.terminate();
        webSocketServer.close();
      }
      await app.locals.agentRuns?.dispose();
      await app.locals.agentRuntime.dispose();
      await app.locals.runtimeManager.dispose();
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
  };
}

async function waitForCondition(predicate: () => boolean) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("Realtime Agent events were not received");
}

async function getAvailablePort() {
  const server = http.createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Could not allocate an OpenCode port");
  }
  const port = address.port;
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
  return port;
}
