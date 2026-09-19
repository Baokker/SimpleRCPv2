import fs from "node:fs";
import fsPromises from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "dotenv";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createOpenCodeRuntime } from "../agent/openCodeRuntime.js";
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
  root = await createTestWorkspace("opencode-runtime-");
  await fsPromises.writeFile(path.join(root, "README.md"), "# Agent test\n");
});

afterEach(async () => {
  await fsPromises.rm(root, { recursive: true, force: true });
});

describe.skipIf(!configured)("OpenCode runtime with DeepSeek", () => {
  it("rejects Provider errors instead of completing with an empty response", async () => {
    const runtime = createOpenCodeRuntime({
      port: await getAvailablePort(),
      apiKey: "invalid-simplercp-integration-key",
      baseUrl: baseUrl!,
      getSettings: () => ({
        provider: "deepseek",
        model: model!,
        enabled: true,
        apiKeyConfigured: true
      })
    });

    try {
      const session = await runtime.createSession({
        workspacePath: root,
        title: "SimpleRCP Provider error test"
      });

      await expect(runtime.run({
        workspacePath: root,
        sessionId: session.id,
        prompt: "Reply with exactly: this request should fail"
      })).rejects.toThrow("OpenCode Provider request failed");
    } finally {
      await runtime.dispose();
    }
  }, 120_000);

  it("creates a session and completes a prompt through OpenCode", async () => {
    const runtime = createOpenCodeRuntime({
      port: await getAvailablePort(),
      apiKey,
      baseUrl: baseUrl!,
      getSettings: () => ({
        provider: "deepseek",
        model: model!,
        enabled: true,
        apiKeyConfigured: true
      })
    });

    try {
      const session = await runtime.createSession({
        workspacePath: root,
        title: "SimpleRCP connectivity test"
      });
      const result = await runtime.run({
        workspacePath: root,
        sessionId: session.id,
        prompt: "Do not use tools. Reply with exactly: connected through opencode"
      });

      expect(result.text.trim().toLowerCase()).toBe("connected through opencode");
    } finally {
      await runtime.dispose();
    }
  }, 120_000);
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
