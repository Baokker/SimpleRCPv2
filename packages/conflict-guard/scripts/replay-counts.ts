import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { parseArgs } from "node:util";
import { gunzipSync } from "node:zlib";
import { readTrace, replayAgentTrace, participantKey, type ActorRef, type CandidatePair, type SemanticChangeEvent } from "../dist/index.js";
import { replayLibraries } from "./replay-libs.ts";

const { values } = parseArgs({ options: { trace: { type: "string" }, run: { type: "string" }, out: { type: "string" } } });
if (!values.trace || !values.run || !values.out) throw new Error("必须提供 trace、run 记录文件与 out");
async function readText(file: string) {
  const bytes = await fs.readFile(file);
  return (file.endsWith(".gz") ? gunzipSync(bytes) : bytes).toString("utf8");
}
const raw = await readText(path.resolve(values.trace));
const events = readTrace(raw);
const runPath = path.resolve(values.run);
const { run } = JSON.parse(await readText(runPath));
if (!run?.id || !run.startedAt || !run.finishedAt) throw new Error("run 记录必须包含开始与结束时间");
const runTrace = (await readText(path.join(path.dirname(runPath), runPath.endsWith(".gz") ? "trace.jsonl.gz" : "trace.jsonl"))).trim().split("\n").map((line) => JSON.parse(line));
const start = Date.parse(run.startedAt);
const end = Date.parse(run.finishedAt);
const session = events.findLastIndex((event) => event.type === "session_start" && event.at <= start);
if (session < 0) throw new Error("目标 run 缺少 session_start");
const input = events.slice(session).filter((event) => event.at <= end);
const actor = `agent:${run.id}`;
const involves = (pair: CandidatePair) => [pair.left.actor, pair.right.actor].some((side) => participantKey(side) === actor);
type Unit = { actor: string; at: number; batchId: string; symbols: Array<{ key: string; beforeHash: string; afterHash: string }>; related: boolean; valueRelated: boolean };
function collectUnits(source: Array<{ type: string; at: number; [key: string]: unknown }>) {
  const units = new Map<string, Unit>();
  const pairs = new Map<string, CandidatePair>();
  const observed = new Map<string, { related: boolean; valueRelated: boolean }>();
  for (const event of source) {
    if (["change_set_closed", "change_set_file_closed"].includes(event.type)) {
      const actor = participantKey(event.actor as ActorRef);
      for (const key of observed.keys()) {
        const [owner, symbol] = JSON.parse(key) as string[];
        if (owner === actor && (event.type === "change_set_closed" || symbol.startsWith(`${event.file}#`))) observed.delete(key);
      }
    }
    if (event.type === "change_unit" && !event.commentOnly) {
      const symbols = event.symbols as Unit["symbols"];
      if (symbols.length) {
        const actor = participantKey(event.actor as ActorRef);
        const batchId = String(event.batchId);
        units.set(`${actor}:${batchId}`, { actor, batchId, at: event.at, symbols, related: symbols.some((symbol) => observed.get(JSON.stringify([actor, symbol.key]))?.related), valueRelated: symbols.some((symbol) => observed.get(JSON.stringify([actor, symbol.key]))?.valueRelated) });
      }
    }
    if (["pair_candidate_opened", "pair_candidate_updated"].includes(event.type)) {
      const pair = event.pair as CandidatePair;
      pairs.set(pair.id, pair);
      for (const side of [pair.left, pair.right]) for (const symbol of side.symbols ?? [side.symbol]) {
        const key = JSON.stringify([participantKey(side.actor), symbol]);
        observed.set(key, { related: true, valueRelated: Boolean(observed.get(key)?.valueRelated || !pair.path?.typeOnly) });
      }
    }
    if (event.type === "pair_candidate_closed") pairs.delete((event.pair as CandidatePair).id);
    for (const unit of units.values()) {
      const matches = [...pairs.values()].filter((pair) => [pair.left, pair.right].some((side) => participantKey(side.actor) === unit.actor && (side.symbols ?? [side.symbol]).some((key) => unit.symbols.some((symbol) => symbol.key === key))));
      unit.related ||= matches.length > 0;
      unit.valueRelated ||= matches.some((pair) => !pair.path?.typeOnly);
    }
  }
  return [...units.values()];
}
function statistics(selected: Unit[]) {
  const unrelated = selected.filter((unit) => !unit.related).length;
  return { total: selected.length, related: selected.length - unrelated, unrelated, unrelatedRatio: selected.length ? unrelated / selected.length : 0 };
}
function signature(unit: Unit) {
  return JSON.stringify([unit.actor, unit.symbols.map(({ key, beforeHash, afterHash }) => [key, beforeHash, afterHash]).sort()]);
}
const recordedUnits = collectUnits(input);
const semanticEvents: Array<SemanticChangeEvent & { at: number }> = [];
const replay = await replayAgentTrace(input, {
  mode: "owner", libs: await replayLibraries(), judgementFrameMs: 200, maxJudgementsPerFrame: 20,
  onSemanticEvent(event, at) { semanticEvents.push({ ...event, at }); }
});
if (replay.errors.length) throw new Error(`回放失败：${JSON.stringify(replay.errors)}`);
const rebuiltUnits = collectUnits([...semanticEvents, ...input.filter((event) => ["change_set_closed", "change_set_file_closed"].includes(event.type))].sort((left, right) => left.at - right.at));
const originalKeys = new Set(recordedUnits.map(signature));
const rebuiltKeys = new Set(rebuiltUnits.map(signature));
const matched = recordedUnits.map((unit) => rebuiltUnits.find((rebuilt) => signature(unit) === signature(rebuilt))).filter((unit): unit is Unit => Boolean(unit));
const targetJudgements = replay.judgements.filter((entry) => entry.at >= start && involves(entry.pair));
const result = {
  sourceSha256: createHash("sha256").update(raw).digest("hex"), runId: run.id, start, end,
  simulation: "local-rules", configuration: { judgementFrameMs: 200, maxJudgementsPerFrame: 20 },
  recorded: {
    run: {
      candidateOpened: runTrace.filter((event) => event.type === "pair_candidate_opened").length,
      judged: runTrace.filter((event) => event.type === "pair_judged").length
    },
    projectTarget: {
      candidateOpened: input.filter((event) => event.at >= start && event.type === "pair_candidate_opened" && involves(event.pair as CandidatePair)).length,
      judged: input.filter((event) => event.at >= start && event.type === "pair_judged" && involves(event.pair as CandidatePair)).length
    },
    changeUnits: statistics(recordedUnits), targetChangeUnits: statistics(recordedUnits.filter((unit) => unit.actor === actor)),
    commentOnly: input.filter((event) => event.type === "change_unit" && event.commentOnly).length
  },
  replayed: {
    judged: targetJudgements.length, sessionJudged: replay.judgements.length,
    byPoint: Object.fromEntries(["T1", "T2", "T3"].map((point) => [point, targetJudgements.filter((entry) => entry.point === point).length])),
    changeUnits: replay.changeUnits, targetChangeUnits: replay.changeUnitsByActor[actor],
    rules: Object.fromEntries([...new Set(targetJudgements.map((entry) => entry.verdict.ruleId))].map((rule) => [rule, targetJudgements.filter((entry) => entry.verdict.ruleId === rule).length]))
  },
  unitComparison: {
    matchedRecorded: statistics(recordedUnits.filter((unit) => rebuiltKeys.has(signature(unit)))),
    matchedReplayed: statistics(matched),
    newlyUnrelated: recordedUnits.filter((unit) => unit.related && matched.find((entry) => signature(entry) === signature(unit))?.related === false),
    recordedOnly: recordedUnits.filter((unit) => !rebuiltKeys.has(signature(unit))),
    rebuiltOnly: rebuiltUnits.filter((unit) => !originalKeys.has(signature(unit)))
  },
  errors: replay.errors
};
await fs.mkdir(path.resolve(values.out), { recursive: true });
await fs.writeFile(path.join(path.resolve(values.out), "candidate-counts.json"), JSON.stringify(result, null, 2) + "\n");
console.log(JSON.stringify({ ...result, unitComparison: { ...result.unitComparison, newlyUnrelated: result.unitComparison.newlyUnrelated.length, recordedOnly: result.unitComparison.recordedOnly.length, rebuiltOnly: result.unitComparison.rebuiltOnly.length } }));
