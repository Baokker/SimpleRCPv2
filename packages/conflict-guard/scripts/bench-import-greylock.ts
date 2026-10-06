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
const expectedHashes = JSON.parse(await fs.readFile(new URL("../bench/datasets/d2-greylock/source-hashes.json", import.meta.url), "utf8")) as Record<string, string>;
const verifiedSources = new Map<string, string>();
const selection = JSON.parse(await readSource("experiments/greylock-counterfactual-pair-v1.5/selection.json")) as { sourceDatasets: Array<{ path: string; sha256: string }>; excludedCaseIds: string[] };
const libraries = await replayLibraries();
const auditText = await readSource("reports/greylock-local-routing-coverage-v2-20261001054227.json");
const audit = JSON.parse(auditText) as { datasets: Array<{ rows: Array<{ id: string; zone: "white" | "black" | "grey"; reason: string; expectedDecision: string }> }> };
const auditRows = new Map(audit.datasets.flatMap((dataset) => dataset.rows).map((row) => [row.id, row]));
const rows: Array<Record<string, unknown>> = [];
await fs.mkdir(path.join(output, "traces"), { recursive: true });
for (const entry of [...selection.sourceDatasets, { path: "experiments/greylock-independent-pair-holdout-v2/dataset.json", sha256: expectedHashes["experiments/greylock-independent-pair-holdout-v2/dataset.json"] }]) {
  if (!entry.sha256 || !/^[a-f0-9]{64}$/.test(entry.sha256)) throw new Error(`GreyLock 来源缺少 SHA-256：${entry.path}`);
  const text = await readSource(entry.path);
  if (hash(text) !== entry.sha256) throw new Error(`GreyLock 来源哈希不一致：${entry.path}`);
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
  const relative = path.posix.join("experiments/greylock-replay-v1/cases", name);
  const item = JSON.parse(await readSource(path.posix.join(relative, "case.json"))) as { caseId: string; expectedDecision: string; participants: Array<{ path: string; beforeFile: string; afterFile: string }> };
  const baseline: Record<string, string> = {}; const left: Record<string, string> = {}; const merged: Record<string, string> = {};
  for (const [index, participant] of item.participants.entries()) {
    const before = await readSource(path.posix.join(relative, participant.beforeFile));
    const after = await readSource(path.posix.join(relative, participant.afterFile));
    baseline[participant.path] = before; left[participant.path] = index === 0 ? after : before; merged[participant.path] = after;
  }
  rows.push(await writeCase(item.caseId, snapshotsTrace(baseline, left, merged), item.expectedDecision, "greylock-replay-v1", "delivery-scenario"));
}
const sources = Object.fromEntries([...verifiedSources].sort(([left], [right]) => left.localeCompare(right)));
await fs.writeFile(path.join(output, "manifest.json"), JSON.stringify({ version: "d2-greylock-v1", schema: 3, caseCount: 51, scenarios: 6, generationCommand: "bench:import-greylock --source <GreyLock directory>", sources, cases: rows }, null, 2) + "\n");
await fs.writeFile(path.join(output, "replay-results.json"), JSON.stringify(rows.map(({ id, sourceDecision, sourceTruth, actual, category, unavailable, matched }) => ({ id, sourceDecision, sourceTruth, actual, category, unavailable, matched })), null, 2) + "\n");
await fs.writeFile(path.join(output, "source-report.json"), auditText);
await fs.writeFile(path.join(output, "labels.json"), JSON.stringify(rows.filter((row) => row.category === "rule-case").map((row) => ({ id: row.id, datasetId: row.sourceDataset, label: row.sourceTruth, zone: auditRows.get(String(row.id))!.zone, reason: auditRows.get(String(row.id))!.reason, source: "GreyLock local-routing-coverage-v2" })), null, 2) + "\n");
for (const row of rows) if (hash(await fs.readFile(path.join(output, String(row.trace)), "utf8")) !== row.hash) throw new Error(`D2 轨迹哈希不一致：${row.id}`);
const ruleRows = rows.filter((row) => row.category === "rule-case");
await fs.writeFile(path.join(output, "verification.json"), JSON.stringify({ schema: 3, sourceHashesVerified: verifiedSources.size, traceHashesVerified: rows.length, replayDeterministic: true, ruleCases: ruleRows.length, matched: ruleRows.filter((row) => row.matched).length, mismatches: ruleRows.filter((row) => !row.matched).map((row) => ({ id: row.id, sourceDecision: row.sourceDecision, actual: row.actual })), deliveryScenarios: rows.filter((row) => row.category === "delivery-scenario").map(({ id, unavailable }) => ({ id, unavailable })) }, null, 2) + "\n");
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
  if (JSON.stringify(replayTrace(trace, { policy: "P3", libs: libraries })) !== JSON.stringify(result)) throw new Error(`D2 重复回放不一致：${id}`);
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
async function readSource(relative: string) {
  const expected = expectedHashes[relative];
  if (!expected || !/^[a-f0-9]{64}$/.test(expected)) throw new Error(`GreyLock 来源缺少 SHA-256：${relative}`);
  const text = await fs.readFile(path.join(source, relative), "utf8");
  if (hash(text) !== expected) throw new Error(`GreyLock 来源哈希不一致：${relative}`);
  verifiedSources.set(relative, expected);
  return text;
}
