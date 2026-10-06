import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { parseArgs } from "node:util";
import { generateManifest, type BenchManifest, type SeedProject } from "../dist/index.js";
import { repositoryRoot } from "./model-runtime.ts";

const { values } = parseArgs({ args: process.argv.slice(2).filter((item) => item !== "--"), options: { dataset: { type: "string", default: "bench/datasets/d1-v1" }, out: { type: "string", default: "bench/datasets/stage5-dev-smoke" }, groups: { type: "string", default: "120" }, seed: { type: "string", default: "20261007" } } });
const original = JSON.parse(await fs.readFile(path.join(path.resolve(values.dataset!), "manifest.json"), "utf8")) as BenchManifest;
const projects = [...new Map(original.groups.filter((group) => group.split === "dev").map((group) => [group.project, { name: group.project, files: group.variants.safe.baseline } satisfies SeedProject])).values()];
const manifest = generateManifest({ groups: Number(values.groups), seed: Number(values.seed), projects, generationCommand: `adjudication:prepare-dev --groups ${values.groups} --seed ${values.seed}`, codeCommit: execFileSync("git", ["rev-parse", "HEAD"], { cwd: repositoryRoot, encoding: "utf8" }).trim() });
manifest.version = "stage5-dev-smoke-v1";
manifest.groups = manifest.groups.filter((group) => ["IC", "CP", "SF"].includes(group.operator.family));
for (const group of manifest.groups) group.split = "dev";
manifest.split = { development: manifest.groups.map((group) => group.id), holdout: [] };
manifest.programStats = undefined;
const output = path.resolve(values.out!); await fs.mkdir(path.join(output, "traces"), { recursive: true });
for (const group of manifest.groups) for (const variant of Object.values(group.variants)) {
  if (variant.aliasOf) { variant.trace = []; continue; }
  const text = variant.trace.map((event) => JSON.stringify(event)).join("\n") + "\n";
  variant.traceFile = `traces/${variant.id}.jsonl`; variant.traceHash = createHash("sha256").update(text).digest("hex");
  await fs.writeFile(path.join(output, variant.traceFile), text); variant.trace = [];
}
await fs.writeFile(path.join(output, "manifest.json"), JSON.stringify({ ...manifest, developmentOrigin: { dataset: values.dataset, projects: projects.map((project) => project.name), holdoutProjectsUsed: 0, heldoutOperatorFamiliesUsed: 0 } }, null, 2) + "\n");
await fs.writeFile(path.join(output, "labels.json"), "[]\n");
console.log(JSON.stringify({ output, groups: manifest.groups.length, projects: projects.map((project) => project.name) }));
