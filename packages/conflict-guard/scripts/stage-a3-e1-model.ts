import fs from "node:fs/promises";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { calculateReplayMetrics, createReplayModelPolicy, replayOutcome, replayTrace, type AdjudicationConfig, type ZoneVerdict } from "../dist/index.js";
import { developmentSamples } from "./model-dataset.ts";
import { replayLibraries } from "./replay-libs.ts";
import { repositoryRoot } from "./model-runtime.ts";

const root = path.join(repositoryRoot, "docs/conflict-guard/experiment/v2/stage-A3");
const selectedStrategy = "G3a" as const;
const modelResultRelativePath = "pair-v5/G3a-final/results.json.gz";
const modelResultPath = path.join(root, modelResultRelativePath);
const outputRoot = path.join(root, "E1-human");
const config = JSON.parse(await fs.readFile(path.join(root, "config.json"), "utf8")) as AdjudicationConfig;
const modelResult = JSON.parse(gunzipSync(await fs.readFile(modelResultPath)).toString()) as { responses: Array<[string, ZoneVerdict]> };
const responses = new Map(modelResult.responses);
const { samples, manifest } = await developmentSamples(path.join(repositoryRoot, "packages/conflict-guard/bench/datasets/d1-v4"));
const libs = await replayLibraries();

async function run(name: string, disableFourState: boolean) {
  const rows = [];
  for (const sample of samples) {
    const policy = createReplayModelPolicy({ ...config, strategy: selectedStrategy }, responses, undefined, Object.keys(sample.variant.baseline));
    const result = replayTrace(sample.trace, { policy, k: 2, seed: sample.group.seed, initialFiles: sample.variant.baseline, libs, ...(disableFourState ? { disableFourState: true } : {}) });
    const outcome = replayOutcome({ truth: sample.label.label as "allow" | "warn" | "lock", variantKind: sample.variant.kind, operatorFamily: sample.group.operator.family, detectability: sample.label.detectability, baseline: sample.variant.baseline, merged: sample.variant.merged, trace: sample.trace, result });
    rows.push({ id: sample.label.id, relationGroupId: sample.group.id, project: sample.group.project, operator: sample.group.operator.id, outcome, result: { ...result, events: undefined } });
  }
  const metrics = calculateReplayMetrics(rows.map((row) => row.outcome));
  const output = path.join(outputRoot, name);
  await fs.mkdir(output, { recursive: true });
  await fs.writeFile(path.join(output, "results.json"), JSON.stringify({ dataset: manifest.version, split: "dev", policy: "P4", disableFourState, responses: responses.size, metrics, groups: rows }, null, 2) + "\n");
  await fs.writeFile(path.join(output, "config.json"), JSON.stringify({ dataset: manifest.version, split: "dev", policy: "P4", strategy: selectedStrategy, source: `stage-A3/${modelResultRelativePath}`, disableFourState, k: 2 }, null, 2) + "\n");
  return { name, metrics, rows };
}

const p4 = await run("P4", false);
const ablation = await run("P4-no-four-state-typecheck", true);
const base = JSON.parse(await fs.readFile(path.join(outputRoot, "base/results.json"), "utf8")) as { policies: Record<string, { metrics: Record<string, unknown>; groups: Array<{ outcome: Record<string, unknown>; result: ReplayResultForReport }> }> };
const metric = (value: unknown) => typeof value === "number" ? `${(value * 100).toFixed(2)}%` : value === null || value === undefined ? "N/A" : String(value);
const rows = ["P0", "P1", "P2", "P3", "P*"].map((id) => ({ id, metrics: base.policies[id]?.metrics, groups: base.policies[id]?.groups ?? [] })).concat([{ id: "P4", metrics: p4.metrics as unknown as Record<string, unknown>, groups: p4.rows }, { id: "P4-no-four-state-typecheck", metrics: ablation.metrics as unknown as Record<string, unknown>, groups: ablation.rows }]);
const freezeBreakdown = Object.fromEntries(rows.filter((row) => row.id === "P3" || row.id === "P4" || row.id === "P4-no-four-state-typecheck").map((row) => [row.id, splitFreezeSeconds(row.groups)]));
await fs.writeFile(path.join(outputRoot, "freeze-source-breakdown.json"), JSON.stringify({ dataset: manifest.version, split: "dev", k: 2, policies: freezeBreakdown }, null, 2) + "\n");
const summary = ["# E1 人与人协作回放", "", `数据集 D1-v4 开发集，k=2。P4 使用阶段 A3 的 ${selectedStrategy} 录制；消融条件关闭四状态类型检查。`, "", "| 策略 | 漏阻断率 | 安全修改误拦率 | 安全修改提醒比例 | 未及时通知的冲突写入 | 冻结人·秒 | 本地决定比例 |", "|---|---:|---:|---:|---:|---:|---:|"];
for (const row of rows) {
  const metrics = row.metrics as any;
  if (!metrics) continue;
  const safeWarning = typeof metrics.variantCounts?.safe === "number" && metrics.variantCounts.safe > 0 ? row.groups.filter((group) => group.outcome.truth === "allow" && group.outcome.decision === "warn").length / metrics.variantCounts.safe : null;
  summary.push(`| ${row.id} | ${metric(metrics.missBlockRatio?.value)} | ${metric(metrics.falseBlockRatio?.value)} | ${metric(safeWarning)} | ${metrics.unnotifiedEscapes ?? "N/A"} | ${typeof metrics.frozenPersonSeconds === "number" ? metrics.frozenPersonSeconds.toFixed(2) : "N/A"} | ${metric(metrics.localDecisionRatio?.value)} |`);
}
for (const id of ["P3", "P4", "P4-no-four-state-typecheck"]) {
  const source = freezeBreakdown[id] as FreezeSourceBreakdown;
  summary.push("", `${id} 冻结时间来源：本地规则 ${source.localRuleSeconds.toFixed(2)} 人·秒，模型研判 ${source.modelSeconds.toFixed(2)} 人·秒，来源重叠 ${source.mixedSeconds.toFixed(2)} 人·秒，合计 ${source.totalSeconds.toFixed(2)} 人·秒。`);
}
summary.push("", `P4 的模型研判结果来自阶段 A3 的 ${selectedStrategy} 录制，消融使用相同录制；若输入哈希因关闭类型检查而变化，回放缓存缺失会在对应结果中记录。`, "");
await fs.writeFile(path.join(outputRoot, "summary.md"), summary.join("\n"));
await fs.writeFile(path.join(outputRoot, "command.txt"), "node --experimental-strip-types packages/conflict-guard/scripts/stage-a3-e1-model.ts\n");
console.log(JSON.stringify({ dataset: manifest.version, samples: samples.length, p4: p4.metrics, ablation: ablation.metrics }));

type ReplayResultForReport = {
  endedAt: number;
  freezeIntervals: Array<{ pairId: string; actor: { kind: string; memberId?: string }; start: number; end?: number }>;
  coordinationEvents: Array<{ type: string; at?: number; pairId?: string; verdict?: { adjudication?: { source?: string } } }>;
};
type FreezeSourceBreakdown = { localRuleSeconds: number; modelSeconds: number; mixedSeconds: number; totalSeconds: number };

function splitFreezeSeconds(groups: Array<{ outcome: Record<string, unknown>; result: ReplayResultForReport }>): FreezeSourceBreakdown {
  const totals = { localRuleSeconds: 0, modelSeconds: 0, mixedSeconds: 0, totalSeconds: 0 };
  for (const group of groups) {
    const intervals = group.result.freezeIntervals ?? [];
    const events = [...(group.result.coordinationEvents ?? [])].sort((left, right) => Number(left.at ?? 0) - Number(right.at ?? 0));
    const byActor = new Map<string, Array<{ start: number; end: number; source: "local" | "model" }>>();
    for (const interval of intervals) {
      const verdict = [...events].reverse().find((event) => event.type === "pair_judged" && event.pairId === interval.pairId && Number(event.at ?? 0) <= interval.start)?.verdict;
      const source = verdict?.adjudication?.source === "fast" || verdict?.adjudication?.source === "deep" ? "model" : "local";
      const key = JSON.stringify(interval.actor);
      const entries = byActor.get(key) ?? [];
      entries.push({ start: interval.start, end: Math.min(interval.end ?? group.result.endedAt, group.result.endedAt), source });
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
