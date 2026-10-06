import fs from "node:fs/promises";
import path from "node:path";
import type { SeedProject } from "../dist/bench/types.js";

export async function readSeedProjects(directory: string): Promise<SeedProject[]> {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const projects: SeedProject[] = [];
  for (const entry of entries.filter((item) => item.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
    const root = path.join(directory, entry.name);
    const files = await collect(root);
    const settings = await fs.readFile(path.join(root, "seed.json"), "utf8").then((text) => JSON.parse(text), (error) => {
      if (error.code === "ENOENT") return undefined;
      throw error;
    });
    if (Object.keys(files).length) projects.push({ name: entry.name, files, ...(settings?.layout === "native" ? { layout: "native" } : {}) });
  }
  if (!projects.length) throw new Error("种子目录没有 TypeScript 项目");
  return projects;
}
async function collect(root: string, relative = ""): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  for (const entry of (await fs.readdir(path.join(root, relative), { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    const file = path.posix.join(relative, entry.name);
    if (entry.isDirectory() && !["node_modules", ".git", "dist", "coverage"].includes(entry.name)) Object.assign(result, await collect(root, file));
    else if (entry.isFile() && /\.[cm]?[jt]sx?$/i.test(entry.name)) result[file] = await fs.readFile(path.join(root, file), "utf8");
  }
  return result;
}
