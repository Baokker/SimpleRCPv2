import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify, parseArgs } from "node:util";
import { gunzipSync } from "node:zlib";
import { compareEvaluations, type EvaluationRow } from "../dist/index.js";
import { createExperimentBudget } from "./experiment-budget.ts";

const { values } = parseArgs({ options: { dataset: { type: "string", default: "bench/datasets/d1-v3" }, split: { type: "string", default: "dev,holdout" }, cache: { type: "string", default: "bench/model-cache/stage8-x3-record" }, "dev-cache": { type: "string", default: "bench/model-cache/preexperiment" }, config: { type: "string", default: "../../docs/conflict-guard/experiment/adjudication-config.json" }, models: { type: "string", default: "../../docs/conflict-guard/experiment/models.json" }, providers: { type: "string", default: "../../docs/conflict-guard/experiment/providers.json" }, "agent-dataset": { type: "string", default: "../../docs/conflict-guard/experiment/X5/P5/on" }, out: { type: "string", default: "../../docs/conflict-guard/experiment/X7" }, plan: { type: "boolean", default: false } } });
const splits = values.split!.split(",");
if (splits.some((split) => !["dev", "holdout"].includes(split))) throw new Error("split 必须为 dev 或 holdout");
const conditions = ["baseline", "no-four-state-typecheck", "no-invariants", "no-T0", "no-T3", "all-history"];
if (values.plan) { console.log(JSON.stringify({ splits, conditions, policy: "G2", repetitions: 1, newRecordings: "no-invariants 每个 split 一次", enableT3Dataset: values["agent-dataset"], executed: false })); process.exit(0); }
await createExperimentBudget("X7");
const run = promisify(execFile);
for (const split of splits) {
  const output = path.resolve(values.out!, split);
  const evaluations: Record<string, EvaluationRow[]> = {};
  const rows = [];
  for (const condition of conditions.filter((condition) => condition !== "no-T3")) {
    const target = path.join(output, condition);
    const cache = condition === "no-invariants" ? path.join(output, "cache-no-invariants") : path.resolve(split === "dev" ? values["dev-cache"]! : values.cache!);
    const args = ["--experimental-strip-types", "scripts/adjudication-run.ts", "--dataset", values.dataset!, "--split", split, "--policy", "G2", "--repeat", "1", "--experiment", "X7", "--provider-mode", condition === "no-invariants" ? "record" : "replay", "--config", values.config!, "--models", values.models!, "--providers", values.providers!, "--cache", cache, "--out", target, ...(condition === "baseline" ? [] : ["--ablation", condition])];
    await run(process.execPath, args, { maxBuffer: 4 * 1024 * 1024 });
    const report = JSON.parse(gunzipSync(await fs.readFile(path.join(target, "results.json.gz"))).toString());
    const result = report.policies.G2;
    const comparable = result.model.cacheMisses === 0;
    if (comparable) evaluations[condition] = result.groups.map((row: EvaluationRow) => ({ id: row.id, relationGroupId: row.relationGroupId, outcome: row.outcome }));
    rows.push({ condition, comparable, cacheMisses: result.model.cacheMisses, metrics: result.metrics });
  }
  if (!evaluations.baseline) throw new Error("G2 基线缓存缺失，消融无法比较");
  const statistics = compareEvaluations(evaluations, 20261007, { reference: "baseline" });
  await fs.writeFile(path.join(output, "verification.json"), JSON.stringify({ rows, statistics, t3Applicable: false, t3Reason: "D1 没有 Agent 任务完成后复检" }, null, 2) + "\n");
  await fs.writeFile(path.join(output, "summary.md"), ["# G2 消融", "", "bootstrap 2000 次，种子 20261007；Holm 检验族包含基线与适用消融的比较。缓存缺失条件单独记录，统计比较只使用完整缓存条件。D1 的任务完成后复检为 N/A。", "", "| 条件 | 可比较 | 缓存缺失 | 一致率 |", "|---|---|---:|---:|", ...rows.map((row) => `| ${row.condition} | ${row.comparable} | ${row.cacheMisses} | ${row.comparable ? row.metrics.agreement.value : "N/A"} |`), ""].join("\n"));
}
await run(process.execPath, ["--experimental-strip-types", "scripts/replay-agents.ts", "--dataset", values["agent-dataset"]!, "--out", path.resolve(values.out!, "d3-no-T3"), "--arbitration", "owner", "--repeat", "1", "--no-T3"], { maxBuffer: 4 * 1024 * 1024 });
console.log(JSON.stringify({ splits, conditions, output: values.out }));
