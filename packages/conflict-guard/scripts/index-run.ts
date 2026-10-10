import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { parseArgs } from "node:util";
import { createSemanticIndex, MemoryFileProvider, SemanticChangeTracker, ConflictGuardTracker, VirtualClock, readTrace, latencySummary, wilson, type ActorRef, type TextEditOp } from "../dist/index.js";
import type { BenchManifest, BenchLabel } from "../src/bench/types.ts";
import { replayLibraries } from "./replay-libs.ts";
import { createExperimentBudget } from "./experiment-budget.ts";

const { values } = parseArgs({ options: { dataset: { type: "string", default: "bench/datasets/d1-v3" }, split: { type: "string", default: "dev" }, samples: { type: "string" }, k: { type: "string", default: "1,2,3" }, out: { type: "string", default: "../../docs/conflict-guard/experiment/X2" }, plan: { type: "boolean", default: false }, experiment: { type: "string" } } });
if (!["dev", "holdout", "all"].includes(values.split!)) throw new Error("split 无效");
const hops = values.k!.split(",").map(Number);
if (!hops.length || hops.some((k) => ![1, 2, 3].includes(k))) throw new Error("k 必须为 1、2 或 3");
const dataset = path.resolve(values.dataset!);
const manifest = JSON.parse(await fs.readFile(path.join(dataset, "manifest.json"), "utf8")) as BenchManifest;
const labels = JSON.parse(await fs.readFile(path.join(dataset, "labels.json"), "utf8")) as BenchLabel[];
const groups = manifest.groups.filter((group) => values.split === "all" || group.split === values.split);
if (values.plan) { console.log(JSON.stringify({ dataset: manifest.version, split: values.split, k: hops, relationGroups: groups.length, calls: 0, executed: false })); process.exit(0); }
if (values.split !== "dev" && !values.experiment) throw new Error("保留集索引测量必须获得冻结确认");
if (values.experiment) await createExperimentBudget(values.experiment);
const libraries = await replayLibraries();
const rows: Array<Record<string, unknown> & { k: number; stratum: string; fullMs: number; incrementalMs: number[]; total: number; unrelated: number; candidatePairs: number }> = [];
const programs = new Set<string>();
for (const group of groups) for (const label of labels.filter((label) => label.relationGroupId === group.id && label.label !== "exclude")) {
  const variant = group.variants[label.variant];
  if (values.samples && !values.samples.split(",").includes(label.id)) continue;
  if (variant.aliasOf) continue;
  const fingerprint = createHash("sha256").update(JSON.stringify([variant.baseline, variant.leftOnly, variant.rightOnly, variant.merged].map((state) => Object.entries(state).sort(([a], [b]) => a.localeCompare(b))))).digest("hex");
  if (programs.has(fingerprint)) continue;
  programs.add(fingerprint);
  const sourceLines = Object.entries(variant.baseline).filter(([file]) => !file.startsWith("test/") && /\.[cm]?[jt]sx?$/.test(file)).reduce((sum, [, text]) => sum + text.split("\n").filter((line) => line.trim()).length, 0);
  const stratum = sourceLines < 300 ? "under-300" : sourceLines < 320 ? "300-319" : sourceLines < 340 ? "320-339" : "340+";
  const raw = variant.traceFile ? await fs.readFile(path.join(dataset, variant.traceFile), "utf8") : undefined;
  if (raw && variant.traceHash !== createHash("sha256").update(raw).digest("hex")) throw new Error("轨迹哈希不一致");
  const trace = raw ? readTrace(raw) : variant.trace;
  for (const k of hops) {
    const files = new MemoryFileProvider(variant.baseline, libraries);
    const clock = new VirtualClock();
    const index = createSemanticIndex({ files, now: () => performance.now() });
    const fullMs = index.update().durationMs;
    const tracker = new ConflictGuardTracker({ clock, ...((trace.find((event) => event.type === "session_start")?.config ?? {}) as Record<string, number>) });
    const semantic = new SemanticChangeTracker({ index, readFile: (file) => files.readFile(file), now: () => clock.now(), maxHops: k });
    const incrementalMs: number[] = [];
    const candidates = new Set<string>();
    const audit: unknown[] = [];
    semantic.onEvent((event) => {
      if (event.type === "pair_candidate_opened") candidates.add(event.pair.id);
      if (event.type === "change_unit" || event.type === "pair_candidate_opened") audit.push({ ...event, at: clock.now() });
    });
    tracker.onEvent((event) => {
      if (event.type === "change_set_closed") { semantic.update(tracker.getActiveChangeSets()); return; }
      if (event.type !== "batch_closed") return;
      semantic.captureStaleEdges(tracker.getActiveChangeSets());
      incrementalMs.push(index.update([event.batch.file]).durationMs);
      semantic.update(tracker.getActiveChangeSets(), [{ batch: event.batch }]);
    });
    for (const [file, text] of Object.entries(variant.baseline)) tracker.openDocument(file, text);
    for (const event of trace) {
      clock.advanceTo(event.at);
      if (event.type === "cursor") {
        const position = event.position as { lineNumber: number; column: number };
        tracker.cursorChanged({ actor: { kind: "human", memberId: String(event.memberId) }, file: String(event.file), ...position, at: event.at });
      }
      if (event.type === "ui_action" && event.action === "change_set_done") tracker.markDone({ kind: "human", memberId: String(event.memberId) });
      if (event.type !== "edit") continue;
      const file = String(event.file); const before = files.readFile(file); const ops = event.ops as TextEditOp[];
      let after = before; let offset = 0;
      for (const op of ops) { const from = op.from + offset; if (after.slice(from, from + op.deleted.length) !== op.deleted) throw new Error("索引测量的编辑文本不一致"); after = after.slice(0, from) + op.inserted + after.slice(from + op.deleted.length); offset += op.inserted.length - op.deleted.length; }
      files.set(file, after);
      tracker.edit({ file, origin: event.origin as ActorRef, at: event.at, textBefore: before, textAfter: after, ops, revisionAfter: Number(event.revisionAfter ?? 0) });
    }
    clock.advanceTo(clock.now() + 5025);
    const statistics = semantic.statistics();
    rows.push({ id: label.id, relationGroupId: group.id, project: group.project, sourceLines, stratum, k, fullMs, incrementalMs, candidatePairs: candidates.size, ...statistics, audit });
  }
}
const summary = hops.flatMap((k) => ["300-319", "320-339", "340+", "under-300"].flatMap((stratum) => {
  const selected = rows.filter((row) => row.k === k && row.stratum === stratum);
  if (!selected.length) return [];
  const total = selected.reduce((sum, row) => sum + row.total, 0); const unrelated = selected.reduce((sum, row) => sum + row.unrelated, 0);
  return [{ k, stratum, samples: selected.length, total, unrelated, noRelationRatio: wilson(unrelated, total), candidatePairs: selected.reduce((sum, row) => sum + row.candidatePairs, 0), full: latencySummary(selected.map((row) => row.fullMs)), incremental: latencySummary(selected.flatMap((row) => row.incrementalMs)) }];
}));
const output = path.resolve(values.out!); await fs.mkdir(output, { recursive: true });
await fs.writeFile(path.join(output, "raw.json"), JSON.stringify({ dataset: manifest.version, split: values.split, rows, summary }, null, 2) + "\n");
await fs.writeFile(path.join(output, "command.txt"), `pnpm --filter @simplercp/conflict-guard index:run ${process.argv.slice(2).join(" ")}\n`);
await fs.writeFile(path.join(output, "config.json"), JSON.stringify({ dataset: manifest.version, split: values.split, k: hops, indexingUnit: "closed-edit-batch", fullBuildUnit: "unique-four-state-program", sourceSize: "nonempty-source-lines-excluding-tests" }, null, 2) + "\n");
const lines = ["# 候选生成与索引开销", "", "索引在每个唯一四状态程序上全量构建一次，在真实输入轨迹的每个关闭批次上更新一次。候选数量按整条轨迹的不同 pairId 计数；无关系比例使用变更单元数量。", "", "| k | 源码行数 | 样本数 | 无关系单元 / 总单元 | 候选对数 | 全量 p50 / p95 ms | 增量 p50 / p95 ms |", "|---|---|---:|---:|---:|---:|---:|"];
for (const row of summary) lines.push(`| ${row.k} | ${row.stratum} | ${row.samples} | ${row.unrelated}/${row.total} | ${row.candidatePairs} | ${row.full.p50.toFixed(2)}/${row.full.p95.toFixed(2)} | ${row.incremental.p50.toFixed(2)}/${row.incremental.p95.toFixed(2)} |`);
await fs.writeFile(path.join(output, "summary.md"), lines.join("\n") + "\n");
console.log(JSON.stringify({ output, samples: rows.length, summary }));
