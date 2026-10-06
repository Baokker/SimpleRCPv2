import path from "node:path";

const absolutePathFields = ["filePath", "filepath", "path", "directory", "pattern", "target"] as const;

function inputAbsolutePaths(input: unknown): string[] {
  if (!input || typeof input !== "object") return [];
  const record = input as Record<string, unknown>;
  return absolutePathFields.flatMap((field) => {
    const value = record[field];
    return typeof value === "string" && path.isAbsolute(value) ? [value] : [];
  });
}

interface PermissionPathContext {
  permission: string;
  worktree: string;
  metadata: Record<string, unknown>;
}

export function normalizePermissionPaths(patterns: string[], toolInput: unknown, workspacePath: string, context?: PermissionPathContext): string[] {
  const input = toolInput && typeof toolInput === "object" ? toolInput as Record<string, unknown> : {};
  const metadata = { ...context?.metadata, ...input };
  if (context && ["grep", "glob", "list"].includes(context.permission)) {
    const directory = typeof metadata.path === "string" ? metadata.path : typeof metadata.directory === "string" ? metadata.directory : workspacePath;
    const root = path.resolve(workspacePath, directory);
    const pattern = context.permission === "glob" ? metadata.pattern ?? patterns[0] : metadata.include;
    return [...new Set([root, ...(typeof pattern === "string" ? [path.resolve(root, pattern)] : [])])];
  }
  const filePath = metadata.filePath ?? metadata.filepath;
  if (typeof filePath === "string") return [path.resolve(workspacePath, filePath)];
  const absolute = inputAbsolutePaths(toolInput);
  if (absolute.length) return [...new Set(absolute)];
  return [...new Set(patterns.map((pattern) => path.resolve(context?.worktree ?? workspacePath, pattern)))];
}
