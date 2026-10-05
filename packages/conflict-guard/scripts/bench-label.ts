import fs from "node:fs/promises";
import path from "node:path";
import { labelManifest } from "../dist/bench/labeler.js";
import type { BenchManifest } from "../dist/bench/types.js";

const args = parseArgs(process.argv.slice(2));
const directory = path.resolve(args.dataset ?? "bench/datasets/d1-v1");
const manifest = JSON.parse(await fs.readFile(path.join(directory, "manifest.json"), "utf8")) as BenchManifest;
const result = labelManifest(manifest);
await fs.writeFile(path.join(directory, "labels.json"), `${JSON.stringify(result.labels, null, 2)}\n`, "utf8");
await fs.writeFile(path.join(directory, "excluded.json"), `${JSON.stringify(result.excluded, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ dataset: directory, labels: result.labels.length, excluded: result.excluded.length, concurrency: Number(args.concurrency ?? 1) }));

function parseArgs(argv: string[]) {
  const result: Record<string, string> = {};
  for (let index = 0; index < argv.length; index += 1) if (argv[index]?.startsWith("--")) result[argv[index]!.slice(2)] = argv[index + 1] ?? "";
  return result;
}
