import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createTestWorkspace } from "./testWorkspace.js";
import { watchWorkspace } from "../workspaceWatcher.js";

describe("workspace watcher lifecycle", () => {
  it("waits for an active filesystem callback before close completes", async () => {
    const root = await createTestWorkspace("watcher-lifecycle-");
    let started!: () => void;
    let release!: () => void;
    const callbackStarted = new Promise<void>((resolve) => { started = resolve; });
    const callbackReleased = new Promise<void>((resolve) => { release = resolve; });
    let callbackCompleted = false;
    const watcher = watchWorkspace(root, async () => {
      started();
      await callbackReleased;
      callbackCompleted = true;
    });
    try {
      await watcher.ready;
      await fs.writeFile(path.join(root, "README.md"), "# Rules\n");
      await callbackStarted;
      let closed = false;
      const closing = watcher.close().then(() => { closed = true; });
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(closed).toBe(false);
      release();
      await closing;
      expect(callbackCompleted).toBe(true);
      expect(closed).toBe(true);
    } finally {
      release();
      await watcher.close();
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
