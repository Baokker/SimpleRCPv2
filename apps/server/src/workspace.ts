import fs from "node:fs/promises";
import path from "node:path";
import type { WorkspaceFileLoadResult, WorkspaceNode } from "./types.js";

export const LARGE_FILE_BYTES = 1024 * 1024;
const BINARY_SAMPLE_BYTES = 8 * 1024;
const BINARY_EXTENSIONS = new Set([
  ".class", ".dll", ".dylib", ".exe", ".gif", ".ico", ".jar", ".jpeg",
  ".jpg", ".o", ".pdf", ".png", ".pyc", ".so", ".webp", ".zip"
]);

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

export async function readWorkspaceFile(
  root: string,
  relativePath: string,
  force = false
): Promise<WorkspaceFileLoadResult> {
  const absolutePath = resolveWorkspacePath(root, relativePath);
  const file = await fs.open(absolutePath, "r");

  try {
    const stat = await file.stat();
    const sample = Buffer.alloc(Math.min(stat.size, BINARY_SAMPLE_BYTES));
    await file.read(sample, 0, sample.length, 0);

    if (
      BINARY_EXTENSIONS.has(path.extname(relativePath).toLowerCase()) ||
      sample.includes(0)
    ) {
      return { status: "binary", path: relativePath, size: stat.size };
    }
    if (stat.size > LARGE_FILE_BYTES && !force) {
      return { status: "large", path: relativePath, size: stat.size };
    }

    return {
      status: "text",
      path: relativePath,
      size: stat.size,
      content: await fs.readFile(absolutePath, "utf8")
    };
  } finally {
    await file.close();
  }
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

export async function createWorkspaceFile(
  root: string,
  relativePath: string,
  content = ""
) {
  const absolutePath = resolveWorkspacePath(root, relativePath);
  if (await pathExists(absolutePath)) {
    throw new Error("Target path already exists");
  }
  await fs.mkdir(path.dirname(absolutePath), { recursive: true });
  await fs.writeFile(absolutePath, content, { encoding: "utf8", flag: "wx" });
}

export async function createWorkspaceDirectory(
  root: string,
  relativePath: string
) {
  const absolutePath = resolveWorkspacePath(root, relativePath);
  if (await pathExists(absolutePath)) {
    throw new Error("Target path already exists");
  }
  await fs.mkdir(absolutePath, { recursive: true });
}

export async function renameWorkspacePath(
  root: string,
  fromPath: string,
  toPath: string
) {
  const absoluteFrom = resolveWorkspacePath(root, fromPath);
  const absoluteTo = resolveWorkspacePath(root, toPath);
  if (isWorkspaceRoot(root, fromPath)) {
    throw new Error("Cannot rename workspace root");
  }
  if (await pathExists(absoluteTo)) {
    throw new Error("Target path already exists");
  }
  await fs.mkdir(path.dirname(absoluteTo), { recursive: true });
  await fs.rename(absoluteFrom, absoluteTo);
}

export async function deleteWorkspacePath(root: string, relativePath: string) {
  const absolutePath = resolveWorkspacePath(root, relativePath);
  if (isWorkspaceRoot(root, relativePath)) {
    throw new Error("Cannot delete workspace root");
  }
  await fs.rm(absolutePath, { recursive: true, force: false });
}

export async function pathExists(absolutePath: string) {
  try {
    await fs.stat(absolutePath);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

function isWorkspaceRoot(root: string, relativePath: string) {
  return path.resolve(root) === resolveWorkspacePath(root, relativePath);
}
