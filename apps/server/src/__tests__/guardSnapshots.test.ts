import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createSnapshotStore } from "../guard/snapshots.js";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true }))); });

describe("guard snapshots", () => {
  it("restores file contents and keeps later files", async () => {
    const root = path.join(process.cwd(), ".test-work", `guard-snapshot-${Date.now()}-${Math.random().toString(16).slice(2)}`);
    const metadata = path.join(root, "metadata");
    const workspace = path.join(root, "workspace");
    roots.push(root);
    await fs.mkdir(workspace, { recursive: true });
    await fs.writeFile(path.join(workspace, "config.js"), "before\n");
    const store = createSnapshotStore(metadata, workspace);
    const manifest = await store.create({ memberId: "member", command: "rm config.js" });
    await fs.writeFile(path.join(workspace, "config.js"), "after\n");
    await fs.writeFile(path.join(workspace, "new.txt"), "new\n");
    await store.restore(manifest.id);
    await expect(fs.readFile(path.join(workspace, "config.js"), "utf8")).resolves.toBe("before\n");
    await expect(fs.readFile(path.join(workspace, "new.txt"), "utf8")).resolves.toBe("new\n");
    await expect(store.restore("../outside")).rejects.toThrow("Invalid snapshot id");
  });
});
