import path from "node:path";

const IGNORED_SEGMENTS = new Set(["node_modules", ".git", "__MACOSX"]);

export function isIgnoredPath(relativePath: string) {
  const segments = relativePath
    .split(/[\\/]+/)
    .filter(Boolean);
  return (
    segments.some((segment) => IGNORED_SEGMENTS.has(segment)) ||
    path.basename(relativePath) === ".DS_Store"
  );
}
