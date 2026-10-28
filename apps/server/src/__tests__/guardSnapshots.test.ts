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
    await store.seal(snapshot.id);
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
    await store.seal(manifest.id);
    await fs.writeFile(path.join(workspace, "new.txt"), "new\n");
    await expect(store.restore(manifest.id)).resolves.toMatchObject({ restored: true, conflicts: [] });
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
  it("refuses to overwrite files edited after the command and keeps the later edit", async () => {
    const root = path.join(process.cwd(), ".test-work", `guard-snapshot-conflict-${Date.now()}-${Math.random().toString(16).slice(2)}`);
    const workspace = path.join(root, "workspace");
    roots.push(root);
    await fs.mkdir(workspace, { recursive: true });
    await fs.writeFile(path.join(workspace, "config.ts"), "a = 1\nb = 2\n");
    const store = createSnapshotStore(path.join(root, "metadata"), workspace);
    const manifest = await store.create({ memberId: "alice", command: "sed -i s/1/10/ config.ts", paths: ["config.ts"] });
    await fs.writeFile(path.join(workspace, "config.ts"), "a = 10\nb = 2\n");
    await store.seal(manifest.id);
    await fs.writeFile(path.join(workspace, "config.ts"), "a = 10\nb = 20\n");
    await expect(store.restore(manifest.id)).resolves.toMatchObject({ restored: false, conflicts: [{ path: "config.ts", reason: "changed-after-command" }] });
    await expect(fs.readFile(path.join(workspace, "config.ts"), "utf8")).resolves.toBe("a = 10\nb = 20\n");
  });

  it("treats a renamed file as a conflict instead of recreating it", async () => {
    const root = path.join(process.cwd(), ".test-work", `guard-snapshot-rename-${Date.now()}-${Math.random().toString(16).slice(2)}`);
    const workspace = path.join(root, "workspace");
    roots.push(root);
    await fs.mkdir(workspace, { recursive: true });
    await fs.writeFile(path.join(workspace, "a.ts"), "x\n");
    const store = createSnapshotStore(path.join(root, "metadata"), workspace);
    const manifest = await store.create({ memberId: "alice", paths: ["a.ts"] });
    await fs.writeFile(path.join(workspace, "a.ts"), "y\n");
    await store.seal(manifest.id);
    await fs.rename(path.join(workspace, "a.ts"), path.join(workspace, "b.ts"));
    await expect(store.restore(manifest.id)).resolves.toMatchObject({ restored: false });
    await expect(fs.stat(path.join(workspace, "a.ts"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("refuses to restore an unsealed snapshot unless forced, and backs up before a forced restore", async () => {
    const root = path.join(process.cwd(), ".test-work", `guard-snapshot-force-${Date.now()}-${Math.random().toString(16).slice(2)}`);
    const workspace = path.join(root, "workspace");
    roots.push(root);
    await fs.mkdir(workspace, { recursive: true });
    await fs.writeFile(path.join(workspace, "a.ts"), "before\n");
    const store = createSnapshotStore(path.join(root, "metadata"), workspace);
    const manifest = await store.create({ memberId: "alice", paths: ["a.ts"] });
    await fs.writeFile(path.join(workspace, "a.ts"), "later\n");
    await expect(store.restore(manifest.id)).resolves.toMatchObject({ restored: false, conflicts: [{ path: "a.ts", reason: "not-sealed" }] });
    const forced = await store.restore(manifest.id, { memberId: "owner", force: true });
    expect(forced.restored).toBe(true);
    await expect(fs.readFile(path.join(workspace, "a.ts"), "utf8")).resolves.toBe("before\n");
    await store.seal(forced.backupId!);
    await expect(store.restore(forced.backupId!)).resolves.toMatchObject({ restored: true });
    await expect(fs.readFile(path.join(workspace, "a.ts"), "utf8")).resolves.toBe("later\n");
  });
});
