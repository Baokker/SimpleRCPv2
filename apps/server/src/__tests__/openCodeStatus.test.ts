import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../createApp.js";
import { createTestWorkspace } from "./testWorkspace.js";

let root: string;

beforeEach(async () => {
  root = await createTestWorkspace("opencode-status-");
  await fs.mkdir(path.join(root, "demo", "workspace"), { recursive: true });
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe("OpenCode status", () => {
  it("starts the installed command on a loopback port and reports its version", async () => {
    const openCodePort = await getAvailablePort();
    const app = await createApp({
      port: 4000,
      host: "127.0.0.1",
      publicOrigin: "http://127.0.0.1:5173",
      dataDir: path.join(root, "data"),
      demoProjectRoot: path.join(root, "demo", "workspace"),
      agent: {
        baseUrl: "https://api.deepseek.com/v1",
        model: "deepseek-chat",
        openCodePort
      }
    });
    const server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("Server did not expose a local port");
    }

    try {
      const response = await fetch(
        `http://127.0.0.1:${address.port}/api/agent/status`
      );

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({
        runtime: "opencode",
        state: "ready",
        version: "1.18.31",
        model: "deepseek-chat",
        apiKeyConfigured: false
      });
    } finally {
      await app.locals.agentRuntime?.dispose();
      await app.locals.runtimeManager.dispose();
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
  }, 30_000);
});

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
