import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createApp } from "../createApp.js";
import { createTestWorkspace } from "./testWorkspace.js";

describe("conflict guard off", () => {
  it("does not create trace state or require a new feature when disabled", async () => {
    const root = await createTestWorkspace("conflict-guard-off-");
    const demoRoot = path.join(root, "demo", "workspace");
    await fs.mkdir(demoRoot, { recursive: true });
    const app = await createApp({
      port: 0,
      host: "127.0.0.1",
      publicOrigin: "http://127.0.0.1:5173",
      dataDir: path.join(root, "data"),
      demoProjectRoot: demoRoot
    });
    const server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Server did not start");
    try {
      const response = await fetch(`http://127.0.0.1:${address.port}/api/projects/demo/conflict-guard/state`);
      expect(response.status).toBe(401);
      expect(app.locals.runtimeManager.get("demo").conflictGuard).toBeUndefined();
      await app.locals.runtimeManager.dispose();
      await expect(fs.stat(path.join(root, "data", "projects", "demo", "conflict-guard", "trace.jsonl"))).rejects.toThrow();
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
