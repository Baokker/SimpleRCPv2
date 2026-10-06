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

export function normalizePermissionPaths(patterns: string[], toolInput: unknown, workspacePath: string): string[] {
  const absolute = inputAbsolutePaths(toolInput);
  if (absolute.length) return [...new Set(absolute)];
  return [...new Set(patterns.map((pattern) => path.resolve(workspacePath, pattern)))];
}
