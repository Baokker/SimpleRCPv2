import fs from "node:fs/promises";
import path from "node:path";
import type { WorkspaceNode } from "./types.js";

const IGNORED_NAMES = new Set([".git", "node_modules", "dist", "coverage"]);

export function resolveWorkspacePath(root: string, relativePath: string) {
  const absoluteRoot = path.resolve(root);
  const candidate = path.resolve(absoluteRoot, relativePath);
  const relative = path.relative(absoluteRoot, candidate);

  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Path escapes workspace root");
  }

  return candidate;
}

export async function listWorkspaceTree(root: string): Promise<WorkspaceNode[]> {
  return listDirectory(root, "");
}

async function listDirectory(
  root: string,
  relativeDir: string
): Promise<WorkspaceNode[]> {
  const absoluteDir = resolveWorkspacePath(root, relativeDir);
  const entries = await fs.readdir(absoluteDir, { withFileTypes: true });
  const nodes = await Promise.all(
    entries
      .filter((entry) => !IGNORED_NAMES.has(entry.name))
      .sort((a, b) => {
        if (a.isDirectory() !== b.isDirectory()) {
          return a.isDirectory() ? 1 : -1;
        }
        return a.name.localeCompare(b.name);
      })
      .map(async (entry): Promise<WorkspaceNode> => {
        const childRelativePath = relativeDir
          ? path.posix.join(relativeDir, entry.name)
          : entry.name;

        if (entry.isDirectory()) {
          return {
            name: entry.name,
            path: childRelativePath,
            type: "directory",
            children: await listDirectory(root, childRelativePath)
          };
        }

        return {
          name: entry.name,
          path: childRelativePath,
          type: "file"
        };
      })
  );

  return nodes;
}

export async function readWorkspaceFile(root: string, relativePath: string) {
  return fs.readFile(resolveWorkspacePath(root, relativePath), "utf8");
}

export async function writeWorkspaceFile(
  root: string,
  relativePath: string,
  content: string
) {
  const absolutePath = resolveWorkspacePath(root, relativePath);
  await fs.mkdir(path.dirname(absolutePath), { recursive: true });
  await fs.writeFile(absolutePath, content, "utf8");
}
