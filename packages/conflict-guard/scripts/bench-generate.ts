import fs from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { parseArgs } from "node:util";
import { generateManifest } from "../dist/bench/generator.js";
import type { SeedProject } from "../dist/bench/types.js";

const { values: args } = parseArgs({ args: process.argv.slice(2).filter((value) => value !== "--"), options: { seeds: { type: "string", default: "bench/seeds" }, out: { type: "string", default: "bench/datasets/d1-v1" }, groups: { type: "string", default: "10" }, seed: { type: "string", default: "1" } } });
const output = path.resolve(args.out ?? "bench/datasets/d1-v1");
const seedDirectory = path.resolve(args.seeds ?? "bench/seeds");
const projects = await readProjects(seedDirectory);
const manifest = generateManifest({ groups: Number(args.groups), seed: Number(args.seed), projects, generationCommand: `pnpm --filter @simplercp/conflict-guard bench:generate --seeds ${args.seeds} --out ${args.out} --groups ${args.groups} --seed ${args.seed}`, codeCommit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim() });
await fs.mkdir(path.join(output, "traces"), { recursive: true });
await fs.writeFile(path.join(output, "labels.json"), "[]\n", "utf8");
await fs.writeFile(path.join(output, "excluded.json"), "[]\n", "utf8");
for (const group of manifest.groups) for (const variant of [group.variants.conflict, group.variants.safe]) {
  const lines = variant.trace.map((event) => JSON.stringify(event)).join("\n");
  await fs.writeFile(path.join(output, "traces", `${variant.id}.jsonl`), `${lines}\n`, "utf8");
  variant.traceFile = `traces/${variant.id}.jsonl`;
  variant.traceHash = createHash("sha256").update(`${lines}\n`).digest("hex");
  variant.trace = [];
}
await fs.writeFile(path.join(output, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ output, groups: manifest.groups.length, development: manifest.split.development.length, holdout: manifest.split.holdout.length }));

async function readProjects(directory: string): Promise<SeedProject[]> {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    const projects: SeedProject[] = [];
    for (const entry of entries.filter((item) => item.isDirectory()).sort((left, right) => left.name.localeCompare(right.name))) {
      const root = path.join(directory, entry.name);
      const files = await collectFiles(root);
      if (Object.keys(files).length > 0) projects.push({ name: entry.name, files });
    }
    if (projects.length > 0) return projects;
  throw new Error("种子目录没有 TypeScript 项目");
}

async function collectFiles(root: string, relative = "") {
  const result: Record<string, string> = {};
  const entries = await fs.readdir(path.join(root, relative), { withFileTypes: true });
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const file = path.posix.join(relative, entry.name);
    if (entry.isDirectory() && !["node_modules", ".git", "dist", "build", "coverage", "test"].includes(entry.name)) Object.assign(result, await collectFiles(root, file));
    else if (entry.isFile() && /\.(ts|tsx|js|jsx|mts|cts)$/i.test(entry.name)) result[file] = await fs.readFile(path.join(root, file), "utf8");
  }
  return result;
}
