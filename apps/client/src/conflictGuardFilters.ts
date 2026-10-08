import type { ConflictGuardState, GuardActorRef } from "./conflictGuardTypes";
import { guardActorKey } from "./conflictGuardPresentation";

export type PairKind = "human-human" | "human-agent" | "agent-agent";
export interface GuardListFilter { kinds: PairKind[]; mine: boolean }
export const pairKindLabels: Record<PairKind, string> = {
  "human-human": "人之间", "human-agent": "人与 Agent", "agent-agent": "Agent 之间"
};

export function actorIsMine(actor: GuardActorRef, memberId?: string) {
  return Boolean(memberId && (actor.kind === "agent" ? actor.ownerId === memberId : actor.memberId === memberId));
}

export function pairKind(pair: ConflictGuardState["candidatePairs"][number]): PairKind {
  if (pair.left.actor.kind === "agent" && pair.right.actor.kind === "agent") return "agent-agent";
  return pair.left.actor.kind === "agent" || pair.right.actor.kind === "agent" ? "human-agent" : "human-human";
}

export function pairMatches(pair: ConflictGuardState["candidatePairs"][number], filter: GuardListFilter, memberId?: string) {
  return (!filter.kinds.length || filter.kinds.includes(pairKind(pair)))
    && (!filter.mine || actorIsMine(pair.left.actor, memberId) || actorIsMine(pair.right.actor, memberId));
}

export function activeSymbolRows(state: ConflictGuardState, filter: GuardListFilter, memberId?: string) {
  const related = [...state.candidatePairs, ...(state.pairDecisions ?? []).filter((record) => !["closed", "resolved"].includes(record.status)).map((record) => record.pair)];
  return state.activeSymbols.flatMap((group) => group.symbols.filter((symbol) => {
    const pairs = related.filter((pair) => [pair.left, pair.right].some((side) => guardActorKey(side.actor) === guardActorKey(group.actor) && (side.symbols ?? [side.symbol]).includes(symbol.key)));
    const typeMatches = !filter.kinds.length || pairs.some((pair) => filter.kinds.includes(pairKind(pair)));
    const mineMatches = !filter.mine || actorIsMine(group.actor, memberId) || pairs.some((pair) => actorIsMine(pair.left.actor, memberId) || actorIsMine(pair.right.actor, memberId));
    return typeMatches && mineMatches;
  }).map((symbol) => ({ actor: group.actor, symbol }))).sort((left, right) => right.symbol.lastTouchedAt - left.symbol.lastTouchedAt || left.symbol.key.localeCompare(right.symbol.key));
}
