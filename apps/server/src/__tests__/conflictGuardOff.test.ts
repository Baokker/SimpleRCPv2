import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createApp } from "../createApp.js";
import { loadConfig } from "../config.js";
import { readTrace } from "@simplercp/conflict-guard";
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

  it("starts in observe mode with an unknown Git commit when Git is unavailable", async () => {
    const root = await createTestWorkspace("conflict-guard-git-unavailable-");
    const demoRoot = path.join(root, "demo", "workspace");
    await fs.mkdir(demoRoot, { recursive: true });
    const originalPath = process.env.PATH;
    process.env.PATH = path.join(root, "unavailable-git");
    let app: Awaited<ReturnType<typeof createApp>> | undefined;
    try {
      app = await createApp({
        port: 0,
        host: "127.0.0.1",
        publicOrigin: "http://127.0.0.1:5173",
        dataDir: path.join(root, "data"),
        demoProjectRoot: demoRoot,
        conflictGuard: { mode: "observe", idleMs: 50, cursorLeaveLines: 3, maxBatchDurationMs: 500, activeIdleMs: 5_000, cursorDebounceMs: 20 }
      });
      const guard = app.locals.runtimeManager.get("demo").conflictGuard!;
      await guard.waitForTrace();
      const sessionStart = readTrace(await fs.readFile(guard.tracePath, "utf8")).find((event) => event.type === "session_start");
      expect(sessionStart?.gitCommit).toBe("unknown");
    } finally {
      if (originalPath === undefined) delete process.env.PATH;
      else process.env.PATH = originalPath;
      await app?.locals.runtimeManager.dispose();
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
