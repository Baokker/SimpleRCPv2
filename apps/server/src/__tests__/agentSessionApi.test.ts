import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../createApp.js";
import { createTestWorkspace } from "./testWorkspace.js";

let root: string;

beforeEach(async () => {
  root = await createTestWorkspace("agent-session-api-");
  const demoRoot = path.join(root, "demo", "workspace");
  await fs.mkdir(demoRoot, { recursive: true });
  await fs.writeFile(path.join(demoRoot, "README.md"), "# Session API test\n");
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe("Agent session API", () => {
  it("creates member sessions and keeps another member from opening them", async () => {
    const running = await startServer();
    try {
      const memberA = await join(running.origin, "Ada", "ada");
      const memberB = await join(running.origin, "Linus", "linus");
      const createResponse = await fetch(
        `${running.origin}/api/projects/demo/agent/sessions`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ memberId: memberA, title: "Fix login" })
        }
      );
      const created = await createResponse.json() as { session: { id: string } };

      expect(createResponse.status).toBe(201);
      await expect(
        fetch(`${running.origin}/api/projects/demo/agent/sessions?memberId=${memberA}`).then(
          (response) => response.json()
        )
      ).resolves.toMatchObject({
        sessions: [{ id: created.session.id, memberId: memberA, title: "Fix login" }]
      });
      await expect(
        fetch(`${running.origin}/api/projects/demo/agent/sessions?memberId=${memberB}`).then(
          (response) => response.json()
        )
      ).resolves.toEqual({ sessions: [] });

      const foreignResponse = await fetch(
        `${running.origin}/api/projects/demo/agent/sessions/${created.session.id}?memberId=${memberB}`
      );
      expect(foreignResponse.status).toBe(403);
    } finally {
      await running.close();
    }
  });

  it("restores participants, Agent sessions, and durable activity after restart", async () => {
    const firstServer = await startServer();
    let participantId = "";
    let sessionId = "";
    try {
      const joined = await joinParticipant(firstServer.origin, {
        name: "Ada",
        role: "Developer",
        connectionId: "ada-first-tab"
      });
      participantId = joined.participant.id;

      const createSessionResponse = await fetch(
        `${firstServer.origin}/api/projects/demo/agent/sessions`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            memberId: joined.member.id,
            title: "Persistent work"
          })
        }
      );
      const createdSession = await createSessionResponse.json() as {
        session: { id: string };
      };
      sessionId = createdSession.session.id;

      const createFileResponse = await fetch(
        `${firstServer.origin}/api/projects/demo/workspace/file`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            path: "src/persisted.ts",
            content: "export const persisted = true;\n",
            initiatorId: joined.member.id
          })
        }
      );
      expect(createSessionResponse.status).toBe(201);
      expect(createFileResponse.status).toBe(200);
    } finally {
      await firstServer.close();
    }

    const secondServer = await startServer();
    try {
      const participantsResponse = await fetch(
        `${secondServer.origin}/api/projects/demo/participants`
      );
      await expect(participantsResponse.json()).resolves.toMatchObject({
        participants: [
          {
            id: participantId,
            displayName: "Ada",
            profileRole: "Developer"
          }
        ]
      });

      const eventsResponse = await fetch(
        `${secondServer.origin}/api/projects/demo/events`
      );
      const eventsBody = await eventsResponse.json() as {
        events: Array<{ type: string; participantId?: string }>;
      };
      expect(eventsBody.events).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: "workspace_file_created",
            participantId
          })
        ])
      );
      expect(eventsBody.events.map((event) => event.type)).not.toContain(
        "member_joined"
      );
      expect(
        eventsBody.events.filter((event) => event.type === "room_created")
      ).toHaveLength(1);

      const joined = await joinParticipant(secondServer.origin, {
        participantId,
        name: "Ada",
        role: "Developer",
        connectionId: "ada-second-tab"
      });
      expect(joined.member.id).toBeTruthy();
      expect(joined.member.participantId).toBe(participantId);

      const sessionsResponse = await fetch(
        `${secondServer.origin}/api/projects/demo/agent/sessions?memberId=${joined.member.id}`
      );
      await expect(sessionsResponse.json()).resolves.toMatchObject({
        sessions: [
          {
            id: sessionId,
            participantId,
            title: "Persistent work"
          }
        ]
      });
    } finally {
      await secondServer.close();
    }
  });
});

async function join(origin: string, name: string, userId: string) {
  const response = await fetch(`${origin}/api/projects/demo/members`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name, userId, connectionId: `${userId}-connection` })
  });
  const body = await response.json() as { member: { id: string } };
  return body.member.id;
}

async function joinParticipant(
  origin: string,
  input: {
    participantId?: string;
    name: string;
    role?: string;
    connectionId: string;
  }
) {
  const response = await fetch(`${origin}/api/projects/demo/members`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input)
  });
  expect(response.status).toBe(200);
  return response.json() as Promise<{
    member: { id: string; participantId: string };
    participant: { id: string; displayName: string; profileRole?: string };
  }>;
}

async function startServer() {
  const app = await createApp({
    port: 4000,
    host: "127.0.0.1",
    publicOrigin: "http://127.0.0.1:5173",
    dataDir: path.join(root, "data"),
    demoProjectRoot: path.join(root, "demo", "workspace")
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
      await new Promise<void>((resolve, reject) =>
        server.close((error) => error ? reject(error) : resolve())
      );
    }
  };
}
