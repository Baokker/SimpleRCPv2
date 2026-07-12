import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createChatStore, parseMentions } from "../chat.js";
import { createApp } from "../createApp.js";
import { createEventLog } from "../eventLog.js";
import type { ServerConfig } from "../config.js";

let root: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "simplercp-chat-"));
  await fs.mkdir(path.join(root, "src"), { recursive: true });
  await fs.writeFile(
    path.join(root, "src", "hello.ts"),
    "export const hello = 'world';\n"
  );
  await fs.writeFile(
    path.join(root, "package.json"),
    JSON.stringify({
      scripts: {
        test: "node -e \"console.log('chat-agent-ok')\""
      }
    })
  );
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe("chat store", () => {
  it("creates and lists chat messages", () => {
    const events = createEventLog();
    const chat = createChatStore(events);

    const message = chat.createMessage({
      roomId: "room-1",
      authorId: "user-bob",
      authorName: "bob",
      authorKind: "human",
      text: "hello @MockAgent"
    });

    expect(message.mentions).toEqual(["MockAgent"]);
    expect(chat.listMessages("room-1")).toEqual([message]);
    expect(events.list().map((event) => event.type)).toContain(
      "chat_message_created"
    );
  });

  it("parses mentions from message text", () => {
    expect(parseMentions("@MockAgent please ask @DeepSeek")).toEqual([
      "MockAgent",
      "DeepSeek"
    ]);
  });

  it("turns a MockAgent mention into visible chat and agent run state", async () => {
    const config: ServerConfig = {
      port: 0,
      workspaceRoot: root,
      commandWhitelist: ["npm test"],
      commandMode: "restricted",
      agent: {
        provider: "mock",
        baseUrl: "https://api.deepseek.com",
        model: "deepseek-v4-flash",
        name: "MockAgent",
        mentionAliases: ["MockAgent"],
        editablePaths: ["src/**"]
      }
    };
    const app = createApp(config);
    const roomId = app.locals.defaultRoom.id as string;
    const server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("Server did not expose a local port");
    }
    const baseUrl = `http://127.0.0.1:${address.port}`;

    try {
      const response = await fetch(`${baseUrl}/api/rooms/${roomId}/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          authorId: "user-bob",
          authorName: "bob",
          authorKind: "human",
          text: "@MockAgent please make the sample pass"
        })
      });

      expect(response.status).toBe(200);
      const chatResponse = (await response.json()) as {
        agentRun?: { status: string };
      };
      expect(chatResponse.agentRun).toMatchObject({ status: "completed" });
      const messagesResponse = (await fetch(
        `${baseUrl}/api/rooms/${roomId}/chat`
      ).then((result) => result.json())) as {
        messages: Array<{ authorName: string; text: string }>;
      };
      expect(messagesResponse.messages.map((message) => message.authorName)).toEqual([
        "bob",
        "MockAgent",
        "MockAgent"
      ]);
      expect(messagesResponse.messages.at(-1)?.text).toContain("ran npm test");
      const runsResponse = (await fetch(
        `${baseUrl}/api/rooms/${roomId}/agent-runs`
      ).then((result) => result.json())) as {
        runs: Array<{ status: string; lastAction?: string }>;
      };
      expect(runsResponse.runs[0]).toMatchObject({
        status: "completed",
        lastAction: "MockAgent finished"
      });
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });

  it("turns a configured agent mention into visible chat and agent run state", async () => {
    const config: ServerConfig = {
      port: 0,
      workspaceRoot: root,
      commandWhitelist: ["npm test"],
      commandMode: "restricted",
      agent: {
        provider: "openai-compatible",
        baseUrl: "https://api.deepseek.com",
        apiKey: "test-key",
        model: "deepseek-v4-flash",
        name: "DeepSeek",
        mentionAliases: ["DeepSeek"],
        editablePaths: ["src/**"]
      }
    };
    const fakeFetch = async () =>
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  actions: [
                    { type: "message", text: "I will make a small change." },
                    {
                      type: "edit_file",
                      path: "src/hello.ts",
                      content: "export const hello = 'deepseek';\n"
                    },
                    { type: "run_command", command: "npm test" },
                    {
                      type: "final_report",
                      summary: "DeepSeek updated the sample and ran tests.",
                      commands: ["npm test"],
                      risks: []
                    }
                  ]
                })
              }
            }
          ]
        }),
        { status: 200 }
      );
    const app = createApp(config, { agentFetch: fakeFetch });
    const roomId = app.locals.defaultRoom.id as string;
    const server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("Server did not expose a local port");
    }
    const baseUrl = `http://127.0.0.1:${address.port}`;

    try {
      const response = await fetch(`${baseUrl}/api/rooms/${roomId}/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          authorId: "user-bob",
          authorName: "bob",
          authorKind: "human",
          text: "@DeepSeek please update the sample"
        })
      });

      expect(response.status).toBe(200);
      const chatResponse = (await response.json()) as {
        agentRun?: { status: string; summary?: string };
      };
      expect(chatResponse.agentRun).toMatchObject({
        status: "completed",
        summary: "DeepSeek updated the sample and ran tests."
      });
      const messagesResponse = (await fetch(
        `${baseUrl}/api/rooms/${roomId}/chat`
      ).then((result) => result.json())) as {
        messages: Array<{ authorName: string; text: string }>;
      };
      expect(messagesResponse.messages.map((message) => message.authorName)).toEqual([
        "bob",
        "DeepSeek",
        "DeepSeek"
      ]);
      expect(messagesResponse.messages.at(-1)?.text).toContain(
        "DeepSeek updated the sample"
      );
      const runsResponse = (await fetch(
        `${baseUrl}/api/rooms/${roomId}/agent-runs`
      ).then((result) => result.json())) as {
        runs: Array<{ status: string; lastAction?: string; summary?: string }>;
      };
      expect(runsResponse.runs[0]).toMatchObject({
        status: "completed",
        lastAction: "DeepSeek finished"
      });
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });

  it("marks configured agent mention as blocked when the API key is missing", async () => {
    const config: ServerConfig = {
      port: 0,
      workspaceRoot: root,
      commandWhitelist: ["npm test"],
      commandMode: "restricted",
      agent: {
        provider: "openai-compatible",
        baseUrl: "https://api.deepseek.com",
        model: "deepseek-v4-flash",
        name: "DeepSeek",
        mentionAliases: ["DeepSeek"],
        editablePaths: ["src/**"]
      }
    };
    const app = createApp(config);
    const roomId = app.locals.defaultRoom.id as string;
    const server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("Server did not expose a local port");
    }
    const baseUrl = `http://127.0.0.1:${address.port}`;

    try {
      const response = await fetch(`${baseUrl}/api/rooms/${roomId}/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          authorId: "user-bob",
          authorName: "bob",
          authorKind: "human",
          text: "@DeepSeek can you help?"
        })
      });

      expect(response.status).toBe(200);
      const chatResponse = (await response.json()) as {
        agentRun?: { status: string; error?: string };
      };
      expect(chatResponse.agentRun).toMatchObject({
        status: "blocked",
        error: "Agent API key is not configured"
      });
      const messagesResponse = (await fetch(
        `${baseUrl}/api/rooms/${roomId}/chat`
      ).then((result) => result.json())) as {
        messages: Array<{ authorName: string; text: string }>;
      };
      expect(messagesResponse.messages.at(-1)).toMatchObject({
        authorName: "DeepSeek",
        text: "I cannot start yet because the server is missing an API key."
      });
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });
});
