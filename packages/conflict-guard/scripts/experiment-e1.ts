import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { parseArgs } from "node:util";

const { values } = parseArgs({ args: process.argv.slice(2).filter((item) => item !== "--"), options: {
  dataset: { type: "string", default: "bench/datasets/d1-v4" }, split: { type: "string", default: "holdout" }, out: { type: "string" }, config: { type: "string" }, models: { type: "string" }, providers: { type: "string" }, cache: { type: "string" }, experiment: { type: "string", default: "E1" }, plan: { type: "boolean", default: false }
} });
if (!values.out || !values.cache || !values.config || !values.models || !values.providers) throw new Error("E1 需要 out、cache、config、models 和 providers");
if (!["dev", "holdout"].includes(values.split!)) throw new Error("E1 split 无效");
const run = promisify(execFile);
const common = ["--experiment", values.experiment!, "--dataset", values.dataset!, "--split", values.split!, "--provider-mode", "replay", "--repeat", "1", "--config", values.config!, "--models", values.models!, "--providers", values.providers!, "--cache", values.cache!];
const base = await run(process.execPath, ["--experimental-strip-types", "scripts/replay-run.ts", "--policy", "P0,P1,P2,P3,P4,P*", "--out", values.out!, ...common, ...(values.plan ? ["--plan"] : [])], { cwd: process.cwd(), maxBuffer: 4 * 1024 * 1024 });
const ablation = await run(process.execPath, ["--experimental-strip-types", "scripts/replay-run.ts", "--policy", "P4-no-four-state-typecheck", "--ablation", "no-four-state-typecheck", "--out", `${values.out!}/ablation`, ...common, ...(values.plan ? ["--plan"] : [])], { cwd: process.cwd(), maxBuffer: 4 * 1024 * 1024 });
process.stdout.write(JSON.stringify({ experiment: "E1", split: values.split, pairedStatistics: true, bootstrap: { repetitions: 2000, seed: 20261007 }, base: base.stdout.trim(), ablation: ablation.stdout.trim() }) + "\n");
