import fs from "node:fs/promises";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { calculateReplayMetrics, inputHash, type AdjudicationInput, type ReplayGroupOutcome } from "../dist/index.js";
import { repositoryRoot } from "./model-runtime.ts";

type RecordedReport = { dataset: string; groups: Array<{ id: string; outcome: ReplayGroupOutcome; result: Record<string, any> }>; inputs: Array<{ input: AdjudicationInput }> };

const root = path.join(repositoryRoot, "docs/conflict-guard/experiment/v2/stage-A");
async function read(file: string) {
  return JSON.parse(gunzipSync(await fs.readFile(path.join(root, file))).toString()) as RecordedReport;
}
const pairV1 = await read("pair-v1/G1/results.json.gz");
const pairV4 = await read("pair-v4/G1/results.json.gz");
if (pairV1.dataset !== pairV4.dataset) throw new Error("公平比较需要使用同一数据版本");

const normalizeInput = (input: AdjudicationInput) => ({ ...input, promptVersion: undefined });
const normalized = (report: RecordedReport) => new Set(report.inputs.map((row) => inputHash(normalizeInput(row.input))));
const inputByHash = (report: RecordedReport) => new Map(report.inputs.map((row) => [inputHash(row.input), row.input]));
const groupInputHashes = (report: RecordedReport, group: RecordedReport["groups"][number]) => {
  const inputs = inputByHash(report);
  return new Set((group.result.judgements ?? []).map((judgement: any) => {
    const hash = judgement.verdict?.adjudication?.inputHash;
    const input = typeof hash === "string" ? inputs.get(hash) : undefined;
    return input ? inputHash(normalizeInput(input)) : undefined;
  }).filter((hash: string | undefined): hash is string => Boolean(hash)));
};
const greyIds = new Set(pairV1.groups.filter((group) => group.result.pairs?.some((pair) => pair.records?.some((record) => record.verdict?.zone === "grey" && !record.verdict.localOnly))).map((group) => group.id));
const pairV4ById = new Map(pairV4.groups.map((group) => [group.id, group]));
const groupInputs = [...greyIds].map((id) => {
  const v1 = pairV1.groups.find((group) => group.id === id);
  const v4 = pairV4ById.get(id);
  if (!v1 || !v4) throw new Error(`两份录制缺少共同灰区样本：${id}`);
  const pairV1Inputs = groupInputHashes(pairV1, v1);
  const pairV4Inputs = groupInputHashes(pairV4, v4);
  const same = pairV1Inputs.size === pairV4Inputs.size && [...pairV1Inputs].every((hash) => pairV4Inputs.has(hash));
  return { id, pairV1: v1, pairV4: v4, pairV1Inputs, pairV4Inputs, same };
});
const matchedGroups = groupInputs.filter((group) => group.same);
const v1Groups = matchedGroups.map((group) => group.pairV1);
const v4Groups = matchedGroups.map((group) => group.pairV4);
const matchedV1Inputs = new Set(matchedGroups.flatMap((group) => [...group.pairV1Inputs]));
const matchedV4Inputs = new Set(matchedGroups.flatMap((group) => [...group.pairV4Inputs]));
const intersection = [...matchedV1Inputs].filter((hash) => matchedV4Inputs.has(hash));
const union = new Set([...matchedV1Inputs, ...matchedV4Inputs]);
const quality = (groups: Array<{ outcome: ReplayGroupOutcome }>) => {
  const metrics = calculateReplayMetrics(groups.map((group) => group.outcome));
  const conflicts = groups.filter((group) => group.outcome.truth === "lock");
  const safe = groups.filter((group) => group.outcome.truth === "allow");
  const locked = conflicts.filter((group) => group.outcome.decision === "lock").length;
  const safeContinued = safe.filter((group) => group.outcome.decision !== "lock").length;
  return {
    samples: groups.length,
    conflicts: conflicts.length,
    safe: safe.length,
    balancedAccuracy: conflicts.length && safe.length ? (locked / conflicts.length + safeContinued / safe.length) / 2 : null,
    missBlockRate: metrics.missBlockRatio.value,
    falseBlockRate: metrics.falseBlockRatio.value,
    conflictNotificationRate: conflicts.length ? conflicts.filter((group) => group.outcome.decision !== "allow").length / conflicts.length : null,
    safeWarningRate: safe.length ? safe.filter((group) => group.outcome.decision === "warn").length / safe.length : null,
    threeClassAgreement: metrics.agreement.value
  };
};

const output = {
  dataset: pairV1.dataset,
  greySamples: greyIds.size,
  matchedGroupCount: matchedGroups.length,
  unmatchedGroups: groupInputs.filter((group) => !group.same).map((group) => ({ id: group.id, pairV1InputCount: group.pairV1Inputs.size, pairV4InputCount: group.pairV4Inputs.size })),
  commonInputCount: intersection.length,
  inputUnionCount: union.size,
  normalizedInputCoverage: { pairV1: intersection.length / Math.max(1, matchedV1Inputs.size), pairV4: intersection.length / Math.max(1, matchedV4Inputs.size), matchedGroups: matchedGroups.length / Math.max(1, greyIds.size) },
  pairV1: quality(v1Groups),
  pairV4: quality(v4Groups),
  changedFinalDecisions: v1Groups.flatMap((group) => {
    const current = v4Groups.find((candidate) => candidate.id === group.id)!;
    return group.outcome.decision === current.outcome.decision ? [] : [{ id: group.id, pairV1: group.outcome.decision, pairV4: current.outcome.decision }];
  })
};
const outputPath = path.join(repositoryRoot, "docs/conflict-guard/experiment/v2/stage-A2/fair-comparison.json");
await fs.writeFile(outputPath, JSON.stringify(output, null, 2) + "\n");
console.log(JSON.stringify(output));
