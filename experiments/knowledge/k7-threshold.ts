import fs from "node:fs/promises";
import path from "node:path";
import diff from "fast-diff";
import {resolveKnowledgeAnchorInText, type KnowledgeAnchor} from "@simplercp/knowledge";
import {collectFrozenAnchorCorpus, createAnchorBenchmarkCases} from "../../packages/knowledge/test/fixtures/anchor-benchmark.js";
import {platformRoot, root, writeJson} from "./common.js";

// 复核阈值敏感性（评审意见 B9）。读取 K7 的保存轨迹，只改变组合策略的两项阈值重新判定，不重新生成编辑。
// 产品阈值为字符相似度不低于 0.65、行修改比例不超过 0.5。

type Range = {startOffset: number; endOffset: number};
const source = process.argv[2] ?? "runs/E2-k7-final";
const directory = path.resolve(root, source);
const similarityLimits = [0.65, 0.5, 0.35, 0.2, 0];
const changedLimits = [0.5, 0.6, 0.7, 0.8, 0.9, 1];

function similarityAndChanges(text: string, anchor: KnowledgeAnchor, range: Range) {
  const before = anchor.snapshot.text, after = text.slice(range.startOffset, range.endOffset);
  const unchanged = diff(before, after).reduce((sum, [operation, value]) => sum + (operation === diff.EQUAL ? value.length : 0), 0);
  const similarity = unchanged / Math.max(1, before.length, after.length);
  const beforeLines = before.split(/\r?\n/u), afterLines = after.split(/\r?\n/u);
  const total = Math.max(beforeLines.length, afterLines.length);
  const changed = total === 1 ? 1 - similarity : Array.from({length: total}, (_, index) => beforeLines[index] === afterLines[index] ? 0 : 1).reduce((a: number, b) => a + b, 0) / total;
  return {similarity, changed};
}

const corpus = collectFrozenAnchorCorpus(platformRoot, {fixtureRoot: path.join(platformRoot, "packages/knowledge/bench/fixtures/anchor-corpus-0869b7a")});
const anchors = new Map(createAnchorBenchmarkCases(corpus).map(item => [item.sampleId, item.anchor]));
const rows = (await fs.readFile(path.join(directory, "results.jsonl"), "utf8")).trim().split("\n").map(line => JSON.parse(line));
const cases = await Promise.all(rows.map(async row => {
  const trace = JSON.parse(await fs.readFile(path.join(directory, row.artifacts, "trace.json"), "utf8"));
  const anchor = anchors.get(row.sample)!;
  const multi = resolveKnowledgeAnchorInText(trace.text, anchor);
  const recorded = row.results.find((result: any) => result.strategy === "yjs-multi").outcome;
  return {
    kind: row.condition as string, truth: trace.truth as Range | null, recorded,
    relative: trace.relative as Range | undefined, relativeMeasure: trace.relative ? similarityAndChanges(trace.text, anchor, trace.relative) : undefined,
    multi, multiMeasure: multi ? similarityAndChanges(trace.text, anchor, multi) : undefined,
    truthMeasure: trace.truth ? similarityAndChanges(trace.text, anchor, trace.truth) : undefined
  };
}));

const same = (a: Range | undefined, b: Range | null) => Boolean(a && b && a.startOffset === b.startOffset && a.endOffset === b.endOffset);
function judge(item: typeof cases[number], minSimilarity: number, maxChanged: number) {
  const yjs = item.relative && item.relativeMeasure!.similarity >= minSimilarity && item.relativeMeasure!.changed <= maxChanged ? item.relative : undefined;
  const text = item.multi && item.multi.confidence >= minSimilarity && item.multiMeasure!.changed <= maxChanged ? item.multi : undefined;
  const range = yjs ?? text;
  return !range ? "review" : same(range, item.truth) ? "correct" : "wrong";
}

const groups = {"three-members": (kind: string) => kind === "three-members", "non-delete": (kind: string) => kind !== "delete", delete: (kind: string) => kind === "delete"};
const curve = similarityLimits.flatMap(minSimilarity => changedLimits.map(maxChanged => {
  const counts = Object.fromEntries(Object.entries(groups).map(([name, test]) => {
    const subset = cases.filter(item => test(item.kind));
    const outcomes = subset.map(item => judge(item, minSimilarity, maxChanged));
    return [name, {total: subset.length, correct: outcomes.filter(value => value === "correct").length, wrong: outcomes.filter(value => value === "wrong").length, review: outcomes.filter(value => value === "review").length}];
  }));
  return {minSimilarity, maxChanged, ...counts};
}));
const product = curve.find(point => point.minSimilarity === 0.65 && point.maxChanged === 0.5)!;
const mismatches = cases.filter(item => judge(item, 0.65, 0.5) !== item.recorded).length;
if (mismatches) throw new Error(`Replay differs from the recorded product outcome in ${mismatches} records`);

// 定位正确与知识仍有效的区分：真值位置上的代码与卡片快照相比改动了多少。
const drift = (subset: typeof cases) => {
  const values = subset.filter(item => item.truthMeasure).map(item => item.truthMeasure!);
  const bucket = (test: (value: {similarity: number; changed: number}) => boolean) => values.filter(test).length;
  return {located: values.length, changedAtMostHalf: bucket(value => value.changed <= 0.5), changedOverHalf: bucket(value => value.changed > 0.5),
    similarityBelow035: bucket(value => value.similarity < 0.35), medianSimilarity: values.map(value => value.similarity).sort((a, b) => a - b)[Math.floor(values.length / 2)] ?? null};
};
const contentDrift = Object.fromEntries(["insert-around", "interleaved", "move-and-edit", "duplicate-before", "three-members"].map(kind => [kind, drift(cases.filter(item => item.kind === kind))]));
await writeJson(path.join(directory, "analysis/threshold-curve.json"), {source, productThreshold: product, replayMatchesRecorded: true, curve, contentDrift});
console.log(JSON.stringify({product, contentDrift: contentDrift["three-members"]}));
for (const point of curve) console.log([point.minSimilarity, point.maxChanged, `${point["three-members"].correct}/${point["three-members"].wrong}/${point["three-members"].review}`, `${point["non-delete"].correct}/${point["non-delete"].wrong}/${point["non-delete"].review}`, `${point.delete.wrong}/${point.delete.review}`].join("\t"));
