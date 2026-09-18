import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createChatStore } from "../chat.js";
import { createApp } from "../createApp.js";
import { createEventLog } from "../eventLog.js";
import { createTestWorkspace } from "./testWorkspace.js";

let root: string;

beforeEach(async () => {
  root = await createTestWorkspace("chat-");
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe("chat", () => {
  it("stores human messages and records readable event data", async () => {
    const events = createEventLog();
    const chat = createChatStore(events);

    const message = await chat.createMessage({
      roomId: "room-1",
      authorId: "user-bob",
      authorName: "Bob",
      text: "Can you review pom.xml?"
    });

    await expect(chat.listMessages("room-1")).resolves.toEqual([message]);
    expect(events.list().at(-1)).toMatchObject({
      type: "chat_message_created",
      memberId: "user-bob",
      payload: {
        authorName: "Bob",
        text: "Can you review pom.xml?"
      }
    });
  });

  it("treats @ names as ordinary human chat text", async () => {
    const app = await createApp({
      port: 0,
      host: "127.0.0.1",
      publicOrigin: "http://127.0.0.1:5173",
      dataDir: `${root}-data`,
      demoProjectRoot: root
    });
    app.locals.runtimeManager.get("demo");
    const server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("Server did not expose a local port");
    }

    try {
      const response = await fetch(
        `http://127.0.0.1:${address.port}/api/projects/demo/chat`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            authorId: "user-bob",
            authorName: "Bob",
            text: "@Ada please review pom.xml"
          })
        }
      );
      const body = (await response.json()) as {
        message: { text: string };
      };

      expect(response.status).toBe(200);
      expect(body.message.text).toBe("@Ada please review pom.xml");
      expect(Object.keys(body)).toEqual(["message"]);
    } finally {
      await app.locals.runtimeManager.dispose();
      await fs.rm(`${root}-data`, { recursive: true, force: true });
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });

  it("restores project chat history after the service restarts", async () => {
    const dataDir = path.join(root, "data");
    const first = await startTestServer(dataDir);

    try {
      const response = await fetch(`${first.origin}/api/projects/demo/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          authorId: "user-ada",
          authorName: "Ada",
          text: "Keep this message after restart"
        })
      });
      expect(response.status).toBe(200);
    } finally {
      await first.close();
    }

    const restarted = await startTestServer(dataDir);
    try {
      const response = await fetch(
        `${restarted.origin}/api/projects/demo/chat`
      );
      const body = (await response.json()) as {
        messages: Array<{ sequence: number; text: string }>;
      };

      expect(response.status).toBe(200);
      expect(body.messages).toMatchObject([
        { sequence: 1, text: "Keep this message after restart" }
      ]);
    } finally {
      await restarted.close();
    }
  });
});

async function startTestServer(dataDir: string) {
  const demoProjectRoot = path.join(root, "demo-workspace");
  await fs.mkdir(demoProjectRoot, { recursive: true });
  await fs.writeFile(path.join(demoProjectRoot, "README.md"), "# Demo\n");
  const app = await createApp({
    port: 0,
    host: "127.0.0.1",
    publicOrigin: "http://127.0.0.1:5173",
    dataDir,
    demoProjectRoot
  });
  app.locals.runtimeManager.get("demo");
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Server did not expose a local port");
  }

  return {
    origin: `http://127.0.0.1:${address.port}`,
    async close() {
      await app.locals.runtimeManager.dispose();
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
  };
}
