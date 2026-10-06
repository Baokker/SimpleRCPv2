import type { ConflictGuardState, GuardActorRef } from "./conflictGuardTypes";
import type { RoomMember } from "./types";

export function guardActorName(actor: GuardActorRef, members: RoomMember[]) {
  const name = (id?: string) => members.find((member) => member.id === id)?.displayName ?? id ?? "成员";
  if (actor.kind === "agent") return actor.teamAgent ? `${actor.teamAgent}（由 ${name(actor.ownerId)} 触发）` : `${name(actor.ownerId)} 的 Agent（${actor.runId?.slice(0, 6) ?? "run"}）`;
  return name(actor.memberId);
}
export function guardActorKey(actor: GuardActorRef) { return actor.kind === "agent" ? `agent:${actor.runId}` : `${actor.kind}:${actor.memberId}`; }
export function humanConflict(pair: ConflictGuardState["candidatePairs"][number]) { return pair.left.actor.kind === "human" && pair.right.actor.kind === "human"; }

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
  if (!humanConflict(record.pair)) return undefined;
  if (record.verdict?.decision !== "warn" || !(record.status === "judged" || record.status === "resolved" && record.resolution === "auto-cleared")) return undefined;
  if (record.pair.left.actor.memberId !== memberId && record.pair.right.actor.memberId !== memberId) return undefined;
  const model = record.verdict.adjudication;
  return {
    id: `${record.pair.id}:${record.revision}`,
    summary: model ? `${model.userExplanation} 建议：${model.suggestedAction} · ${model.status === "degraded" ? "研判失败，已降级为警告" : `由${model.source === "fast" ? "快判" : "深判"}模型判定 · ${Math.round(model.latencyMs)} ms`}` : record.verdict.summary,
    path: relationPathText(record.pair.path)
  };
}
