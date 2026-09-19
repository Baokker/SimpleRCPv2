import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../createApp.js";
import { createTestWorkspace } from "./testWorkspace.js";

let root: string;

beforeEach(async () => {
  root = await createTestWorkspace("agent-settings-api-");
  await fs.mkdir(path.join(root, "demo", "workspace"), { recursive: true });
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe("agent settings API", () => {
  it("returns the default DeepSeek settings without exposing a key", async () => {
    const running = await startServer();

    try {
      const response = await fetch(`${running.origin}/api/agent/settings`);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toEqual({
        provider: "deepseek",
        model: "deepseek-chat",
        enabled: true,
        apiKeyConfigured: false
      });
      expect(body).not.toHaveProperty("apiKey");
    } finally {
      await running.close();
    }
  });

  it("updates non-sensitive settings and restores them after restart", async () => {
    const first = await startServer();

    try {
      const response = await fetch(`${first.origin}/api/agent/settings`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          provider: "deepseek",
          model: "DeepSeek-V4-Flash",
          enabled: false
        })
      });

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({
        provider: "deepseek",
        model: "DeepSeek-V4-Flash",
        enabled: false,
        apiKeyConfigured: false
      });
    } finally {
      await first.close();
    }

    const restarted = await startServer();
    try {
      const response = await fetch(`${restarted.origin}/api/agent/settings`);
      await expect(response.json()).resolves.toEqual({
        provider: "deepseek",
        model: "DeepSeek-V4-Flash",
        enabled: false,
        apiKeyConfigured: false
      });
    } finally {
      await restarted.close();
    }
  });
});

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
