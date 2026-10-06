import path from "node:path";
import seedrandom from "seedrandom";
import diff from "fast-diff";
import {offsetsFromRange, resolveKnowledgeAnchorInText, type KnowledgeAnchor} from "@simplercp/knowledge";
import {collectFrozenAnchorCorpus, createAnchorBenchmarkCases, type FrozenAnchorSample} from "../../packages/knowledge/test/fixtures/anchor-benchmark.js";
import {YRuntime as Y} from "./collaboration.js";
import {platformRoot, type ExperimentConfig, RunStore, digest, writeJson} from "./common.js";

export const editKinds = ["insert-around", "interleaved", "move-and-edit", "duplicate-before", "delete", "three-members"] as const;
export const strategies = ["range-only", "snapshot-only", "multi-strategy", "yjs-relative", "yjs-multi"] as const;
type Range = {startOffset: number; endOffset: number};
export function concurrentTrace(sample: FrozenAnchorSample, kind: typeof editKinds[number], seed: number) {
  const random = seedrandom(`${sample.id}:${kind}:${seed}`);
  const base = new Y.Doc(); base.clientID = 100;
  const original = base.getText("content");
  original.insert(0, sample.text, {anchor: false});
  original.format(sample.selectionStart, sample.selectionEnd - sample.selectionStart, {anchor: true});
  const start = Y.createRelativePositionFromTypeIndex(original, sample.selectionStart, 0);
  const end = Y.createRelativePositionFromTypeIndex(original, sample.selectionEnd, -1);
  const state = Y.encodeStateAsUpdate(base);
  const copies = [201, 202, 203].map(id => {const doc = new Y.Doc(); doc.clientID = id; Y.applyUpdate(doc, state); return doc;});
  const operations: Array<{member: number; start: number; deleted: number; inserted: string; tracked: boolean}> = [];
  const apply = (member: number, offset: number, deleted: number, inserted: string, tracked = false, moved = false) => {
    const doc = copies[member], text = doc.getText("content");
    doc.transact(() => {if (deleted) text.delete(offset, deleted); if (inserted) text.insert(offset, inserted, {anchor: tracked, moved});});
    operations.push({member, start: offset, deleted, inserted, tracked});
  };
  const s = sample.selectionStart, e = sample.selectionEnd;
  const midpoint = s + Math.floor(random() * Math.max(1, e - s));
  const marker = `\n// concurrent ${Math.floor(random() * 100000)}\n`;
  if (kind === "insert-around") {apply(0, s, 0, marker); apply(1, e, 0, marker);}
  if (kind === "interleaved") {apply(0, midpoint, 1, "Q", true); apply(1, Math.max(0, s - 1), 0, marker);}
  if (kind === "move-and-edit") {
    const selected = sample.text.slice(s, e);
    apply(0, s, e - s, ""); apply(0, copies[0].getText("content").length, 0, selected, true, true);
    apply(1, midpoint, 1, "Z", true);
  }
  if (kind === "duplicate-before") {apply(0, s, 0, sample.text.slice(s, e) + "\n"); apply(1, e, 0, marker);}
  if (kind === "delete") {apply(0, s, e - s, ""); apply(1, Math.max(0, s - 1), 0, marker);}
  if (kind === "three-members") for (let member = 0; member < 3; member++) {
    const offset = s + Math.floor(random() * Math.max(1, e - s));
    apply(member, offset, random() > 0.5 ? 1 : 0, String(member), true);
    apply(member, 0, 0, marker);
  }
  const updates = copies.map(doc => Y.encodeStateAsUpdate(doc));
  for (const doc of copies) for (const update of updates) Y.applyUpdate(doc, update);
  const document = copies[0], text = document.getText("content").toString();
  if (copies.some(doc => doc.getText("content").toString() !== text)) throw new Error("Concurrent documents did not converge");
  let offset = 0;
  const tracked: Range[] = [];
  const relocated: Range[] = [];
  for (const part of document.getText("content").toDelta()) {
    if (typeof part.insert !== "string") throw new Error("Unexpected anchor embed");
    if (part.attributes?.anchor) tracked.push({startOffset: offset, endOffset: offset + part.insert.length});
    if (part.attributes?.moved) relocated.push({startOffset: offset, endOffset: offset + part.insert.length});
    offset += part.insert.length;
  }
  const fragments = tracked.some((range, index) => index > 0 && range.startOffset - tracked[index - 1].endOffset > e - s);
  const trueRanges = relocated.length ? relocated : tracked;
  const truth = !trueRanges.length ? null : {startOffset: trueRanges[0].startOffset, endOffset: trueRanges.at(-1)!.endOffset};
  const a = Y.createAbsolutePositionFromRelativePosition(start, document), b = Y.createAbsolutePositionFromRelativePosition(end, document);
  const relative = a && b && a.type === b.type && a.index < b.index ? {startOffset: a.index, endOffset: b.index} : undefined;
  const updateHashes = updates.map(update => digest(Array.from(update)));
  for (const doc of copies) doc.destroy(); base.destroy();
  return {text, operations, truth, fragments, relative, updateHashes};
}

// 采用 knowledgeService.ts 的字符相似度与 changedLineRatio 检查。
function acceptable(text: string, anchor: KnowledgeAnchor, range: Range) {
  const before = anchor.snapshot.text, after = text.slice(range.startOffset, range.endOffset);
  const unchanged = diff(before, after).reduce((sum, [operation, value]) => sum + (operation === diff.EQUAL ? value.length : 0), 0);
  const similarity = unchanged / Math.max(1, before.length, after.length);
  const beforeLines = before.split(/\r?\n/u), afterLines = after.split(/\r?\n/u);
  const total = Math.max(beforeLines.length, afterLines.length);
  const changed = total === 1 ? 1 - similarity : Array.from({length: total}, (_, index) => beforeLines[index] === afterLines[index] ? 0 : 1).reduce((a: number, b) => a + b, 0) / total;
  return similarity >= 0.65 && changed <= 0.5;
}
export function evaluateStrategies(text: string, anchor: KnowledgeAnchor, relative: Range | undefined, truth: Range | null) {
  const multi = resolveKnowledgeAnchorInText(text, anchor);
  const first = text.indexOf(anchor.snapshot.text);
  const snapshot = first >= 0 && text.indexOf(anchor.snapshot.text, first + 1) < 0 ? {startOffset: first, endOffset: first + anchor.snapshot.text.length} : undefined;
  const platformText = multi && multi.confidence >= 0.65 && acceptable(text, anchor, multi) ? multi : undefined;
  const platformYjs = relative && acceptable(text, anchor, relative) ? relative : undefined;
  const resolutions = [anchor.rangeAtCapture ? offsetsFromRange(text, anchor.rangeAtCapture) : undefined, snapshot, multi, relative, platformYjs ?? platformText];
  return strategies.map((strategy, index) => {
    const range = resolutions[index];
    const correct = Boolean(truth && range && range.startOffset === truth.startOffset && range.endOffset === truth.endOffset);
    return {strategy, outcome: !range ? "review" : correct ? "correct" : "wrong", range: range ? {startOffset: range.startOffset, endOffset: range.endOffset} : null};
  });
}
export async function runK7(config: ExperimentConfig, store: RunStore) {
  const corpus = collectFrozenAnchorCorpus(platformRoot, {fixtureRoot: path.join(platformRoot, "packages/knowledge/bench/fixtures/anchor-corpus-0869b7a")});
  if (corpus.length !== 48) throw new Error(`Expected 48 anchors: ${corpus.length}`);
  const anchors = new Map(createAnchorBenchmarkCases(corpus).map(item => [item.sampleId, item.anchor]));
  for (const sample of corpus) for (const kind of editKinds) for (let index = 0; index < 5; index++) {
    const seed = config.seed + index, key = `${sample.id}-${kind}-${seed}`;
    if (store.done(key)) continue;
    const trace = concurrentTrace(sample, kind, seed);
    if (digest(trace) !== digest(concurrentTrace(sample, kind, seed))) throw new Error(`Seed is not reproducible: ${key}`);
    const rows = evaluateStrategies(trace.text, anchors.get(sample.id)!, trace.relative, trace.truth);
    await writeJson(path.join(store.raw(key), "trace.json"), trace);
    await store.append({key, completed: true, sample: sample.id, sourceFile: sample.sourceFile, condition: kind, seed, truth: trace.truth, fragmented: trace.fragments, reproducible: true, results: rows, artifacts: path.relative(store.directory, store.raw(key))});
  }
}
