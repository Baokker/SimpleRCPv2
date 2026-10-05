import fs from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { createHash } from "node:crypto";
import { replayTrace } from "../dist/replay/engine.js";
import { MemoryFileProvider } from "../dist/replay/files.js";
import { createSemanticIndex } from "../dist/semantic/index.js";
import type { TraceEvent } from "../dist/trace/trace.js";
import { replayLibraries } from "./replay-libs.ts";

interface LegacySide { path: string; before: string; after: string }
interface LegacyGroup { id: string; origin: LegacySide; candidate: LegacySide; variants: Array<{ id: string; after: string; label: { expectedDecision: string } }> }
interface LegacyDataset { id: string; sources: Array<{ id: string; groups: LegacyGroup[] }> }
const { values } = parseArgs({ options: { source: { type: "string", default: "../../../collaboration-tools" }, out: { type: "string", default: "bench/datasets/d2-greylock" } } });
const source = path.resolve(values.source!);
const output = path.resolve(values.out!);
const selection = JSON.parse(await fs.readFile(path.join(source, "experiments/greylock-counterfactual-pair-v1.5/selection.json"), "utf8")) as { sourceDatasets: Array<{ path: string; sha256: string }>; excludedCaseIds: string[] };
const libraries = await replayLibraries();
const auditText = await fs.readFile(path.join(source, "reports/greylock-local-routing-coverage-v2-20261001054227.json"), "utf8");
const audit = JSON.parse(auditText) as { datasets: Array<{ rows: Array<{ id: string; zone: "white" | "black" | "grey"; reason: string; expectedDecision: string }> }> };
const auditRows = new Map(audit.datasets.flatMap((dataset) => dataset.rows).map((row) => [row.id, row]));
const rows: Array<Record<string, unknown>> = [];
await fs.mkdir(path.join(output, "traces"), { recursive: true });
for (const entry of [...selection.sourceDatasets, { path: "experiments/greylock-independent-pair-holdout-v2/dataset.json", sha256: "" }]) {
  const text = await fs.readFile(path.join(source, entry.path), "utf8");
  if (entry.sha256 && hash(text) !== entry.sha256) throw new Error(`GreyLock 来源哈希不一致：${entry.path}`);
  const dataset = JSON.parse(text) as LegacyDataset;
  for (const project of dataset.sources) for (const group of project.groups) for (const variant of group.variants) {
    const id = `${group.id}-${variant.id}`;
    if (selection.excludedCaseIds.includes(id)) continue;
    const baseline = combine(group.origin, group.candidate, false, false, variant.after);
    const left = combine(group.origin, group.candidate, true, false, variant.after);
    const merged = combine(group.origin, group.candidate, true, true, variant.after);
    const trace = snapshotsTrace(baseline, left, merged);
    rows.push(await writeCase(id, trace, variant.label.expectedDecision, dataset.id, "rule-case"));
  }
}
if (rows.length !== 51) throw new Error(`GreyLock 案例数量错误：${rows.length}`);
const scenarioRoot = path.join(source, "experiments/greylock-replay-v1/cases");
for (const name of (await fs.readdir(scenarioRoot)).sort()) {
  const directory = path.join(scenarioRoot, name);
  const item = JSON.parse(await fs.readFile(path.join(directory, "case.json"), "utf8")) as { caseId: string; expectedDecision: string; participants: Array<{ path: string; beforeFile: string; afterFile: string }> };
  const baseline: Record<string, string> = {}; const left: Record<string, string> = {}; const merged: Record<string, string> = {};
  for (const [index, participant] of item.participants.entries()) {
    const before = await fs.readFile(path.join(directory, participant.beforeFile), "utf8");
    const after = await fs.readFile(path.join(directory, participant.afterFile), "utf8");
    baseline[participant.path] = before; left[participant.path] = index === 0 ? after : before; merged[participant.path] = after;
  }
  rows.push(await writeCase(item.caseId, snapshotsTrace(baseline, left, merged), item.expectedDecision, "greylock-replay-v1", "delivery-scenario"));
}
await fs.writeFile(path.join(output, "manifest.json"), JSON.stringify({ version: "d2-greylock-v1", schema: 3, caseCount: 51, scenarios: 6, generationCommand: "bench:import-greylock --source <GreyLock directory>", cases: rows }, null, 2) + "\n");
await fs.writeFile(path.join(output, "replay-results.json"), JSON.stringify(rows.map(({ id, sourceDecision, sourceTruth, actual, category, unavailable, matched }) => ({ id, sourceDecision, sourceTruth, actual, category, unavailable, matched })), null, 2) + "\n");
console.log(JSON.stringify({ cases: rows.filter((row) => row.category === "rule-case").length, scenarios: rows.filter((row) => row.category === "delivery-scenario").length, output }));

function combine(left: LegacySide, right: LegacySide, leftChanged: boolean, rightChanged: boolean, rightAfter: string) {
  const first = leftChanged ? left.after : left.before;
  const second = rightChanged ? rightAfter : right.before;
  return left.path === right.path ? { [left.path]: `${first}\n${second}\n` } : { [left.path]: `${first}\n`, [right.path]: `${second}\n` };
}
function snapshotsTrace(baseline: Record<string, string>, left: Record<string, string>, merged: Record<string, string>) {
  const events: TraceEvent[] = [{ schema: 3, seq: 1, at: 0, type: "session_start", mode: "rules", config: { idleMs: 1500, activeIdleMs: 600000 } }];
  for (const [file, text] of Object.entries(baseline).sort(([a], [b]) => a.localeCompare(b))) events.push({ schema: 3, seq: events.length + 1, at: 0, type: "doc_open", file, text, textHash: hash(text) });
  for (const [before, after, actor, at] of [[baseline, left, "origin", 100], [left, merged, "candidate", 300]] as const) for (const file of Object.keys(after).sort()) {
    const oldText = before[file] ?? ""; const newText = after[file]!;
    if (oldText === newText) continue;
    let start = 0; while (start < oldText.length && start < newText.length && oldText[start] === newText[start]) start += 1;
    let end = 0; while (end < oldText.length - start && end < newText.length - start && oldText[oldText.length - end - 1] === newText[newText.length - end - 1]) end += 1;
    events.push({ schema: 3, seq: events.length + 1, at, type: "edit", file, origin: { kind: "human", memberId: actor }, ops: [{ from: start, deleted: oldText.slice(start, oldText.length - end), inserted: newText.slice(start, newText.length - end) }], revisionAfter: actor === "origin" ? 1 : 2 });
  }
  return events;
}
async function writeCase(id: string, trace: TraceEvent[], sourceDecision: string, dataset: string, category: string) {
  const sourceTruth = sourceDecision;
  const audited = auditRows.get(id);
  if (category === "rule-case" && !audited) throw new Error(`GreyLock 案例缺少本地分区记录：${id}`);
  if (audited) sourceDecision = audited.zone === "white" ? "allow" : audited.zone === "black" ? "lock" : "warn";
  const text = trace.map((event) => JSON.stringify(event)).join("\n") + "\n";
  if (/\bsk-[A-Za-z0-9_-]{12,}/.test(text)) throw new Error("来源包含受限制的敏感值");
  await fs.writeFile(path.join(output, "traces", `${id}.jsonl`), text);
  const result = replayTrace(trace, { policy: "P3", libs: libraries });
  const actors = new Set(trace.filter((event) => event.type === "edit").map((event) => (event.origin as { memberId: string }).memberId));
  const files = new MemoryFileProvider(result.finalTexts);
  const index = createSemanticIndex({ files, now: () => 0 }); index.update();
  const symbols = files.listFiles().flatMap((file) => index.symbolsInFile(file).map((symbol) => symbol.key));
  const crossFilePaths = index.findPaths(symbols, symbols, 2).filter((relation) => relation.from.split("#")[0] !== relation.to.split("#")[0]);
  const unavailable = result.judgements.length ? undefined : actors.size < 2 ? "one-side-unchanged" : crossFilePaths.length === 0 ? "no-static-relation" : "no-active-symbol-pair";
  const actual = result.judgements.map((event) => ({ ruleId: event.verdict.ruleId, decision: event.verdict.decision, revision: event.revision }));
  return { id, sourceDataset: dataset, sourceDecision, sourceTruth, sourceRule: audited?.reason, category, trace: `traces/${id}.jsonl`, hash: hash(text), unavailable, actual, matched: actual.length > 0 && actual.at(-1)!.decision === sourceDecision };
}
function hash(text: string) { return createHash("sha256").update(text).digest("hex"); }
