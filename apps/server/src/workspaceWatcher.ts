import path from "node:path";
import { watch } from "chokidar";
import type { WorkspaceChange } from "./types.js";
import { isIgnoredPath } from "./workspacePolicy.js";

export type WorkspaceChangeType =
  | "add"
  | "addDir"
  | "change"
  | "unlink"
  | "unlinkDir";

export function watchWorkspace(
  workspaceRoot: string,
  onChange: (change: WorkspaceChange) => void | Promise<void>
) {
  const watcher = watch(workspaceRoot, {
    ignored: (candidatePath) => {
      const relativePath = path.relative(workspaceRoot, candidatePath);
      return Boolean(relativePath && isIgnoredPath(relativePath));
    },
    ignoreInitial: true,
    awaitWriteFinish: {
      stabilityThreshold: 100,
      pollInterval: 20
    }
  });
  const pendingChanges = new Set<Promise<void>>();

  watcher.on("all", (type, absolutePath) => {
    if (!isWorkspaceChangeType(type)) return;
    const relativePath = path
      .relative(workspaceRoot, absolutePath)
      .split(path.sep)
      .join("/");
    const pending = Promise.resolve().then(() => onChange({ type, path: relativePath })).catch(
      (error) => console.error("Workspace watcher failed", error)
    ).finally(() => pendingChanges.delete(pending));
    pendingChanges.add(pending);
  });

  return {
    ready: new Promise<void>((resolve) => watcher.once("ready", resolve)),
    async close() {
      await watcher.close();
      await Promise.all(pendingChanges);
    }
  };
}

function isWorkspaceChangeType(value: string): value is WorkspaceChangeType {
  return ["add", "addDir", "change", "unlink", "unlinkDir"].includes(value);
}
