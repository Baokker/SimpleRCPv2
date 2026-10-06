import fs from "node:fs/promises";
import path from "node:path";
import { readTrace } from "../dist/trace/trace.js";
import { checkReplay } from "../dist/replay/check.js";
import { replayLibraries } from "./replay-libs.ts";

const directory = path.resolve(process.argv[2] ?? "../../docs/conflict-guard/evidence/checkpoint-a-live-traces");
const libraries = await replayLibraries();
const results = [];
for (const name of (await fs.readdir(directory)).filter((file) => file.endsWith(".jsonl")).sort()) {
  const trace = readTrace(await fs.readFile(path.join(directory, name), "utf8"));
  const initialFiles = JSON.parse(await fs.readFile(path.join(directory, name.replace(/\.jsonl$/, "-project.json")), "utf8")) as Record<string, string>;
  const result = checkReplay(trace, { initialFiles, libs: libraries });
  results.push({ trace: name, ...result });
  console.log(JSON.stringify({ trace: name, valid: result.valid, judgements: result.actual.length, differences: result.differences.length, coordinationDifferences: result.coordinationDifferences.length, errors: result.errors.length }));
}
await fs.writeFile(path.join(directory, "verification.json"), JSON.stringify(results, null, 2) + "\n");
if (results.some((result) => !result.valid)) process.exitCode = 1;
