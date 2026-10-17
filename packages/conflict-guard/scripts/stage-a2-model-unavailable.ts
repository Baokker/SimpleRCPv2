import fs from "node:fs/promises";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { repositoryRoot } from "./model-runtime.ts";

const source = path.join(repositoryRoot, "docs/conflict-guard/experiment/v2/stage-A2/pair-v4/G2/results.json.gz");
const report = JSON.parse(gunzipSync(await fs.readFile(source)).toString()) as {
  model: { calls: Array<{ inputHash?: string; status: string; errorType?: string }> };
  responses: Array<[string, unknown]>;
  groups: Array<{
    id: string;
    result: {
      judgements?: Array<{
        pairId?: string;
        revision?: number;
        verdict?: { ruleId?: string; decision?: string; adjudication?: { inputHash?: string } };
        pair?: { left?: { status?: string }; right?: { status?: string }; syntaxWait?: { deferred?: number } };
      }>;
      pairs?: Array<{ id: string; records?: Array<{ revision: number; status: string; verdict?: { ruleId?: string } }> }>;
    };
  }>;
};
const unavailable = report.groups.flatMap((group) => (group.result.judgements ?? []).filter((judgement) => judgement.verdict?.ruleId === "model-unavailable").map((judgement) => {
  const pair = judgement.pair;
  const inputHash = judgement.verdict?.adjudication?.inputHash;
  const matchingCall = inputHash ? report.model.calls.find((call) => call.inputHash === inputHash) : undefined;
  const pairRecords = judgement.pairId ? group.result.pairs?.find((candidate) => candidate.id === judgement.pairId)?.records ?? [] : [];
  const unavailableIndex = pairRecords.findIndex((record) => record.revision === judgement.revision && record.verdict?.ruleId === "model-unavailable");
  const closedBeforeModel = unavailableIndex >= 0 && pairRecords.slice(0, unavailableIndex).some((record) => record.revision === judgement.revision && record.status === "closed");
  const cause = matchingCall && !["success", "cache-hit"].includes(matchingCall.status)
    ? "request-failure-or-timeout"
    : pair?.left?.status === "deleted" || pair?.right?.status === "deleted"
      ? "request-skipped-missing-symbol"
      : (pair?.syntaxWait?.deferred ?? 0) > 0
        ? "request-skipped-incomplete-input"
        : closedBeforeModel
          ? "candidate-closed-before-model"
        : "replay-cache-miss";
  return { sample: group.id, pairId: judgement.pairId, revision: judgement.revision, decision: judgement.verdict?.decision ?? "warn", cause, inputHash, requestStatus: matchingCall?.status };
}));
const callStatus = Object.fromEntries([...new Set(report.model.calls.map((call) => call.status))].map((status) => [status, report.model.calls.filter((call) => call.status === status).length]));
const errorTypes = Object.fromEntries([...new Set(report.model.calls.map((call) => call.errorType).filter(Boolean))].map((errorType) => [errorType, report.model.calls.filter((call) => call.errorType === errorType).length]));
const causes = Object.fromEntries([...new Set(unavailable.map((entry) => entry.cause))].map((cause) => [cause, unavailable.filter((entry) => entry.cause === cause).length]));
const output = {
  source: "stage-A2/pair-v4/G2",
  unavailableCount: unavailable.length,
  unavailable,
  callStatus,
  errorTypes,
  causes,
  recordedResponses: report.responses.length,
  conclusion: unavailable.length === 0 ? "没有出现 model-unavailable。" : "已根据候选关闭、请求跳过、请求失败和录放缓存缺项分别归类；真实录制调用状态另行统计。"
};
await fs.writeFile(path.join(repositoryRoot, "docs/conflict-guard/experiment/v2/stage-A2/model-unavailable.json"), JSON.stringify(output, null, 2) + "\n");
console.log(JSON.stringify(output));
