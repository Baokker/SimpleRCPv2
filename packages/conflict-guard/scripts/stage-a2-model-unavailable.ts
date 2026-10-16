import fs from "node:fs/promises";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { repositoryRoot } from "./model-runtime.ts";

const source = path.join(repositoryRoot, "docs/conflict-guard/experiment/v2/stage-A2/pair-v4/G2/results.json.gz");
const report = JSON.parse(gunzipSync(await fs.readFile(source)).toString()) as {
  model: { calls: Array<{ status: string; errorType?: string }> };
  responses: Array<[string, unknown]>;
  groups: Array<{ id: string; result: { judgements?: Array<{ verdict?: { ruleId?: string; decision?: string } }> } }>;
};
const unavailable = report.groups.flatMap((group) => (group.result.judgements ?? []).filter((judgement) => judgement.verdict?.ruleId === "model-unavailable").map((judgement) => ({ sample: group.id, decision: judgement.verdict?.decision ?? "warn", cause: report.model.calls.every((call) => call.status === "success") ? "replay-cache-miss" : "request-failure-or-timeout" })));
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
  conclusion: unavailable.length === 0 ? "没有出现 model-unavailable。" : report.model.calls.every((call) => call.status === "success") ? "出现的 model-unavailable 来自录放阶段请求键未命中；本轮真实 Jev 请求没有失败。" : "存在真实模型请求失败，需要按 errorType 逐类处理。"
};
await fs.writeFile(path.join(repositoryRoot, "docs/conflict-guard/experiment/v2/stage-A2/model-unavailable.json"), JSON.stringify(output, null, 2) + "\n");
console.log(JSON.stringify(output));
