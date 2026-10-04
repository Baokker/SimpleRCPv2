import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createApp } from "../createApp.js";
import { loadConfig } from "../config.js";
import { createTestWorkspace } from "./testWorkspace.js";
import { joinMember } from "./memberTestHelper.js";

describe("conflict guard off", () => {
  it("does not create trace state or require a new feature when disabled", async () => {
    const root = await createTestWorkspace("conflict-guard-off-");
    const demoRoot = path.join(root, "demo", "workspace");
    await fs.mkdir(demoRoot, { recursive: true });
    const config = loadConfig({ CONFLICT_GUARD: "off", SIMPLERCP_TERMINAL_ENABLED: "false", SIMPLERCP_DATA_DIR: path.join(root, "data") }, root);
    config.demoProjectRoot = demoRoot;
    const originalPath = process.env.PATH;
    process.env.PATH = path.join(root, "unavailable-git");
    let app: Awaited<ReturnType<typeof createApp>>;
    try {
      app = await createApp(config);
    } finally {
      if (originalPath === undefined) delete process.env.PATH;
      else process.env.PATH = originalPath;
    }
    const server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Server did not start");
    try {
      const response = await fetch(`http://127.0.0.1:${address.port}/api/projects/demo/conflict-guard/state`);
      expect(response.status).toBe(401);
      const origin = `http://127.0.0.1:${address.port}`;
      const member = await joinMember(origin, "demo", { name: "Off acceptance" });
      for (const [endpoint, method] of [["state", "GET"], ["trace", "GET"], ["done", "POST"]]) {
        const disabled = await fetch(`${origin}/api/projects/demo/conflict-guard/${endpoint}`, { method, headers: member.headers });
        expect(disabled.status).toBe(404);
      }
      expect(app.locals.runtimeManager.get("demo").conflictGuard).toBeUndefined();
      await app.locals.runtimeManager.dispose();
      await expect(fs.stat(path.join(root, "data", "projects", "demo", "conflict-guard", "trace.jsonl"))).rejects.toThrow();
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
