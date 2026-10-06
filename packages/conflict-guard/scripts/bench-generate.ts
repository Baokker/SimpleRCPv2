import fs from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import { generateManifest } from "../dist/bench/generator.js";
import type { BenchLabel, BenchManifest, BenchVariant, SeedProject } from "../dist/bench/types.js";
import { readSeedProjects } from "./seed-projects.ts";

const { values: args } = parseArgs({ args: process.argv.slice(2).filter((value) => value !== "--"), options: { seeds: { type: "string", default: "bench/seeds/native" }, out: { type: "string", default: "bench/datasets/d1-v2" }, groups: { type: "string", default: "200" }, seed: { type: "string", default: "1" }, "preserve-labels": { type: "boolean", default: false } } });
const output = path.resolve(args.out ?? "bench/datasets/d1-v1");
const seedDirectory = path.resolve(args.seeds ?? "bench/seeds");
const projects = await readSeedProjects(seedDirectory);
const repository = fileURLToPath(new URL("../../../", import.meta.url));
const manifest = generateManifest({ groups: Number(args.groups), seed: Number(args.seed), projects, generationCommand: `pnpm --filter @simplercp/conflict-guard bench:generate --seeds ${args.seeds} --out ${args.out} --groups ${args.groups} --seed ${args.seed}${args["preserve-labels"] ? " --preserve-labels" : ""}`, codeCommit: execFileSync("git", ["rev-parse", "HEAD"], { cwd: repository, encoding: "utf8" }).trim() });
let labels: BenchLabel[] = [];
if (args["preserve-labels"]) {
  const [previousText, labelsText] = await Promise.all([fs.readFile(path.join(output, "manifest.json"), "utf8"), fs.readFile(path.join(output, "labels.json"), "utf8")]);
  const previous = JSON.parse(previousText) as BenchManifest;
  labels = JSON.parse(labelsText) as BenchLabel[];
  const before = new Map(previous.groups.flatMap((group) => Object.values(group.variants)).map((variant) => [variant.id, variant]));
  const current = manifest.groups.flatMap((group) => Object.values(group.variants)).filter((variant) => !variant.aliasOf);
  if (labels.length !== current.length) throw new Error("既有标注数量与当前样本不一致");
  for (const variant of current) {
    const original = before.get(variant.id);
    const label = labels.find((item) => item.id === variant.id);
    if (!original || !label || label.states.baseline.length !== 3 || label.states.leftOnly.length !== 3 || label.states.rightOnly.length !== 3 || label.states.merged.length !== 3 || labelInputs(original) !== labelInputs(variant)) throw new Error(`既有标注的状态或探针不一致：${variant.id}`);
    variant.truth = label.label; variant.detectability = label.detectability;
  }
  for (const variant of manifest.groups.flatMap((group) => Object.values(group.variants)).filter((variant) => variant.aliasOf)) {
    const label = labels.find((item) => item.id === variant.aliasOf)!;
    variant.truth = label.label; variant.detectability = label.detectability;
  }
}
await fs.rm(path.join(output, "traces"), { recursive: true, force: true });
await fs.mkdir(path.join(output, "traces"), { recursive: true });
await fs.writeFile(path.join(output, "labels.json"), `${JSON.stringify(labels, null, 2)}\n`, "utf8");
await fs.writeFile(path.join(output, "excluded.json"), `${JSON.stringify(labels.filter((label) => label.label === "exclude").map(({ id, reason }) => ({ id, reason })), null, 2)}\n`, "utf8");
for (const group of manifest.groups) for (const variant of [group.variants.conflict, group.variants.safe]) {
  if (variant.aliasOf) { variant.trace = []; continue; }
  const lines = variant.trace.map((event) => JSON.stringify(event)).join("\n");
  await fs.writeFile(path.join(output, "traces", `${variant.id}.jsonl`), `${lines}\n`, "utf8");
  variant.traceFile = `traces/${variant.id}.jsonl`;
  variant.traceHash = createHash("sha256").update(`${lines}\n`).digest("hex");
  variant.trace = [];
}
await fs.writeFile(path.join(output, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ output, groups: manifest.groups.length, development: manifest.split.development.length, holdout: manifest.split.holdout.length, labelsReused: labels.length }));

function labelInputs(variant: BenchVariant) { return JSON.stringify([variant.baseline, variant.leftOnly, variant.rightOnly, variant.merged, variant.probes, variant.entryPoints, variant.expectedMergedObservations, variant.baselineReference]); }
