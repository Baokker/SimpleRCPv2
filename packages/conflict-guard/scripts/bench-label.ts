import fs from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { labelManifest } from "../dist/bench/labeler.js";
import { executeProbe } from "../dist/bench/executor.js";
import type { BenchManifest } from "../dist/bench/types.js";

const { values } = parseArgs({ args: process.argv.slice(2).filter((item) => item !== "--"), options: { dataset: { type: "string" }, concurrency: { type: "string", default: "1" } } });
const directory = path.resolve(values.dataset ?? "bench/datasets/d1-v1");
const manifest = JSON.parse(await fs.readFile(path.join(directory, "manifest.json"), "utf8")) as BenchManifest;
const result = await labelManifest(manifest, executeProbe, Number(values.concurrency));
for (const group of manifest.groups) for (const variant of Object.values(group.variants)) {
  const label = result.labels.find((item) => item.id === (variant.aliasOf ?? variant.id))!;
  variant.truth = label.label;
  variant.detectability = label.detectability;
}
await fs.writeFile(path.join(directory, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
await fs.writeFile(path.join(directory, "labels.json"), `${JSON.stringify(result.labels, null, 2)}\n`);
await fs.writeFile(path.join(directory, "excluded.json"), `${JSON.stringify(result.excluded, null, 2)}\n`);
console.log(JSON.stringify({ dataset: directory, labels: result.labels.length, excluded: result.excluded.length, concurrency: Number(values.concurrency) }));
