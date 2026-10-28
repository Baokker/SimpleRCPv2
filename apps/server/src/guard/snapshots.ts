import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { isIgnoredPath } from "../workspacePolicy.js";

interface SnapshotManifest {
  id: string;
  createdAt: string;
  memberId: string;
  command?: string;
  scope: "paths" | "workspace";
  files: Array<{ path: string; hash: string; size: number }>;
  // Hashes taken when the snapshotted command finished. Restore only overwrites files that still match them.
  sealed?: { at: string; files: Array<{ path: string; hash: string }> };
}

export interface RestoreConflict { path: string; reason: "changed-after-command" | "not-sealed" }
export interface RestoreResult { manifest: SnapshotManifest; restored: boolean; conflicts: RestoreConflict[]; backupId?: string }

async function fileHash(file: string) {
  const bytes = await fs.readFile(file).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT" || error.code === "EISDIR") return undefined;
    throw error;
  });
  return bytes ? crypto.createHash("sha256").update(bytes).digest("hex") : "";
}

async function collectFiles(root: string, relative = "") {
  const directory = path.join(root, relative);
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const next = relative ? path.posix.join(relative, entry.name) : entry.name;
    if (isIgnoredPath(next)) continue;
    if (entry.isDirectory()) files.push(...await collectFiles(root, next));
    else if (entry.isFile()) files.push(next);
  }
  return files;
}

export function createSnapshotStore(root: string, workspaceRoot: string) {
  const snapshotsRoot = path.join(root, "snapshots");
  function snapshotDirectory(id: string) {
    if (!/^[0-9]+-[a-f0-9]{8}$/.test(id)) throw new Error("Invalid snapshot id");
    return path.join(snapshotsRoot, id);
  }
  const store = {
    async create(input: { memberId: string; command?: string; paths?: string[] }) {
      const id = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
      const directory = snapshotDirectory(id);
      const selections = input.paths?.length ? input.paths : undefined;
      const selected = selections
        ? await collectSelectedFiles(workspaceRoot, selections)
        : { files: await collectFiles(workspaceRoot), missing: [] };
      const files = selected.files;
      const manifest: SnapshotManifest = { id, createdAt: new Date().toISOString(), memberId: input.memberId, command: input.command, scope: selections ? "paths" : "workspace", files: [] };
      for (const relative of files) {
        const bytes = await fs.readFile(path.join(workspaceRoot, relative));
        const hash = crypto.createHash("sha256").update(bytes).digest("hex");
        const destination = path.join(directory, relative);
        await fs.mkdir(path.dirname(destination), { recursive: true });
        await fs.writeFile(destination, bytes);
        manifest.files.push({ path: relative, hash, size: bytes.byteLength });
      }
      for (const relative of selected.missing) manifest.files.push({ path: relative, hash: "", size: 0 });
      await fs.mkdir(directory, { recursive: true });
      await fs.writeFile(path.join(directory, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
      const existing = (await fs.readdir(snapshotsRoot).catch((error: NodeJS.ErrnoException) => error.code === "ENOENT" ? [] : (() => { throw error; })()))
        .filter((entry) => entry !== id)
        .sort();
      for (const old of existing.slice(0, Math.max(0, existing.length - 19))) {
        await fs.rm(path.join(snapshotsRoot, old), { recursive: true, force: true });
      }
      return manifest;
    },
    async seal(id: string) {
      const manifestPath = path.join(snapshotDirectory(id), "manifest.json");
      const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8")) as SnapshotManifest;
      if (manifest.sealed) return manifest;
      const files = [];
      for (const file of manifest.files) files.push({ path: file.path, hash: await fileHash(path.join(workspaceRoot, file.path)) });
      manifest.sealed = { at: new Date().toISOString(), files };
      await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
      return manifest;
    },
    // Restores only when no snapshotted file changed after the command finished. Otherwise nothing is
    // written and the conflicting files are returned for a person to resolve; `force` overrides this.
    // Every restore first snapshots the files it is about to overwrite, so the restore can be undone.
    async restore(id: string, options: { memberId?: string; force?: boolean } = {}): Promise<RestoreResult> {
      const directory = snapshotDirectory(id);
      const manifest = JSON.parse(await fs.readFile(path.join(directory, "manifest.json"), "utf8")) as SnapshotManifest;
      const sealed = new Map(manifest.sealed?.files.map((file) => [file.path, file.hash]));
      const pending: Array<{ path: string; bytes?: Buffer }> = [];
      const conflicts: RestoreConflict[] = [];
      for (const file of manifest.files) {
        const current = await fileHash(path.join(workspaceRoot, file.path));
        if (current === file.hash) continue;
        if (!manifest.sealed) conflicts.push({ path: file.path, reason: "not-sealed" });
        else if (current !== sealed.get(file.path)) conflicts.push({ path: file.path, reason: "changed-after-command" });
        pending.push({ path: file.path, bytes: file.hash ? await fs.readFile(path.join(directory, file.path)) : undefined });
      }
      if (conflicts.length && !options.force) return { manifest, restored: false, conflicts };
      if (!pending.length) return { manifest, restored: true, conflicts };
      const backup = await store.create({ memberId: options.memberId ?? manifest.memberId, command: `restore ${id}`, paths: pending.map((file) => file.path) });
      for (const file of pending) {
        const destination = path.join(workspaceRoot, file.path);
        if (!file.bytes) {
          await fs.rm(destination, { recursive: true, force: true });
          continue;
        }
        await fs.mkdir(path.dirname(destination), { recursive: true });
        await fs.writeFile(destination, file.bytes);
      }
      return { manifest, restored: true, conflicts, backupId: backup.id };
    },
    async list() {
      const entries = await fs.readdir(snapshotsRoot).catch((error: NodeJS.ErrnoException) => error.code === "ENOENT" ? [] : (() => { throw error; })());
      const manifests: SnapshotManifest[] = [];
      for (const entry of entries) {
        const manifestPath = path.join(snapshotsRoot, entry, "manifest.json");
        try { manifests.push(JSON.parse(await fs.readFile(manifestPath, "utf8")) as SnapshotManifest); }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
      }
      return manifests.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
    }
  };
  return store;
}

async function collectSelectedFiles(root: string, selections: string[]) {
  const rootPath = path.resolve(root);
  const files: string[] = [];
  const missing: string[] = [];
  for (const selection of selections) {
    const absolute = path.resolve(rootPath, selection);
    if (absolute !== rootPath && !absolute.startsWith(`${rootPath}${path.sep}`)) throw new Error("Snapshot path must stay inside the workspace");
    const relative = path.relative(rootPath, absolute);
    const stats = await fs.stat(absolute).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return undefined;
      throw error;
    });
    if (!stats) {
      missing.push(relative.split(path.sep).join(path.posix.sep));
      continue;
    }
    if (stats.isDirectory()) files.push(...await collectFiles(rootPath, relative));
    else if (stats.isFile()) files.push(relative.split(path.sep).join(path.posix.sep));
  }
  return { files: [...new Set(files)], missing: [...new Set(missing)] };
}
