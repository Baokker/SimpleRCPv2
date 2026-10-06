import path from "node:path";
import fs from "node:fs/promises";
import {root, readJson, readJsonl, writeJson, dataset} from "./common.js";
import {draftMetrics, episodes} from "./k2.js";
import {summarizeRetrieval} from "./k5.js";

const folder = (name: string) => path.join(root, "runs", name);
const data = await dataset();
const k4Location = process.argv[2] ?? "k4-review";
const k2Location = process.argv[5] ?? "k2-review";
const k3 = await readJsonl(path.join(folder("k3-pilot"), "results.jsonl"));
const supplements = await readJsonl(path.join(folder("k3-conditions-pilot"), "results.jsonl"));
const k2 = await readJsonl(path.join(folder(k2Location), "results.jsonl"));
const contexts = await episodes(data, folder(k4Location));
const k2Evaluation = await Promise.all(k2.map(async row => {
  const cached = await readJson(path.join(folder(k2Location), row.artifacts, "response.json"));
  const episode = contexts.find(item => item.id === row.episode || item.pairId === row.episode);
  if (!episode) throw new Error(`K2 episode is absent: ${row.episode}`);
  return {episode: row.episode, condition: row.condition, mustMention: episode.mustMention, ...draftMetrics(cached.response.responses.at(-1), row.condition, cached.request.evidence, episode.mustMention, episode.expectedTypes), latencyMs: row.latencyMs, source: row.artifacts};
}));
const k4 = await readJsonl(path.join(folder(k4Location), "results.jsonl"));
const k4Context = await readJsonl(path.join(folder(process.argv[6] ?? "k4-context-review-final"), "results.jsonl"));
const k1 = (await readJsonl(path.join(folder("k1-review"), "results.jsonl"))).filter(row => row.condition === "offline");
const k5Location = process.argv[3] ?? "k5-review";
const k5 = await readJsonl(path.join(folder(k5Location), "results.jsonl"));
const k7Location = process.argv[4] ?? "k7-review";
const k7 = await readJsonl(path.join(folder(k7Location), "results.jsonl"));
const mean = (items: number[]) => items.reduce((sum, value) => sum + value, 0) / items.length;
const groups = (rows: any[], field: string) => [...new Set(rows.map(row => row[field]))].map(key => ({key, rows: rows.filter(row => row[field] === key)}));
const online = await readJsonl(path.join(folder("k1-review-comparison"), "results.jsonl"));
const transferSummary = (rows: any[]) => rows.map(row => ({key: row.key, pair: row.pair, condition: row.condition, variant: row.variant, taFunctional: row.ta.functional, taTrapped: row.ta.actuallyTrapped,
  functional: row.functional, avoided: row.trapAvoided, targetInjected: row.targetInjected, cardScope: row.cardScope,
  cardOwner: row.cardOwner, crossOwner: row.crossOwner, reuse: row.reuse}));
const summaries = {
  k2: k2Evaluation,
  supplemental: groups(supplements, "condition").map(({key, rows}) => ({condition: key, count: rows.length, functional: rows.filter(row => row.functional).length, avoided: rows.filter(row => row.trapAvoided).length, joint: rows.filter(row => row.jointSuccess).length, toolCalls: rows.reduce((sum, row) => sum + row.toolCalls, 0)})),
  k3: groups(k3, "condition").map(({key, rows}) => ({condition: key, count: rows.length, functional: rows.filter(row => row.functional).length, avoided: rows.filter(row => row.trapAvoided).length,
    joint: rows.filter(row => row.jointSuccess).length, targetInjected: rows.filter(row => row.targetInjected).length, totalEstimatedCNY: rows.reduce((sum, row) => sum + (row.usage?.estimatedCost ?? 0), 0), meanWallMs: mean(rows.map(row => row.wallMs))})),
  calibration: await readJson(path.join(folder("k3-pilot"), "calibration.json")),
  k4: transferSummary(k4),
  k4Context: transferSummary(k4Context),
  k1: {predicted: k1.reduce((sum, row) => sum + row.predicted, 0), annotated: k1.reduce((sum, row) => sum + row.annotated, 0), truePositives: k1.reduce((sum, row) => sum + row.truePositives, 0),
    anchorTotal: k1.reduce((sum, row) => sum + row.anchors.total, 0), top1: mean(k1.map(row => row.anchors.top1)), top3: mean(k1.map(row => row.anchors.top3)), online},
  k5: groups(k5, "condition").map(({key, rows}) => ({condition: key, ...summarizeRetrieval(rows)})),
  k7: ["range-only", "snapshot-only", "multi-strategy", "yjs-relative", "yjs-multi"].map(strategy => {
    const locatable = k7.filter(row => row.truth !== null).map(row => row.results.find((item: any) => item.strategy === strategy));
    const deletion = k7.filter(row => row.condition === "delete").map(row => row.results.find((item: any) => item.strategy === strategy));
    const rightBoundaryExpanded = k7.filter(row => row.truth !== null).filter(row => {
      const result = row.results.find((item: any) => item.strategy === strategy);
      return result.outcome === "wrong" && result.range?.startOffset === row.truth.startOffset && result.range.endOffset > row.truth.endOffset;
    }).length;
    return {strategy, locatable: locatable.length, survival: mean(locatable.map(row => Number(row.outcome === "correct"))), wrongMigration: mean(locatable.map(row => Number(row.outcome === "wrong"))), rightBoundaryExpanded, review: mean(locatable.map(row => Number(row.outcome === "review"))), deletionReview: mean(deletion.map(row => Number(row.outcome === "review")))};
  })
};
const agentMs = mean([...k3, ...supplements].map(row => row.wallMs));
const agentCost = mean([...k3, ...supplements].map(row => row.usage?.estimatedCost ?? 0));
const k4Ms = mean(k4.map(row => row.wallMs));
const k4Cost = mean(k4.map(row => (row.usage?.estimatedCost ?? 0) + (row.ta.usage?.estimatedCost ?? 0) + (row.correctionUsage?.estimatedCost ?? 0)));
const k4Configuration = await readJson(path.join(folder(k4Location), "configuration.json"));
const contextRuns = await Promise.all([...new Set(k2.filter(row => row.condition === "agent-self").map(row => row.episode))].map(async episode => (await readJson(path.join(folder(k2Location), `raw/${episode}-context/context-run-completed.json`))).run));
const draftCosts = await Promise.all(k2.map(async row => {
  const response = (await readJson(path.join(folder(k2Location), row.artifacts, "response.json"))).response;
  return {mode: row.condition, cost: response.calls.reduce((sum: number, call: any) => sum + (call.usage.estimatedCost ?? (call.usage.promptTokens * 2.1 + call.usage.completionTokens * 8.4) / 1000000), 0)};
}));
const k2Episodes = data.transfers.length * 6 * 2 * 3 + contexts.filter(item => !item.pairId).length;
const evaluatedEpisodes = new Set(k2.map(row => row.episode)).size;
const estimates = {repetitions: 3, k3: {combinations: 14 * 9 * 3, meanRunSeconds: agentMs / 1000, sequentialHours: 14 * 9 * 3 * agentMs / 3600000, estimatedCNY: 14 * 9 * 3 * agentCost},
  k4: {combinations: 4 * 6 * 2 * 3, agentRunsPerCombination: 3, delayedMeanSeconds: k4Ms / 1000, sameSessionEstimatedSeconds: (k4Ms - k4Configuration.config.delayMs) / 1000, sequentialHours: (4 * 6 * 2 * 3 * k4Ms - 4 * 6 * 3 * k4Configuration.config.delayMs) / 3600000, estimatedCNY: 4 * 6 * 2 * 3 * k4Cost, recapEstimatedCNY: 4 * 3 * 2 * 3 * draftCosts.find(item => item.mode === "server")!.cost + 4 * 2 * 3 * draftCosts.find(item => item.mode === "agent-self")!.cost},
  k2: {episodes: k2Episodes, correctionEpisodes: data.transfers.length * 6 * 2 * 3, scriptEpisodes: contexts.filter(item => !item.pairId).length, drafts: k2Episodes * 3,
    sequentialHours: k2Episodes * (k2.reduce((sum, row) => sum + row.latencyMs, 0) / evaluatedEpisodes + mean(contextRuns.map(run => Date.parse(run.finishedAt) - Date.parse(run.startedAt)))) / 3600000,
    estimatedCNY: k2Episodes * (draftCosts.reduce((sum, item) => sum + item.cost, 0) / evaluatedEpisodes + mean(contextRuns.map(run => run.usage.estimatedCost)))},
  price: {provider: "minimax", model: "MiniMax-M2", inputPerMillionCNY: 2.1, outputReasoningPerMillionCNY: 8.4, cacheReadPerMillionCNY: 0.21, cacheWritePerMillionCNY: 2.625},
  limitations: ["费用使用 AgentRun.usage 的估算，尚未核对供应商账单", "K2 与 K4 的复盘费用按 P01 的真实调用估算", "同会话变体的耗时由延时变体减去固定间隔估算", "并发后的耗时受模型服务限速影响"]};
await writeJson(path.join(root, "runs/pilot-summary.json"), {summaries, estimates});
const inspections = [];
for (const row of k3.filter(row => row.repetition === 1)) {
  const directory = path.join(folder("k3-pilot"), row.artifacts);
  const actual = await readJson(path.join(directory, "judge-output.json"));
  const injection = await readJson(path.join(directory, "injection.json"));
  const patch = await fs.readFile(path.join(directory, "workspace.patch"), "utf8");
  inspections.push({key: row.key, diffBytes: Buffer.byteLength(patch), files: [...patch.matchAll(/^diff --git a\/(.+) b\/(.+)$/gmu)].map(match => match[2]),
    injectedIds: injection.injected.flatMap((event: any) => event.data.cards.map((card: any) => card.id)), functional: actual.functional, trapAvoided: actual.trapAvoided,
    projectTests: {passed: actual.tests.project.passed, failed: actual.tests.project.failed}, hiddenTests: {passed: actual.tests.hidden.passed, failed: actual.tests.hidden.failed}, failureText: actual.tests.hidden.status ? actual.tests.hidden.output : actual.trapEvidence.output});
}
await writeJson(path.join(root, "runs/artifact-inspection.json"), inspections);
console.log(JSON.stringify({summaries, estimates}, null, 2));
