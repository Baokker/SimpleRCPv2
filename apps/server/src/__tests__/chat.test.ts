import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createChatStore } from "../chat.js";
import { createApp } from "../createApp.js";
import { createEventLog } from "../eventLog.js";

let root: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "simplercp-chat-"));
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe("chat", () => {
  it("stores human messages and records readable event data", () => {
    const events = createEventLog();
    const chat = createChatStore(events);

    const message = chat.createMessage({
      roomId: "room-1",
      authorId: "user-bob",
      authorName: "Bob",
      text: "Can you review pom.xml?"
    });

    expect(chat.listMessages("room-1")).toEqual([message]);
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
    const app = createApp({
      port: 0,
      workspaceRoot: root,
      commandWhitelist: ["npm test"],
      commandMode: "restricted"
    });
    const roomId = app.locals.defaultRoom.id as string;
    const server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("Server did not expose a local port");
    }

    try {
      const response = await fetch(
        `http://127.0.0.1:${address.port}/api/rooms/${roomId}/chat`,
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
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });
});
