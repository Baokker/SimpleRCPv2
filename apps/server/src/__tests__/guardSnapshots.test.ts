import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createSnapshotStore } from "../guard/snapshots.js";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true }))); });

describe("guard snapshots", () => {
  it("restores creation targets while preserving unrelated member edits", async () => {
    const root = path.join(process.cwd(), ".test-work", `guard-new-path-${Date.now()}`);
    roots.push(root);
    const workspace = path.join(root, "workspace");
    await fs.mkdir(workspace, { recursive: true });
    await fs.writeFile(path.join(workspace, "README.md"), "before");
    const store = createSnapshotStore(path.join(root, "metadata"), workspace);
    const snapshot = await store.create({ memberId: "member", paths: ["new.txt"] });
    await fs.writeFile(path.join(workspace, "new.txt"), "created");
    await fs.writeFile(path.join(workspace, "README.md"), "another member's edit");
    await store.restore(snapshot.id);
    await expect(fs.stat(path.join(workspace, "new.txt"))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(fs.readFile(path.join(workspace, "README.md"), "utf8")).resolves.toBe("another member's edit");
  });
  it("restores file contents and keeps later files", async () => {
    const root = path.join(process.cwd(), ".test-work", `guard-snapshot-${Date.now()}-${Math.random().toString(16).slice(2)}`);
    const metadata = path.join(root, "metadata");
    const workspace = path.join(root, "workspace");
    roots.push(root);
    await fs.mkdir(workspace, { recursive: true });
    await fs.writeFile(path.join(workspace, "config.js"), "before\n");
    const store = createSnapshotStore(metadata, workspace);
    const manifest = await store.create({ memberId: "member", command: "rm config.js", paths: ["config.js"] });
    await fs.writeFile(path.join(workspace, "config.js"), "after\n");
    await fs.writeFile(path.join(workspace, "new.txt"), "new\n");
    await store.restore(manifest.id);
    await expect(fs.readFile(path.join(workspace, "config.js"), "utf8")).resolves.toBe("before\n");
    await expect(fs.readFile(path.join(workspace, "new.txt"), "utf8")).resolves.toBe("new\n");
    await expect(store.restore("../outside")).rejects.toThrow("Invalid snapshot id");
  });

  it("captures only command paths when a scoped snapshot is requested", async () => {
    const root = path.join(process.cwd(), ".test-work", `guard-snapshot-scope-${Date.now()}-${Math.random().toString(16).slice(2)}`);
    const metadata = path.join(root, "metadata");
    const workspace = path.join(root, "workspace");
    roots.push(root);
    await fs.mkdir(path.join(workspace, "src"), { recursive: true });
    await fs.writeFile(path.join(workspace, "src", "a.ts"), "a\n");
    await fs.writeFile(path.join(workspace, "README.md"), "readme\n");
    const store = createSnapshotStore(metadata, workspace);
    const manifest = await store.create({ memberId: "member", command: "rm src/a.ts", paths: ["src/a.ts"] });
    expect(manifest.files.map((file) => file.path)).toEqual(["src/a.ts"]);
    expect(manifest.scope).toBe("paths");
  });
});
