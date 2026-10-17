import fs from "node:fs/promises";
import path from "node:path";
import { repositoryRoot } from "./model-runtime.ts";
import { replayEvidenceSummary } from "../dist/replay/reporting.js";
import { developmentSamples } from "./model-dataset.ts";
import { compareEvaluations, type EvaluationRow } from "../dist/replay/evaluation.js";

type ReplayResult = {
  endedAt: number;
  freezeIntervals: Array<{ pairId: string; actor: { kind: string; memberId?: string }; start: number; end?: number }>;
  coordinationEvents: Array<{ type: string; at?: number; pairId?: string; verdict?: { adjudication?: { source?: string } } }>;
  judgements: Array<{ verdict: { ruleId: string; summary: string } }>;
};
type Group = EvaluationRow & { result: ReplayResult };
type Evaluation = { metrics: Record<string, any>; groups: Group[] };
type FreezeSourceBreakdown = { localRuleSeconds: number; modelSeconds: number; mixedSeconds: number; totalSeconds: number };

const root = path.join(repositoryRoot, "docs/conflict-guard/experiment/v2/stage-A3/E1-human");
const read = async <T>(file: string) => JSON.parse(await fs.readFile(path.join(root, file), "utf8")) as T;
const base = await read<{ policies: Record<string, Evaluation> }>("base/results.json");
const p4 = await read<Evaluation>("P4/results.json");
const ablation = await read<Evaluation>("P4-no-four-state-typecheck/results.json");
const evaluations: Record<string, Evaluation> = { ...base.policies, P4: p4, "P4-no-four-state-typecheck": ablation };
const { samples } = await developmentSamples(path.join(repositoryRoot, "packages/conflict-guard/bench/datasets/d1-v4"));
const traces = new Map(samples.map((sample) => [sample.label.id, sample.trace]));
const metric = (value: unknown) => typeof value === "number" ? `${(value * 100).toFixed(2)}%` : value === null || value === undefined ? "N/A" : String(value);
const rows = ["P0", "P1", "P2", "P3", "P*", "P4", "P4-no-four-state-typecheck"];
const summary = [
  "# E1 人与人协作回放",
  "",
  "数据集 D1-v4 开发集，k=2。P4 使用阶段 A3 的 G3a 录制；消融条件关闭四状态类型检查。",
  "",
  "| 策略 | 漏阻断率 | 安全修改误拦率 | 安全修改提醒比例 | 未及时通知的冲突写入 | 冻结人·秒 | 本地决定比例 |",
  "|---|---:|---:|---:|---:|---:|---:|"
];
const breakdown: Record<string, FreezeSourceBreakdown> = {};
const verification = Object.fromEntries(rows.map((id) => [id, replayEvidenceSummary(evaluations[id]!.groups)]));
const statistics = compareEvaluations(Object.fromEntries(["P1", "P2", "P3", "P4"].map((id) => [id, evaluations[id]!.groups])), 20261007, { reference: "P4" });
const p4Statistics = compareEvaluations({ P4: p4.groups });
for (const id of rows) {
  const evaluation = evaluations[id];
  if (!evaluation) continue;
  const metrics = evaluation.metrics;
  const evidence = verification[id]!;
  if (evidence.comparable) summary.push(`| ${id} | ${metric(metrics.missBlockRatio?.value)} | ${metric(metrics.falseBlockRatio?.value)} | ${metric(evidence.safeWarningRate)} | ${metrics.unnotifiedEscapes ?? "N/A"} | ${typeof metrics.frozenPersonSeconds === "number" ? metrics.frozenPersonSeconds.toFixed(2) : "N/A"} | ${metric(metrics.localDecisionRatio?.value)} |`);
  else summary.push(`| ${id}（无法比较） | N/A | N/A | N/A | N/A | N/A | N/A |`);
  if (id === "P3" || id === "P4" || id === "P4-no-four-state-typecheck") breakdown[id] = splitFreezeSeconds(evaluation.groups);
}
await fs.writeFile(path.join(root, "freeze-source-breakdown.json"), JSON.stringify({ dataset: "d1-v4", split: "dev", k: 2, policies: breakdown }, null, 2) + "\n");
for (const id of ["P3", "P4", "P4-no-four-state-typecheck"]) {
  if (!verification[id]!.comparable) continue;
  const source = breakdown[id]!;
  summary.push("", `${id} 冻结时间来源：本地规则 ${source.localRuleSeconds.toFixed(2)} 人·秒，模型研判 ${source.modelSeconds.toFixed(2)} 人·秒，来源重叠 ${source.mixedSeconds.toFixed(2)} 人·秒，合计 ${source.totalSeconds.toFixed(2)} 人·秒。`);
}
summary.push("", "安全修改提醒比例的分母为真值 allow 的全部样本。P4 的模型研判结果来自阶段 A3 的 G3a 录制。", "");
for (const [id, evidence] of Object.entries(verification)) if (!evidence.comparable) summary.push(`${id} 有 ${evidence.cacheMissingJudgements} 条判定缺少回放缓存，涉及 ${evidence.cacheMissingGroups.length} 个样本，当前结果无法用于评价消融效果；原始输出保存在对应 results.json 中。`, "");
summary.push("关系组的全部变体正确时记为正确。P4 与 P1、P2、P3 的三个比较构成同一 Holm 校正族；bootstrap 重复 2000 次，种子为 20261007。", "", "| 比较 | 关系组数 | exact McNemar p | Holm p |", "|---|---:|---:|---:|");
for (const comparison of statistics.comparisons) summary.push(`| ${comparison.left} / ${comparison.right} | ${comparison.groups} | ${comparison.p.toPrecision(6)} | ${comparison.adjustedP.toPrecision(6)} |`);
summary.push("");
await fs.writeFile(path.join(root, "statistics.json"), JSON.stringify(statistics, null, 2) + "\n");
await fs.writeFile(path.join(root, "P4/statistics.json"), JSON.stringify(p4Statistics, null, 2) + "\n");
await fs.writeFile(path.join(root, "P4/verification.json"), JSON.stringify({ statistics: p4Statistics, evidence: verification.P4, source: "results.json" }, null, 2) + "\n");
await fs.writeFile(path.join(root, "P4/command.txt"), "node --experimental-strip-types packages/conflict-guard/scripts/stage-a3-e1-model.ts\n");
await fs.writeFile(path.join(root, "report-verification.json"), JSON.stringify(verification, null, 2) + "\n");
await fs.writeFile(path.join(root, "summary.md"), summary.join("\n"));
await fs.writeFile(path.join(root, "report-command.txt"), "node --experimental-strip-types packages/conflict-guard/scripts/stage-a3-e1-report.ts\n");
console.log(JSON.stringify({ policies: Object.keys(breakdown), freezeSourceBreakdown: breakdown }));

function splitFreezeSeconds(groups: Group[]): FreezeSourceBreakdown {
  const totals = { localRuleSeconds: 0, modelSeconds: 0, mixedSeconds: 0, totalSeconds: 0 };
  for (const group of groups) {
    const events = [...(group.result.coordinationEvents ?? [])].sort((left, right) => Number(left.at ?? 0) - Number(right.at ?? 0));
    const intervals = group.result.freezeIntervals ?? [];
    const trace = group.id ? traces.get(group.id) : undefined;
    if (!trace) throw new Error("冻结来源统计缺少原始轨迹");
    const cutoff = trace.find((event) => event.type === "session_start")?.typing
      ? Math.max(0, ...trace.filter((event) => event.type === "edit").map((event) => event.at))
      : group.result.endedAt;
    const byActor = new Map<string, Array<{ start: number; end: number; source: "local" | "model" }>>();
    for (const interval of intervals) {
      const verdict = [...events].reverse().find((event) => event.type === "pair_judged" && event.pairId === interval.pairId && Number(event.at ?? 0) <= interval.start)?.verdict;
      const source = verdict?.adjudication?.source === "fast" || verdict?.adjudication?.source === "deep" ? "model" : "local";
      const key = JSON.stringify(interval.actor);
      const entries = byActor.get(key) ?? [];
      entries.push({ start: interval.start, end: Math.min(interval.end ?? group.result.endedAt, cutoff), source });
      byActor.set(key, entries);
    }
    for (const entries of byActor.values()) {
      const boundaries = [...new Set(entries.flatMap((entry) => [entry.start, entry.end]))].sort((left, right) => left - right);
      for (let index = 0; index + 1 < boundaries.length; index += 1) {
        const start = boundaries[index]!;
        const end = boundaries[index + 1]!;
        if (end <= start) continue;
        const sources = new Set(entries.filter((entry) => entry.start <= start && entry.end >= end).map((entry) => entry.source));
        if (!sources.size) continue;
        const seconds = (end - start) / 1000;
        totals.totalSeconds += seconds;
        if (sources.size > 1) totals.mixedSeconds += seconds;
        else if (sources.has("model")) totals.modelSeconds += seconds;
        else totals.localRuleSeconds += seconds;
      }
    }
  }
  return totals;
}
