import type { ConflictGuardState, GuardActorRef } from "./conflictGuardTypes";
import type { RoomMember } from "./types";
import { readableGuardText } from "./conflictGuardLabels";

export function guardActorName(actor: GuardActorRef, members: RoomMember[]) {
  const name = (id?: string) => members.find((member) => member.id === id)?.displayName ?? id ?? "成员";
  if (actor.kind === "agent") return actor.teamAgent ? `${actor.teamAgent}（由 ${name(actor.ownerId)} 触发）` : `${name(actor.ownerId)} 的 Agent（${actor.runId?.slice(0, 6) ?? "run"}）`;
  return name(actor.memberId);
}
export function guardActorKey(actor: GuardActorRef) { return actor.kind === "agent" ? `agent:${actor.runId}` : `${actor.kind}:${actor.memberId}`; }
export function humanConflict(pair: ConflictGuardState["candidatePairs"][number]) { return pair.left.actor.kind === "human" && pair.right.actor.kind === "human"; }

export function conflictActionCount(state: ConflictGuardState, memberId?: string) {
  if (!memberId || state.mode === "observe" || state.arbitration?.mode === "all-auto") return 0;
  const pairs = (state.pairDecisions ?? []).filter((record) => humanConflict(record.pair) && ["judged", "stale"].includes(record.status) && record.verdict?.decision === "lock" && [record.pair.left.actor.memberId, record.pair.right.actor.memberId].includes(memberId));
  const cards = (state.ownerCards ?? []).filter((card) => card.status === "waiting" && card.owners.includes(memberId) && !card.accepted.includes(memberId));
  return new Set(pairs.map((record) => record.pair.id)).size + cards.length;
}

export function guardDecisionCounts(state: ConflictGuardState) {
  const records = [...new Map((state.pairDecisions ?? []).filter((record) => record.verdict).map((record) => [record.pair.id, record])).values()];
  const additional = state.intervention ? records.filter((record) => record.point) : records;
  return {
    decisions: (state.intervention?.decisions ?? 0) + additional.length,
    white: (state.intervention?.white ?? 0) + additional.filter((record) => record.verdict!.zone === "white").length,
    black: (state.intervention?.black ?? 0) + additional.filter((record) => record.verdict!.zone === "black").length,
    grey: (state.intervention?.grey ?? 0) + additional.filter((record) => record.verdict!.zone === "grey").length
  };
}

const relations: Record<string, string> = {
  call: "调用", "value-reference": "引用值", "type-reference": "引用类型",
  inheritance: "继承", implementation: "实现", "state-read": "读取状态",
  "state-write": "写入状态", contains: "包含", override: "覆写", "implements-member": "实现成员"
};

export function relationPathLines(path: ConflictGuardState["candidatePairs"][number]["path"]) {
  return path?.hops.map((hop) => {
    const from = hop.direction === "forward" ? hop.from : hop.to;
    const to = hop.direction === "forward" ? hop.to : hop.from;
    return `${from.slice(from.indexOf("#") + 1)} ${relations[hop.kind] ?? hop.kind} ${to.slice(to.indexOf("#") + 1)}`;
  }) ?? ["双方正在修改同一声明"];
}

export function relationPathText(path: ConflictGuardState["candidatePairs"][number]["path"]) {
  return relationPathLines(path).join(" → ");
}

export function conflictWarning(record: NonNullable<ConflictGuardState["pairDecisions"]>[number], memberId?: string) {
  if (record.acknowledged) return undefined;
  if (!humanConflict(record.pair)) return undefined;
  if (record.verdict?.decision !== "warn" || !(record.status === "judged" || record.status === "resolved" && record.resolution === "auto-cleared")) return undefined;
  if (record.pair.left.actor.memberId !== memberId && record.pair.right.actor.memberId !== memberId) return undefined;
  const model = record.verdict.adjudication;
  return {
    id: `${record.pair.id}:${record.revision}`,
    pairId: record.pair.id,
    revision: record.revision,
    warningKey: record.warningKey,
    summary: readableGuardText(model ? record.conflict?.explanationZh ?? model.userExplanation : record.conflict?.summaryZh ?? record.verdict.summary),
    suggestion: model ? readableGuardText(record.conflict?.suggestionZh ?? model.suggestedAction) : undefined,
    modelLabel: model ? model.status === "degraded" ? "研判失败，已改为提醒" : `由${model.source === "fast" ? "快判" : "深判"}模型判定，耗时 ${Math.round(model.latencyMs)} ms` : undefined,
    path: relationPathText(record.pair.path)
  };
}
