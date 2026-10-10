import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { parseArgs } from "node:util";

const { values } = parseArgs({ options: { source: { type: "string" } } });
if (!values.source) throw new Error("必须指定真实 GreyLock 来源目录");
const hashes = JSON.parse(await fs.readFile("bench/datasets/d2-greylock/source-hashes.json", "utf8")) as Record<string, string>;
const sources: Record<string, string> = {};
for (const [file, expected] of Object.entries(hashes)) {
  const contents = await fs.readFile(path.join(path.resolve(values.source), file));
  if (createHash("sha256").update(contents).digest("hex") !== expected) throw new Error(`来源哈希不一致：${file}`);
  sources[file] = contents.toString("utf8");
}
const output = "src/replay/fixtures/greylock-source.json.gz";
await fs.mkdir(path.dirname(output), { recursive: true });
await fs.writeFile(output, gzipSync(JSON.stringify(sources) + "\n"));
console.log(JSON.stringify({ files: Object.keys(sources).length, output }));
