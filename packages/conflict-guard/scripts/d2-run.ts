import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { parseArgs } from "node:util";
import { replayTrace, readTrace, wilson, type Decision } from "../dist/index.js";
import { replayLibraries } from "./replay-libs.ts";
import { createExperimentBudget } from "./experiment-budget.ts";

const { values } = parseArgs({ options: { dataset: { type: "string", default: "bench/datasets/d2-greylock" }, out: { type: "string", default: "../../docs/conflict-guard/experiment/X1/d2" }, plan: { type: "boolean", default: false } } });
const dataset = path.resolve(values.dataset!);
const manifest = JSON.parse(await fs.readFile(path.join(dataset, "manifest.json"), "utf8")) as { version: string; caseCount: number; scenarios: number; cases: Array<{ id: string; category: string; trace: string; hash: string; sourceTruth: Decision }> };
const cases = manifest.cases.filter((entry) => entry.category === "rule-case");
if (cases.length !== 51 || manifest.caseCount !== 51) throw new Error("D2 来源案例分母必须为 51");
for (const entry of manifest.cases) if (createHash("sha256").update(await fs.readFile(path.join(dataset, entry.trace))).digest("hex") !== entry.hash) throw new Error(`D2 轨迹哈希不一致：${entry.id}`);
if (values.plan) { console.log(JSON.stringify({ dataset: manifest.version, cases: cases.length, scenarios: manifest.scenarios, executed: false, calls: 0 })); process.exit(0); }
await createExperimentBudget("X1");
const libs = await replayLibraries();
const rows = [];
for (const entry of cases) {
  const trace = readTrace(await fs.readFile(path.join(dataset, entry.trace), "utf8"));
  const result = replayTrace(trace, { policy: "P3", libs });
  if (result.errors.length) throw new Error(`D2 回放失败：${entry.id}`);
  const verdict = result.judgements.at(-1)?.verdict;
  rows.push({ id: entry.id, truth: entry.sourceTruth, local: Boolean(verdict && (verdict.zone !== "grey" || verdict.localOnly)), verdict, matched: verdict?.decision === entry.sourceTruth, judgements: result.judgements });
}
const rules = [...new Set(rows.flatMap((row) => row.verdict ? [row.verdict.ruleId] : []))].sort().map((ruleId) => {
  const selected = rows.filter((row) => row.verdict?.ruleId === ruleId);
  return { ruleId, hits: selected.length, correct: selected.filter((row) => row.matched).length, precision: wilson(selected.filter((row) => row.matched).length, selected.length) };
});
const localCases = rows.filter((row) => row.local).length;
const output = path.resolve(values.out!); await fs.mkdir(output, { recursive: true });
await fs.writeFile(path.join(output, "raw.json"), JSON.stringify({ dataset: manifest.version, sourceBaseline: { local: 10, cases: 51 }, localCases, denominator: 51, noCandidateCases: rows.filter((row) => !row.verdict).map((row) => row.id), rows, rules }, null, 2) + "\n");
await fs.writeFile(path.join(output, "config.json"), JSON.stringify({ policy: "P3", dataset: manifest.version, denominator: "51-rule-cases", rulePrecision: "last-verdict-per-case-exact-decision", deliveryScenariosExcluded: manifest.scenarios }, null, 2) + "\n");
await fs.writeFile(path.join(output, "command.txt"), `pnpm --filter @simplercp/conflict-guard d2:run ${process.argv.slice(2).join(" ")}\n`);
await fs.writeFile(path.join(output, "summary.md"), ["# D2 本地规则覆盖", "", `本系统本地决定 ${localCases}/51；GreyLock v1 来源基线 10/51。没有候选对的案例继续保留在覆盖分母中，六个交付场景独立于来源规则案例。精确率采用每个案例的最终判定与来源真值，规则的完整判定记录保存在 raw.json。`, "", "| 规则 | 命中案例 | 正确案例 | 精确率 |", "|---|---:|---:|---:|", ...rules.map((rule) => `| ${rule.ruleId} | ${rule.hits} | ${rule.correct} | ${(100 * rule.precision.value).toFixed(2)}% |`), ""].join("\n"));
console.log(JSON.stringify({ output, localCases, denominator: 51 }));
