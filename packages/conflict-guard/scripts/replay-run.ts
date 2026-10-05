import fs from "node:fs/promises";
import path from "node:path";
import { readTrace } from "../dist/trace/trace.js";
import { calculateReplayMetrics, type ReplayGroupOutcome } from "../dist/replay/metrics.js";
import { replayTrace } from "../dist/replay/engine.js";
import { policyFor, type ZoningPolicy } from "../dist/replay/policies.js";
import type { BenchLabel, BenchManifest } from "../dist/bench/types.js";

const args = parseArgs(process.argv.slice(2));
const dataset = path.resolve(args.dataset ?? "bench/datasets/d1-v1");
const output = path.resolve(args.out ?? path.join(dataset, "results"));
const split = (args.split ?? "dev") as "dev" | "holdout";
const policies = (args.policy ?? "P0,P1,P2,P3").split(",").filter(Boolean).map((id) => policyFor(id as ZoningPolicy["id"]));
const manifest = JSON.parse(await fs.readFile(path.join(dataset, "manifest.json"), "utf8")) as BenchManifest;
const labels = JSON.parse(await fs.readFile(path.join(dataset, "labels.json"), "utf8")) as BenchLabel[];
const selected = new Set(split === "dev" ? manifest.split.development : manifest.split.holdout);
await fs.mkdir(output, { recursive: true });
const reports: Record<string, unknown> = {};
for (const policy of policies) {
  const outcomes: ReplayGroupOutcome[] = [];
  const rows: unknown[] = [];
  for (const label of labels.filter((item) => selected.has(item.relationGroupId))) {
    const group = manifest.groups.find((item) => item.id === label.relationGroupId);
    if (!group) continue;
    const variant = group.variants[label.variant];
    const trace = readTrace(variant.trace.map((event) => JSON.stringify(event)));
    const result = replayTrace(trace, { policy, seed: group.seed });
    const decision = result.judgements.at(-1)?.verdict.decision ?? "allow";
    const truth = label.label === "exclude" ? "allow" : label.label;
    const frozenPersonSeconds = result.freezeIntervals.reduce((sum, interval) => sum + Math.max(0, (interval.end ?? trace.at(-1)?.at ?? 0) - interval.start) / 1000, 0);
    const outcome: ReplayGroupOutcome = { truth, decision, local: true, escaped: truth === "lock" && decision !== "lock", missed: truth === "lock" && decision !== "lock", overblocked: truth !== "lock" && decision === "lock", frozenPersonSeconds, cardCount: result.judgements.filter((judgement) => judgement.verdict.decision === "lock").length, latencyMs: result.judgements.at(-1)?.at, virtualDurationMs: Math.max(0, (trace.at(-1)?.at ?? 0) - (trace[0]?.at ?? 0)), hasRelation: result.judgements.length > 0, operatorFamily: group.operator.family, detectability: label.detectability };
    outcomes.push(outcome);
    rows.push({ id: label.id, relationGroupId: label.relationGroupId, truth, decision, result });
  }
  reports[policy.id] = { metrics: calculateReplayMetrics(outcomes), groups: rows };
}
const result = { dataset, split, policies: reports, timing: {} };
await fs.writeFile(path.join(output, "results.json"), `${JSON.stringify(result, null, 2)}\n`, "utf8");
await fs.writeFile(path.join(output, "summary.md"), markdownSummary(reports), "utf8");
await fs.writeFile(path.join(output, "interruptions.svg"), scatterSvg(reports), "utf8");
console.log(JSON.stringify({ output, split, policies: policies.map((policy) => policy.id) }));

function markdownSummary(reports: Record<string, unknown>) {
  const lines = ["# 阶段 4 开发集回放", "", "| 策略 | 逃逸率 | 漏阻断率 | 误阻断率 | 本地决定比例 | 冻结人秒 |", "|---|---:|---:|---:|---:|---:|"];
  for (const id of Object.keys(reports).sort()) {
    const metrics = (reports[id] as { metrics: { escapeRatio: { value: number }; missBlockRatio: { value: number }; falseBlockRatio: { value: number }; localDecisionRatio: { value: number }; frozenPersonSeconds: number } }).metrics;
    lines.push(`| ${id} | ${format(metrics.escapeRatio.value)} | ${format(metrics.missBlockRatio.value)} | ${format(metrics.falseBlockRatio.value)} | ${format(metrics.localDecisionRatio.value)} | ${metrics.frozenPersonSeconds.toFixed(2)} |`);
  }
  return `${lines.join("\n")}\n`;
}

function scatterSvg(reports: Record<string, unknown>) {
  const points = Object.keys(reports).sort().map((id, index) => {
    const metrics = (reports[id] as { metrics: { escapeRatio: { value: number } } }).metrics;
    return `<circle cx="${40 + index * 70}" cy="${180 - metrics.escapeRatio.value * 140}" r="5"><title>${id}</title></circle>`;
  }).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="420" height="220" viewBox="0 0 420 220"><rect width="100%" height="100%" fill="white"/><line x1="30" y1="180" x2="390" y2="180" stroke="black"/><line x1="30" y1="20" x2="30" y2="180" stroke="black"/>${points}</svg>\n`;
}

function format(value: number) { return `${(value * 100).toFixed(1)}%`; }
function parseArgs(argv: string[]) { const result: Record<string, string> = {}; for (let index = 0; index < argv.length; index += 1) if (argv[index]?.startsWith("--")) result[argv[index]!.slice(2)] = argv[index + 1] ?? ""; return result; }
