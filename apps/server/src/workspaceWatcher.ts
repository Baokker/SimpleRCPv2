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

  watcher.on("all", (type, absolutePath) => {
    if (!isWorkspaceChangeType(type)) return;
    const relativePath = path
      .relative(workspaceRoot, absolutePath)
      .split(path.sep)
      .join("/");
    void Promise.resolve(onChange({ type, path: relativePath })).catch(
      (error) => console.error("Workspace watcher failed", error)
    );
  });

  return watcher;
}

function isWorkspaceChangeType(value: string): value is WorkspaceChangeType {
  return ["add", "addDir", "change", "unlink", "unlinkDir"].includes(value);
}
