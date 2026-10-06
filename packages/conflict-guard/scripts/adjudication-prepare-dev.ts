import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { parseArgs } from "node:util";
import { gzipSync } from "node:zlib";
import { readTrace, type BenchManifest, type BenchLabel } from "../dist/index.js";

const { values } = parseArgs({ args: process.argv.slice(2).filter((item) => item !== "--"), options: { dataset: { type: "string", default: "bench/datasets/d1-v2" }, out: { type: "string", default: "bench/datasets/stage5-dev-smoke" }, groups: { type: "string", default: "75" } } });
const source = path.resolve(values.dataset!);
const original = JSON.parse(await fs.readFile(path.join(source, "manifest.json"), "utf8")) as BenchManifest;
const originalLabels = JSON.parse(await fs.readFile(path.join(source, "labels.json"), "utf8")) as BenchLabel[];
const count = Number(values.groups);
if (!Number.isInteger(count) || count < 1) throw new Error("冒烟关系组数量必须为正整数");
const selected = original.groups.filter((group) => group.split === "dev" && original.split.development.includes(group.id)).slice(0, count);
const labels: BenchLabel[] = [];
const groups = [] as BenchManifest["groups"];
const output = path.resolve(values.out!);
await fs.mkdir(path.join(output, "traces"), { recursive: true });
for (const [index, sourceGroup] of selected.entries()) {
  const group = structuredClone(sourceGroup);
  const id = `stage5-smoke-${String(index + 1).padStart(4, "0")}`;
  for (const variant of Object.values(group.variants)) {
    const previous = variant.id;
    variant.id = previous.replace(group.id, id);
    if (variant.aliasOf) variant.aliasOf = variant.aliasOf.replace(group.id, id);
    else {
      const trace = variant.traceFile ? readTrace(await fs.readFile(path.join(source, variant.traceFile), "utf8")) : variant.trace;
      const text = trace.map((event) => JSON.stringify(event)).join("\n") + "\n";
      variant.traceFile = `traces/${variant.id}.jsonl`;
      variant.traceHash = createHash("sha256").update(text).digest("hex");
      await fs.writeFile(path.join(output, variant.traceFile), text);
      const label = originalLabels.find((label) => label.id === previous);
      if (!label) throw new Error(`冒烟来源缺少探针标签：${previous}`);
      labels.push({ ...label, id: variant.id, relationGroupId: id });
    }
    variant.trace = [];
  }
  group.id = id; groups.push(group);
}
const manifest = { ...original, version: "stage5-dev-smoke-v2" as const, groups, split: { development: groups.map((group) => group.id), holdout: [] }, programStats: undefined, siteStats: undefined, developmentOrigin: { dataset: original.version, groups: selected.map((group) => group.id), holdoutProjectsUsed: 0 } };
await fs.writeFile(path.join(output, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
await fs.writeFile(path.join(output, "labels.json"), JSON.stringify(labels, null, 2) + "\n");
await fs.writeFile(path.join(output, "excluded.json"), JSON.stringify(labels.filter((label) => label.label === "exclude").map(({ id, reason }) => ({ id, reason })), null, 2) + "\n");
await fs.writeFile(path.join(output, "dataset.json.gz"), gzipSync(JSON.stringify({ manifest, labels })));
console.log(JSON.stringify({ output, groups: groups.length, labels: labels.length, namespace: "stage5-smoke" }));
