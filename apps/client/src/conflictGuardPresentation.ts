import type { ConflictGuardState } from "./conflictGuardTypes";

const relations: Record<string, string> = {
  call: "调用", "value-reference": "引用值", "type-reference": "引用类型",
  inheritance: "继承", implementation: "实现", "state-read": "读取状态",
  "state-write": "写入状态", contains: "包含", override: "覆写", "implements-member": "实现成员"
};

export function relationPathText(path: ConflictGuardState["candidatePairs"][number]["path"]) {
  return path?.hops.map((hop) => {
    const from = hop.direction === "forward" ? hop.from : hop.to;
    const to = hop.direction === "forward" ? hop.to : hop.from;
    return `${from.slice(from.indexOf("#") + 1)} ${relations[hop.kind] ?? hop.kind} ${to.slice(to.indexOf("#") + 1)}`;
  }).join("；") ?? "双方正在修改同一声明";
}

export function conflictWarning(record: NonNullable<ConflictGuardState["pairDecisions"]>[number], memberId?: string) {
  if (record.verdict?.decision !== "warn" || !(record.status === "judged" || record.status === "resolved" && record.resolution === "auto-cleared")) return undefined;
  if (record.pair.left.actor.memberId !== memberId && record.pair.right.actor.memberId !== memberId) return undefined;
  const model = record.verdict.adjudication;
  return {
    id: `${record.pair.id}:${record.revision}`,
    summary: model ? `${model.userExplanation} 建议：${model.suggestedAction} · ${model.status === "degraded" ? "研判失败，已降级为警告" : `由${model.source === "fast" ? "快判" : "深判"}模型判定 · ${Math.round(model.latencyMs)} ms`}` : record.verdict.summary,
    path: relationPathText(record.pair.path)
  };
}
