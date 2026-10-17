import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { parseArgs } from "node:util";

const { values } = parseArgs({ args: process.argv.slice(2).filter((item) => item !== "--"), options: {
  dataset: { type: "string", default: "bench/datasets/d1-v4" }, split: { type: "string", default: "holdout" }, out: { type: "string" }, configG1: { type: "string" }, config: { type: "string" }, models: { type: "string" }, providers: { type: "string" }, cache: { type: "string" }, experiment: { type: "string", default: "E2" }, plan: { type: "boolean", default: false }
} });
if (!values.out || !values.cache || !values.configG1 || !values.config || !values.models || !values.providers) throw new Error("E2 需要 out、cache、configG1、config、models 和 providers");
if (!["dev", "holdout"].includes(values.split!)) throw new Error("E2 split 无效");
const run = promisify(execFile);
const common = ["--experiment", values.experiment!, "--dataset", values.dataset!, "--split", values.split!, "--provider-mode", "record", "--repeat", "1", "--models", values.models!, "--providers", values.providers!, "--grey-only"];
const execute = (policy: string, config: string, output: string, cache: string, extra: string[] = []) => run(process.execPath, ["--experimental-strip-types", "scripts/replay-run.ts", "--policy", policy, "--config", config, "--out", output, "--cache", cache, ...common, ...extra, ...(values.plan ? ["--plan"] : [])], { cwd: process.cwd(), maxBuffer: 4 * 1024 * 1024 });
const g1 = await execute("G1", values.configG1!, `${values.out!}/record-G1`, `${values.cache!}/G1`);
const g2 = await execute("G2-v5", values.config!, `${values.out!}/record-G2-v5`, `${values.cache!}/G2`);
// G3a 的服务从同一根目录下读取 G2 的快判缓存，深判结果写入 G3a 目录。
const g3a = await execute("G3a", values.config!, `${values.out!}/record-G3a`, `${values.cache!}/G3a`, ["--paired-fast"]);
process.stdout.write(JSON.stringify({ experiment: "E2", split: values.split, pairedFastJudge: "record-G2-v5", record: { G1: g1.stdout.trim(), G2v5: g2.stdout.trim(), G3a: g3a.stdout.trim() } }) + "\n");
