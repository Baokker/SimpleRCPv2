import { realpathSync } from "node:fs";
import path from "node:path";

const roots = new Map<string, string>();

export function canonicalWorkspaceRoot(root: string) {
  const absolute = path.resolve(root);
  let canonical = roots.get(absolute);
  if (!canonical) {
    canonical = realpathSync(absolute);
    roots.set(absolute, canonical);
    roots.set(canonical, canonical);
  }
  return canonical;
}

export function canonicalWorkspacePath(root: string, requested: string) {
  const canonicalRoot = canonicalWorkspaceRoot(root);
  const absolute = path.resolve(path.resolve(root), requested);
  let ancestor = absolute;
  const missing: string[] = [];
  let canonical: string;
  for (;;) {
    try { canonical = path.join(realpathSync(ancestor), ...missing); break; }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      const parent = path.dirname(ancestor);
      if (parent === ancestor) throw error;
      missing.unshift(path.basename(ancestor));
      ancestor = parent;
    }
  }
  const relative = path.relative(canonicalRoot, canonical);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error("请求路径超出工作区范围");
  return { absolute: canonical, relative: relative.split(path.sep).join("/") };
}
