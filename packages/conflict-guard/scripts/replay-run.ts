import fs from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { createHash } from "node:crypto";
import { readTrace } from "../dist/trace/trace.js";
import { calculateReplayMetrics, type ReplayGroupOutcome, type ReplayMetrics } from "../dist/replay/metrics.js";
import { replayTrace, type ReplayResult } from "../dist/replay/engine.js";
import { policyFor, type ZoningPolicy } from "../dist/replay/policies.js";
import type { BenchLabel, BenchManifest } from "../dist/bench/types.js";
import { replayLibraries } from "./replay-libs.ts";

const { values } = parseArgs({ args: process.argv.slice(2).filter((item) => item !== "--"), options: { dataset: { type: "string", default: "bench/datasets/d1-v1" }, out: { type: "string" }, split: { type: "string", default: "dev" }, policy: { type: "string", default: "P0,P1,P2,P3" }, repeat: { type: "string", default: "1" } } });
if (!["dev", "holdout"].includes(values.split!)) throw new Error("split 必须为 dev 或 holdout");
const ids = values.policy!.split(",");
if (ids.some((id) => !["P0", "P1", "P2", "P3"].includes(id))) throw new Error("policy 必须为 P0、P1、P2、P3");
const repeat = Number(values.repeat);
if (!Number.isInteger(repeat) || repeat < 1) throw new Error("repeat 必须为正整数");
const dataset = path.resolve(values.dataset!);
const output = path.resolve(values.out ?? path.join(dataset, "results"));
const manifest = JSON.parse(await fs.readFile(path.join(dataset, "manifest.json"), "utf8")) as BenchManifest;
const labels = JSON.parse(await fs.readFile(path.join(dataset, "labels.json"), "utf8")) as BenchLabel[];
const selected = new Set(values.split === "dev" ? manifest.split.development : manifest.split.holdout);
const libs = await replayLibraries();
const reports: Record<string, { metrics: ReplayMetrics; groups: unknown[] }> = {};
const startedAt = performance.now();
const timing: { totalMs: number; policies: Record<string, number> } = { totalMs: 0, policies: {} };
for (const id of ids) {
  const policyStartedAt = performance.now();
  const policy = policyFor(id as ZoningPolicy["id"]);
  const outcomes: ReplayGroupOutcome[] = [];
  const rows: unknown[] = [];
  for (const group of manifest.groups.filter((group) => selected.has(group.id))) {
    const groupLabels = labels.filter((label) => label.relationGroupId === group.id);
    if (groupLabels.length !== 2) throw new Error(`关系组缺少标签：${group.id}`);
    if (groupLabels.some((label) => label.label === "exclude")) continue;
    const variants = [];
    for (const label of groupLabels) {
      const variant = group.variants[label.variant];
      const text = variant.traceFile ? await fs.readFile(path.join(dataset, variant.traceFile), "utf8") : undefined;
      if (text !== undefined && variant.traceHash && createHash("sha256").update(text).digest("hex") !== variant.traceHash) throw new Error(`轨迹哈希不一致：${variant.id}`);
      const trace = text === undefined ? variant.trace : readTrace(text);
      const result = replayTrace(trace, { policy, seed: group.seed, initialFiles: variant.baseline, libs });
      for (let repetition = 1; repetition < repeat; repetition += 1) if (JSON.stringify(replayTrace(trace, { policy, seed: group.seed, initialFiles: variant.baseline, libs })) !== JSON.stringify(result)) throw new Error(`重复回放结果不一致：${label.id}`);
      const decisions = result.judgements.map((item) => item.verdict.decision);
      const decision = strongest(decisions);
      const firstEdits = new Map<string, number>();
      for (const event of trace) if (event.type === "edit") { const actor = JSON.stringify(event.origin); if (!firstEdits.has(actor)) firstEdits.set(actor, event.at); }
      const triggerAt = Math.max(...firstEdits.values());
      const state = { ...variant.baseline };
      const changedFiles = Object.keys(variant.merged).filter((file) => variant.merged[file] !== variant.baseline[file]);
      let escaped = false;
      for (const write of result.persisted) {
        if (write.counterfactual) continue;
        state[write.file] = write.text;
        if (label.label === "lock" && changedFiles.every((file) => state[file] === variant.merged[file])) escaped = true;
      }
      variants.push({ id: label.id, truth: label.label as "allow" | "warn" | "lock", decision, escaped, local: result.judgements.every((item) => item.verdict.zone !== "grey"), frozenPersonSeconds: personSeconds(result), cards: result.judgements.filter((item) => item.verdict.decision === "lock").length * 2, latency: result.judgements[0] ? result.judgements[0].at - triggerAt : undefined, duration: result.endedAt - trace[0]!.at, result: { ...result, events: undefined } });
    }
    const outcome: ReplayGroupOutcome = { truth: strongest(variants.map((item) => item.truth)), decision: strongest(variants.map((item) => item.decision)), agreed: variants.every((item) => item.truth === item.decision), local: variants.every((item) => item.local), escaped: variants.some((item) => item.escaped), missed: variants.some((item) => item.truth === "lock" && item.decision !== "lock"), overblocked: variants.some((item) => item.truth !== "lock" && item.decision === "lock"), frozenPersonSeconds: variants.reduce((sum, item) => sum + item.frozenPersonSeconds, 0), cardCount: variants.reduce((sum, item) => sum + item.cards, 0), latencyMs: variants.flatMap((item) => item.latency === undefined ? [] : [item.latency]).at(-1), virtualDurationMs: variants.reduce((sum, item) => sum + item.duration, 0), hasRelation: variants.some((item) => item.result.semanticRelations > 0), operatorFamily: group.operator.family, detectability: groupLabels.find((label) => label.detectability !== "none")?.detectability ?? "none" };
    outcomes.push(outcome); rows.push({ id: group.id, operator: group.operator.id, outcome, variants });
  }
  reports[policy.id] = { metrics: calculateReplayMetrics(outcomes), groups: rows };
  timing.policies[policy.id] = performance.now() - policyStartedAt;
}
timing.totalMs = performance.now() - startedAt;
await fs.mkdir(output, { recursive: true });
await fs.writeFile(path.join(output, "results.json"), JSON.stringify({ dataset: manifest.version, seed: manifest.seed, split: values.split, repeat, policies: reports, timing }, null, 2) + "\n");
const lines = ["# 开发集回放", "", "每个关系组包含两个变体；整组剔除后计算指标。比例的分母均为保留的关系组，区间为 Wilson 95%。", "", "| 策略 | 逃逸率 | 漏阻断率 | 误阻断率 | 本地决定比例 | 冻结人秒 |", "|---|---:|---:|---:|---:|---:|"];
for (const [id, { metrics }] of Object.entries(reports)) lines.push(`| ${id} | ${format(metrics.escapeRatio)} | ${format(metrics.missBlockRatio)} | ${format(metrics.falseBlockRatio)} | ${format(metrics.localDecisionRatio)} | ${metrics.frozenPersonSeconds.toFixed(2)} |`);
lines.push("", "逃逸记录共享文本经 300 毫秒写入防抖进入持久状态的情况。判定为 lock 与提前阻止持久化分别计算。算子族与 detectability 分组见 results.json。", "");
await fs.writeFile(path.join(output, "summary.md"), lines.join("\n"));
const maxCards = Math.max(1, ...Object.values(reports).map((report) => report.metrics.cardsPerHour));
const points = Object.entries(reports).map(([id, { metrics }]) => { const x = 65 + metrics.cardsPerHour / maxCards * 340; const y = 245 - metrics.escapeRatio.value * 200; return `<circle cx="${x}" cy="${y}" r="5" fill="#225588"/><text x="${x + 8}" y="${y - 6}" font-size="12">${id}</text>`; }).join("");
await fs.writeFile(path.join(output, "interruptions.svg"), `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="300" viewBox="0 0 480 300"><rect width="480" height="300" fill="white"/><path d="M60 35 V250 H435" fill="none" stroke="black"/><text x="150" y="287">Cards per hour (0 to ${maxCards.toFixed(1)})</text><text x="10" y="20">Escape ratio (0 to 1)</text>${points}</svg>\n`);
console.log(JSON.stringify({ output, split: values.split, groups: Object.fromEntries(Object.entries(reports).map(([id, report]) => [id, report.metrics.groups])) }));
function strongest(decisions: Array<"allow" | "warn" | "lock">) { return decisions.includes("lock") ? "lock" : decisions.includes("warn") ? "warn" : "allow"; }
function format(interval: { value: number; low: number; high: number }) { return `${(interval.value * 100).toFixed(1)}% [${(interval.low * 100).toFixed(1)}, ${(interval.high * 100).toFixed(1)}]`; }
function personSeconds(result: ReplayResult) {
  const actors = new Map<string, Array<[number, number]>>();
  for (const interval of result.freezeIntervals) { const key = JSON.stringify(interval.actor); const list = actors.get(key) ?? []; list.push([interval.start, interval.end ?? result.endedAt]); actors.set(key, list); }
  let milliseconds = 0;
  for (const ranges of actors.values()) { let end = -Infinity; for (const [from, to] of ranges.sort((a, b) => a[0] - b[0])) { milliseconds += Math.max(0, to - Math.max(from, end)); end = Math.max(end, to); } }
  return milliseconds / 1000;
}
