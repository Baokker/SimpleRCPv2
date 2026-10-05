import fs from "node:fs/promises";
import path from "node:path";
import { generateManifest, type SeedProject } from "../dist/bench/generator.js";

const args = parseArgs(process.argv.slice(2));
const output = path.resolve(args.out ?? "bench/datasets/d1-v1");
const seedDirectory = path.resolve(args.seeds ?? "bench/seeds");
const projects = await readProjects(seedDirectory);
const manifest = generateManifest({ groups: Number(args.groups ?? 10), seed: Number(args.seed ?? 1), projects });
await fs.mkdir(path.join(output, "traces"), { recursive: true });
await fs.writeFile(path.join(output, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
await fs.writeFile(path.join(output, "labels.json"), "[]\n", "utf8");
await fs.writeFile(path.join(output, "excluded.json"), "[]\n", "utf8");
for (const group of manifest.groups) for (const variant of [group.variants.conflict, group.variants.safe]) {
  const lines = variant.trace.map((event) => JSON.stringify(event)).join("\n");
  await fs.writeFile(path.join(output, "traces", `${variant.id}.jsonl`), `${lines}\n`, "utf8");
}
console.log(JSON.stringify({ output, groups: manifest.groups.length, development: manifest.split.development.length, holdout: manifest.split.holdout.length }));

async function readProjects(directory: string): Promise<SeedProject[]> {
  try {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    const projects: SeedProject[] = [];
    for (const entry of entries.filter((item) => item.isDirectory()).sort((left, right) => left.name.localeCompare(right.name))) {
      const root = path.join(directory, entry.name);
      const files = await collectFiles(root);
      if (Object.keys(files).length > 0) projects.push({ name: entry.name, files });
    }
    if (projects.length > 0) return projects;
  } catch {
    // 使用内置种子项目。
  }
  const demoRoot = path.resolve(directory, "../../../demo/conflict-shop");
  const files = await collectFiles(demoRoot);
  return ["commerce", "inventory", "permissions", "formatter", "calendar", "billing", "events"].map((name) => ({ name, files }));
}

async function collectFiles(root: string, relative = "") {
  const result: Record<string, string> = {};
  let entries;
  try { entries = await fs.readdir(path.join(root, relative), { withFileTypes: true }); } catch { return result; }
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const file = path.posix.join(relative, entry.name);
    if (entry.isDirectory() && !["node_modules", ".git", "dist", "build", "coverage", "test"].includes(entry.name)) Object.assign(result, await collectFiles(root, file));
    else if (entry.isFile() && /\.(ts|tsx|js|jsx|mts|cts)$/i.test(entry.name)) result[file] = await fs.readFile(path.join(root, file), "utf8");
  }
  return result;
}

function parseArgs(argv: string[]) {
  const result: Record<string, string> = {};
  for (let index = 0; index < argv.length; index += 1) if (argv[index]?.startsWith("--")) result[argv[index]!.slice(2)] = argv[index + 1] ?? "";
  return result;
}
