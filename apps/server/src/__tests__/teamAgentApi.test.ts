import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../createApp.js";
import { createTestWorkspace } from "./testWorkspace.js";
import { memberHeaders } from "./memberTestHelper.js";

let root: string;

beforeEach(async () => {
  root = await createTestWorkspace("team-agent-api-");
  await fs.mkdir(path.join(root, "demo"), { recursive: true });
  await fs.writeFile(path.join(root, "demo", "README.md"), "# Demo\n");
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe("team Agent API", () => {
  it("creates the default and additional team Agents with unique handles", async () => {
    const running = await startServer();
    try {
      const member = await join(running.origin, "Alice");
      const agents = await fetch(`${running.origin}/api/projects/demo/team-agents`, { headers: memberHeaders(member) }).then((response) => response.json()) as { agents: Array<{ handle?: string }> };
      expect(agents.agents.map((agent) => agent.handle)).toEqual(["agent"]);
      const created = await fetch(`${running.origin}/api/projects/demo/team-agents`, {
        method: "POST",
        headers: { ...memberHeaders(member), "content-type": "application/json" },
        body: JSON.stringify({ name: "Code Reviewer", description: "Reviews changes" })
      });
      expect(created.status).toBe(201);
      await expect(created.json()).resolves.toMatchObject({ agent: { handle: "code-reviewer", scope: "team", memberId: "" } });
      const duplicate = await fetch(`${running.origin}/api/projects/demo/team-agents`, {
        method: "POST",
        headers: { ...memberHeaders(member), "content-type": "application/json" },
        body: JSON.stringify({ name: "code-reviewer" })
      });
      expect(duplicate.status).toBe(409);
    } finally {
      await running.close();
    }
  });

  it("persists mentions and reports an unavailable Agent in system chat", async () => {
    const running = await startServer();
    try {
      const member = await join(running.origin, "Alice");
      const response = await fetch(`${running.origin}/api/projects/demo/chat`, {
        method: "POST",
        headers: { ...memberHeaders(member), "content-type": "application/json" },
        body: JSON.stringify({ text: "@agent please inspect README" })
      });
      expect(response.status).toBe(200);
      const messages = await fetch(`${running.origin}/api/projects/demo/chat`, { headers: memberHeaders(member) }).then((result) => result.json()) as { messages: Array<{ mentions?: string[]; kind?: string }> };
      expect(messages.messages).toEqual(expect.arrayContaining([
        expect.objectContaining({ mentions: ["agent"] }),
        expect.objectContaining({ kind: "system" })
      ]));
      const events = await fetch(`${running.origin}/api/projects/demo/events`, { headers: memberHeaders(member) }).then((result) => result.json()) as { events: Array<{ type: string; payload?: Record<string, unknown> }> };
      expect(events.events).toEqual(expect.arrayContaining([
        expect.objectContaining({
          type: "agent_task_failed",
          payload: expect.objectContaining({ error: expect.any(String) })
        })
      ]));
    } finally {
      await running.close();
    }
  });

  it("keeps team Agent sessions non-historical after a restart", async () => {
    const first = await startServer();
    let memberId = "";
    try {
      memberId = await join(first.origin, "Alice");
      const created = await fetch(`${first.origin}/api/projects/demo/team-agents`, {
        method: "POST",
        headers: { ...memberHeaders(memberId), "content-type": "application/json" },
        body: JSON.stringify({ name: "Reviewer" })
      }).then((response) => response.json()) as { agent: { handle: string } };
      expect(created.agent.handle).toBe("reviewer");
    } finally {
      await first.close();
    }

    const second = await startServer();
    try {
      const agents = await fetch(`${second.origin}/api/projects/demo/team-agents`, { headers: memberHeaders(memberId) }).then((response) => response.json()) as { agents: Array<{ handle?: string; historical?: boolean }> };
      const reviewer = agents.agents.find((agent) => agent.handle === "reviewer");
      expect(reviewer).toBeDefined();
      expect(reviewer?.historical).toBeUndefined();
    } finally {
      await second.close();
    }
  });
});

async function startServer() {
  const app = await createApp({
    port: 0,
    host: "127.0.0.1",
    publicOrigin: "http://127.0.0.1:5173",
    dataDir: path.join(root, "data"),
    demoProjectRoot: path.join(root, "demo"),
    terminalEnabled: false
  });
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Server address missing");
  return {
    origin: `http://127.0.0.1:${address.port}`,
    async close() {
      await app.locals.agentRuns.dispose();
      await app.locals.agentRuntime.dispose();
      await app.locals.runtimeManager.dispose();
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  };
}

async function join(origin: string, name: string) {
  const response = await fetch(`${origin}/api/projects/demo/members`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name, connectionId: `${name}-connection` })
  });
  const body = await response.json() as { member: { id: string } };
  if (!response.ok) throw new Error(JSON.stringify(body));
  return body.member.id;
}
