import fs from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readTrace } from "../dist/trace/trace.js";
import { calculateReplayMetrics, replayOutcome, type ReplayGroupOutcome, type ReplayMetrics } from "../dist/replay/metrics.js";
import { replayTrace } from "../dist/replay/engine.js";
import { policyFor, type ZoningPolicy } from "../dist/replay/policies.js";
import type { BenchLabel, BenchManifest } from "../dist/bench/types.js";
import { replayLibraries } from "./replay-libs.ts";

if (process.argv.some((argument) => /^G[0-4](?:,|$)|(?:^|,)G[0-4](?:,|$)/.test(argument))) {
  await new Promise<void>((resolve, reject) => { const child = execFile(process.execPath, ["--experimental-strip-types", fileURLToPath(new URL("adjudication-run.ts", import.meta.url)), ...process.argv.slice(2)], (error) => error ? reject(error) : resolve()); child.stdout?.pipe(process.stdout); child.stderr?.pipe(process.stderr); });
  process.exit(0);
}
const { values } = parseArgs({ args: process.argv.slice(2).filter((item) => item !== "--"), options: { dataset: { type: "string", default: "bench/datasets/d1-v1" }, out: { type: "string" }, split: { type: "string", default: "dev" }, policy: { type: "string", default: "P0,P1,P2,P3,P*" }, repeat: { type: "string", default: "1" } } });
if (!["dev", "holdout"].includes(values.split!)) throw new Error("split 必须为 dev 或 holdout");
const ids = values.policy!.split(",");
if (ids.some((id) => !["P0", "P1", "P2", "P3", "P*"].includes(id))) throw new Error("policy 必须为 P0、P1、P2、P3、P*");
const repeat = Number(values.repeat);
if (!Number.isInteger(repeat) || repeat < 1) throw new Error("repeat 必须为正整数");
const dataset = path.resolve(values.dataset!);
const output = path.resolve(values.out ?? path.join(dataset, "results"));
const manifest = JSON.parse(await fs.readFile(path.join(dataset, "manifest.json"), "utf8")) as BenchManifest;
const labels = JSON.parse(await fs.readFile(path.join(dataset, "labels.json"), "utf8")) as BenchLabel[];
const selected = new Set(values.split === "dev" ? manifest.split.development : manifest.split.holdout);
const libs = await replayLibraries();
const reports: Record<string, { metrics: ReplayMetrics; groups: unknown[]; duplicates: Array<{ id: string; countedAs: string }>; excluded: string[] }> = {};
const startedAt = performance.now();
const timing: { totalMs: number; policies: Record<string, number> } = { totalMs: 0, policies: {} };
for (const id of ids) {
  const policyStartedAt = performance.now();
  const outcomes: ReplayGroupOutcome[] = [];
  const rows: unknown[] = [];
  const programs = new Map<string, { id: string; truth: string }>();
  const duplicates: Array<{ id: string; countedAs: string }> = [];
  const excluded: string[] = [];
  for (const group of manifest.groups.filter((group) => selected.has(group.id))) {
    const groupLabels = labels.filter((label) => label.relationGroupId === group.id);
    if (groupLabels.length === 0) throw new Error(`关系组缺少标签：${group.id}`);
    for (const label of groupLabels) {
      if (label.label === "exclude") { excluded.push(label.id); continue; }
      const variant = group.variants[label.variant];
      if (!variant) throw new Error(`标签没有对应变体：${label.id}`);
      if (variant.aliasOf) { duplicates.push({ id: label.id, countedAs: variant.aliasOf }); continue; }
      const programHash = createHash("sha256").update(JSON.stringify([variant.baseline, variant.leftOnly, variant.rightOnly, variant.merged].map((state) => Object.entries(state).sort(([left], [right]) => left.localeCompare(right))))).digest("hex");
      const previous = programs.get(programHash);
      if (previous) {
        if (previous.truth !== label.label) throw new Error(`相同程序的探针标签不一致：${previous.id}、${label.id}`);
        duplicates.push({ id: label.id, countedAs: previous.id });
        continue;
      }
      programs.set(programHash, { id: label.id, truth: label.label });
      const policy = policyFor(id as ZoningPolicy["id"], { oracleTruth: label.label });
      const text = variant.traceFile ? await fs.readFile(path.join(dataset, variant.traceFile), "utf8") : undefined;
      if (text !== undefined && variant.traceHash && createHash("sha256").update(text).digest("hex") !== variant.traceHash) throw new Error(`轨迹哈希不一致：${variant.id}`);
      const trace = text === undefined ? variant.trace : readTrace(text);
      const result = replayTrace(trace, { policy, seed: group.seed, initialFiles: variant.baseline, libs });
      for (let repetition = 1; repetition < repeat; repetition += 1) if (JSON.stringify(replayTrace(trace, { policy, seed: group.seed, initialFiles: variant.baseline, libs })) !== JSON.stringify(result)) throw new Error(`重复回放结果不一致：${label.id}`);
      const outcome = replayOutcome({ truth: label.label, variantKind: variant.kind, operatorFamily: group.operator.family, detectability: label.detectability, baseline: variant.baseline, merged: variant.merged, trace, result });
      outcomes.push(outcome);
      rows.push({ id: label.id, relationGroupId: group.id, project: group.project, operator: group.operator.id, programHash, outcome, result: { ...result, events: undefined } });
    }
  }
  reports[id] = { metrics: calculateReplayMetrics(outcomes), groups: rows, duplicates, excluded };
  timing.policies[id] = performance.now() - policyStartedAt;
}
timing.totalMs = performance.now() - startedAt;
await fs.mkdir(output, { recursive: true });
await fs.writeFile(path.join(output, "results.json"), JSON.stringify({ dataset: manifest.version, seed: manifest.seed, split: values.split, repeat, policies: reports, timing }, null, 2) + "\n");
await fs.writeFile(path.join(output, "verification.json"), JSON.stringify({ schema: 3, dataset: manifest.version, seed: manifest.seed, split: values.split, repetitions: repeat, selectedRelationGroups: selected.size, programIdentity: "baseline-leftOnly-rightOnly-merged-sha256", oracleConfiguration: { allow: "allow", warn: "lock", lock: "lock", noRelation: "allow" }, policies: Object.fromEntries(Object.entries(reports).map(([id, report]) => [id, { samples: report.metrics.groups, variants: report.metrics.variantCounts, denominators: report.metrics.denominators, duplicates: report.duplicates.length, excluded: report.excluded.length, missingLatencyTriggers: report.metrics.decisionLatencyMs.missingTriggers }])) }, null, 2) + "\n");
const lines = [`# ${values.split === "dev" ? "开发集" : "保留集"}回放`, "", "安全孪生与冲突变体分别计数，相同四状态程序只计一次。漏阻断率以 lock 真值为分母，误阻断率以 allow 真值为分母，逃逸率以 lock 或 warn 真值为分母，区间为 Wilson 95%。本地决定比例按变更对计算，P0、P1、P2、P* 显示 N/A。", "", "| 策略 | 逃逸率 | 相对 P* 的逃逸率差值 | 漏阻断率 | 误阻断率 | 本地决定比例 | 冻结人秒 |", "|---|---:|---:|---:|---:|---:|---:|"];
const oracle = reports["P*"]?.metrics.escapeRatio.value;
for (const [id, { metrics }] of Object.entries(reports)) lines.push(`| ${id} | ${format(metrics.escapeRatio, metrics.denominators.escapeRatio)} | ${oracle === undefined ? "N/A" : ((metrics.escapeRatio.value - oracle) * 100).toFixed(1) + " pp"} | ${format(metrics.missBlockRatio, metrics.denominators.missBlockRatio)} | ${format(metrics.falseBlockRatio, metrics.denominators.falseBlockRatio)} | ${format(metrics.localDecisionRatio)} | ${metrics.frozenPersonSeconds.toFixed(2)} |`);
lines.push("", "逃逸要求冲突合并文本已写入磁盘，且写入之前没有通知或阻止。通知包括 warn、lock 与 T0；晚于写入的通知保留判定前暴露窗口。卡片按 pairId:revision 去重，频率使用第一次到最后一次编辑的时间。算子族、detectability、变体类别与各指标分母见 results.json。", "", "| 策略 | 冲突变体数 | 安全样本数 | 冻结次数 | 被冻结编辑数 | 每小时卡片数 | 冲突延迟 p50/p95 (ms) | 安全延迟 p50/p95 (ms) | 暴露窗口 p50/p95 (ms) | 全程未提示的逃逸数 |", "|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|");
for (const [id, { metrics }] of Object.entries(reports)) {
  const { conflict, safe } = metrics.decisionLatencyMs.byVariant;
  const exposure = metrics.exposureWindowMs;
  lines.push(`| ${id} | ${metrics.variantCounts.conflict} | ${metrics.variantCounts.safe} | ${metrics.freezeCount} | ${metrics.frozenEdits} | ${metrics.cardsPerHour.toFixed(2)} | ${latency(conflict)} | ${latency(safe)} | ${latency(exposure)} | ${metrics.unnotifiedEscapes} |`);
}
lines.push("");
await fs.writeFile(path.join(output, "summary.md"), lines.join("\n"));
const maxCards = Math.max(1, ...Object.values(reports).map((report) => report.metrics.cardsPerHour));
const points = Object.entries(reports).map(([id, { metrics }]) => { const x = 65 + metrics.cardsPerHour / maxCards * 340; const y = 245 - metrics.escapeRatio.value * 200; return `<circle cx="${x}" cy="${y}" r="5" fill="#225588"/><text x="${x + 8}" y="${y - 6}" font-size="12">${id}</text>`; }).join("");
await fs.writeFile(path.join(output, "interruptions.svg"), `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="300" viewBox="0 0 480 300"><rect width="480" height="300" fill="white"/><path d="M60 35 V250 H435" fill="none" stroke="black"/><text x="150" y="287">Cards per hour (0 to ${maxCards.toFixed(1)})</text><text x="10" y="20">Escape ratio (0 to 1)</text>${points}</svg>\n`);
console.log(JSON.stringify({ output, split: values.split, groups: Object.fromEntries(Object.entries(reports).map(([id, report]) => [id, report.metrics.groups])) }));
function format(interval: { value: number; low: number; high: number } | null, denominator?: number) { return interval && denominator !== 0 ? `${(interval.value * 100).toFixed(1)}% [${(interval.low * 100).toFixed(1)}, ${(interval.high * 100).toFixed(1)}]` : "N/A"; }
function latency(value: { samples: number; p50: number; p95: number }) { return value.samples === 0 ? "N/A" : `${value.p50.toFixed(0)}/${value.p95.toFixed(0)}`; }
