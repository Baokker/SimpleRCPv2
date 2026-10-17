import fs from "node:fs/promises";
import path from "node:path";
import { repositoryRoot } from "./model-runtime.ts";

type ReplayResult = {
  endedAt: number;
  freezeIntervals: Array<{ pairId: string; actor: { kind: string; memberId?: string }; start: number; end?: number }>;
  coordinationEvents: Array<{ type: string; at?: number; pairId?: string; verdict?: { adjudication?: { source?: string } } }>;
};
type Group = { outcome: { truth: string; decision: string; virtualDurationMs?: number; frozenPersonSeconds?: number }; result: ReplayResult };
type Evaluation = { metrics: Record<string, any>; groups: Group[] };
type FreezeSourceBreakdown = { localRuleSeconds: number; modelSeconds: number; mixedSeconds: number; totalSeconds: number };

const root = path.join(repositoryRoot, "docs/conflict-guard/experiment/v2/stage-A3/E1-human");
const read = async <T>(file: string) => JSON.parse(await fs.readFile(path.join(root, file), "utf8")) as T;
const base = await read<{ policies: Record<string, Evaluation> }>("base/results.json");
const p4 = await read<Evaluation>("P4/results.json");
const ablation = await read<Evaluation>("P4-no-four-state-typecheck/results.json");
const evaluations: Record<string, Evaluation> = { ...base.policies, P4: p4, "P4-no-four-state-typecheck": ablation };
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
for (const id of rows) {
  const evaluation = evaluations[id];
  if (!evaluation) continue;
  const metrics = evaluation.metrics;
  const safeCount = Number(metrics.variantCounts?.safe ?? 0);
  const safeWarnings = evaluation.groups.filter((group) => group.outcome.truth === "allow" && group.outcome.decision === "warn").length;
  const safeWarningRate = safeCount > 0 ? safeWarnings / safeCount : null;
  summary.push(`| ${id} | ${metric(metrics.missBlockRatio?.value)} | ${metric(metrics.falseBlockRatio?.value)} | ${metric(safeWarningRate)} | ${metrics.unnotifiedEscapes ?? "N/A"} | ${typeof metrics.frozenPersonSeconds === "number" ? metrics.frozenPersonSeconds.toFixed(2) : "N/A"} | ${metric(metrics.localDecisionRatio?.value)} |`);
  if (id === "P3" || id === "P4" || id === "P4-no-four-state-typecheck") breakdown[id] = splitFreezeSeconds(evaluation.groups);
}
await fs.writeFile(path.join(root, "freeze-source-breakdown.json"), JSON.stringify({ dataset: "d1-v4", split: "dev", k: 2, policies: breakdown }, null, 2) + "\n");
for (const id of ["P3", "P4", "P4-no-four-state-typecheck"]) {
  const source = breakdown[id]!;
  summary.push("", `${id} 冻结时间来源：本地规则 ${source.localRuleSeconds.toFixed(2)} 人·秒，模型研判 ${source.modelSeconds.toFixed(2)} 人·秒，来源重叠 ${source.mixedSeconds.toFixed(2)} 人·秒，合计 ${source.totalSeconds.toFixed(2)} 人·秒。`);
}
summary.push("", "P4 的模型研判结果来自阶段 A3 的 G3a 录制，消融使用相同录制；输入哈希因关闭四状态类型检查而变化的关系会在结果文件中保留回放缓存缺失记录。", "");
await fs.writeFile(path.join(root, "summary.md"), summary.join("\n"));
await fs.writeFile(path.join(root, "report-command.txt"), "node --experimental-strip-types packages/conflict-guard/scripts/stage-a3-e1-report.ts\n");
console.log(JSON.stringify({ policies: Object.keys(breakdown), freezeSourceBreakdown: breakdown }));

function splitFreezeSeconds(groups: Group[]): FreezeSourceBreakdown {
  const totals = { localRuleSeconds: 0, modelSeconds: 0, mixedSeconds: 0, totalSeconds: 0 };
  for (const group of groups) {
    const events = [...(group.result.coordinationEvents ?? [])].sort((left, right) => Number(left.at ?? 0) - Number(right.at ?? 0));
    const intervals = group.result.freezeIntervals ?? [];
    const fallbackCutoff = group.outcome.virtualDurationMs && group.outcome.virtualDurationMs > 0 ? group.outcome.virtualDurationMs : group.result.endedAt;
    const targetMs = typeof group.outcome.frozenPersonSeconds === "number" ? group.outcome.frozenPersonSeconds * 1000 : undefined;
    const cutoff = targetMs === undefined ? fallbackCutoff : cutoffForDuration(intervals, group.result.endedAt, targetMs, fallbackCutoff);
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

function unionFreezeDuration(intervals: ReplayResult["freezeIntervals"], endedAt: number, cutoff: number) {
  const actors = new Map<string, Array<[number, number]>>();
  for (const interval of intervals) {
    const end = Math.min(interval.end ?? endedAt, cutoff);
    if (end <= interval.start) continue;
    const key = JSON.stringify(interval.actor);
    const ranges = actors.get(key) ?? [];
    ranges.push([interval.start, end]);
    actors.set(key, ranges);
  }
  let total = 0;
  for (const ranges of actors.values()) {
    let end = -Infinity;
    for (const [start, currentEnd] of ranges.sort((left, right) => left[0] - right[0])) {
      total += Math.max(0, currentEnd - Math.max(start, end));
      end = Math.max(end, currentEnd);
    }
  }
  return total;
}

function cutoffForDuration(intervals: ReplayResult["freezeIntervals"], endedAt: number, targetMs: number, fallback: number) {
  if (unionFreezeDuration(intervals, endedAt, fallback) >= targetMs - 0.01 && unionFreezeDuration(intervals, endedAt, fallback) <= targetMs + 0.01) return fallback;
  let low = 0;
  let high = endedAt;
  if (unionFreezeDuration(intervals, endedAt, high) < targetMs) return fallback;
  for (let iteration = 0; iteration < 50; iteration += 1) {
    const middle = (low + high) / 2;
    if (unionFreezeDuration(intervals, endedAt, middle) < targetMs) low = middle;
    else high = middle;
  }
  return high;
}
