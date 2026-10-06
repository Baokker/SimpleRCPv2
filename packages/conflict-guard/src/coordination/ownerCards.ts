import type { GuardConflict } from "../model/types.js";
import type { ConflictGuardClock } from "../tracking/tracker.js";
import { conflictKind, participantOwner, type Participant } from "./arbitration.js";
import type { AgentIntent } from "./intents.js";

export interface OwnerCard {
  id: string;
  conflict: GuardConflict;
  owners: string[];
  intents: AgentIntent[];
  path: string;
  createdAt: number;
  expiresAt: number;
  accepted: string[];
  status: "waiting" | "accepted" | "yielded" | "timeout" | "closed";
  explanation: string;
  suggestion?: string;
  suggestionStatus: "analyzing" | "ready" | "unavailable";
  resolvedAt?: number;
  yieldingOwner?: string;
}
export interface Interruption {
  memberId: string;
  at: number;
  kind: ReturnType<typeof conflictKind> | "agent-system";
  level: "action" | "light";
  pairId: string;
  revision: number;
}
export function interruptionStats(events: Interruption[], now: number) {
  const members = [...new Set(events.map((event) => event.memberId))].sort();
  return members.map((memberId) => {
    const selected = events.filter((event) => event.memberId === memberId);
    return { memberId, interruptions: selected.filter((event) => event.level === "action").length, perHour: selected.filter((event) => event.level === "action" && event.at >= now - 3_600_000).length, light: selected.filter((event) => event.level === "light").length, byKind: Object.fromEntries(["human-human", "human-agent", "agent-agent-same-owner", "agent-agent-cross-owner", "agent-system"].map((kind) => [kind, selected.filter((event) => event.level === "action" && event.kind === kind).length])) };
  });
}
export function createOwnerCards(options: {
  clock: ConflictGuardClock;
  timeoutMs?: number;
  changed(type: string, card: OwnerCard): void;
  notify(event: Interruption): void;
  resolve(card: OwnerCard): void | Promise<void>;
  error(error: unknown): void;
}) {
  const cards = new Map<string, OwnerCard>();
  const timers = new Map<string, unknown>();
  const operations = new Set<Promise<void>>();
  const completedRuns = new Set<string>();
  const copy = (card: OwnerCard): OwnerCard => JSON.parse(JSON.stringify(card)) as OwnerCard;
  function finish(card: OwnerCard, status: OwnerCard["status"], owner?: string) {
    if (card.status !== "waiting") return;
    card.status = status; card.resolvedAt = options.clock.now(); card.yieldingOwner = owner;
    options.clock.clearTimeout(timers.get(card.id)); timers.delete(card.id);
    options.changed("arbitration_resolved", copy(card));
    const operation = Promise.resolve().then(() => options.resolve(copy(card))).catch(options.error);
    operations.add(operation); void operation.finally(() => operations.delete(operation));
  }
  return {
    open(conflict: GuardConflict, intents: AgentIntent[], path: string, recipients?: string[]) {
      const id = `${conflict.pairId}:${conflict.revision}`;
      const previous = cards.get(id); if (previous) return copy(previous);
      const owners = recipients ?? [...new Set([participantOwner(conflict.self as Participant), participantOwner(conflict.other as Participant)])];
      const card: OwnerCard = { id, conflict, owners, intents, path, createdAt: options.clock.now(), expiresAt: options.clock.now() + (options.timeoutMs ?? 300_000), accepted: [], status: "waiting", explanation: conflict.explanationZh ?? conflict.summaryZh, suggestionStatus: "analyzing" };
      cards.set(id, card);
      timers.set(id, options.clock.setTimeout(() => finish(card, "timeout", participantOwner(conflict.self as Participant)), options.timeoutMs ?? 300_000));
      options.changed("arbitration_opened", copy(card));
      for (const memberId of owners) options.notify({ memberId, at: options.clock.now(), level: "action", kind: conflictKind(conflict.self as Participant, conflict.other as Participant), pairId: conflict.pairId, revision: conflict.revision });
      return copy(card);
    },
    suggestion(id: string, result?: { explanation: string; suggestion: string }) {
      const card = cards.get(id); if (!card || card.status !== "waiting") return;
      card.suggestionStatus = result?.suggestion.trim() ? "ready" : "unavailable";
      if (result?.suggestion.trim()) { card.explanation = result.explanation.trim(); card.suggestion = result.suggestion.trim(); }
      options.changed("arbitration_updated", copy(card));
    },
    act(id: string, memberId: string, action: "accept" | "yield" | "chat") {
      const card = cards.get(id);
      if (!card || card.status !== "waiting" || !card.owners.includes(memberId)) throw new Error("当前卡片不允许此操作");
      if (action === "accept") {
        if (!card.suggestion) throw new Error("当前没有可采纳的建议");
        if (!card.accepted.includes(memberId)) card.accepted.push(memberId);
        if (card.owners.every((owner) => card.accepted.includes(owner))) finish(card, "accepted");
        else options.changed("arbitration_updated", copy(card));
      } else if (action === "yield") finish(card, "yielded", memberId);
      else options.changed("arbitration_chat", copy(card));
      return copy(card);
    },
    closeRun(runId: string) { for (const card of cards.values()) if ([card.conflict.self, card.conflict.other].some((actor) => actor.kind === "agent" && actor.runId === runId)) finish(card, "closed"); },
    finishRun(runId: string) {
      completedRuns.add(runId);
      for (const card of cards.values()) if ([card.conflict.self, card.conflict.other].every((actor) => actor.kind === "agent" && completedRuns.has(actor.runId))) finish(card, "closed");
    },
    list(memberId?: string) { return [...cards.values()].filter((card) => !memberId || card.owners.includes(memberId)).map(copy); },
    stats() { const list = [...cards.values()]; return { outcomes: Object.fromEntries(["accepted", "yielded", "timeout", "closed"].map((status) => [status, list.filter((card) => card.status === status).length])), suspendedMs: list.reduce((sum, card) => sum + (card.resolvedAt ?? options.clock.now()) - card.createdAt, 0) }; },
    async dispose() { for (const card of cards.values()) finish(card, "closed"); await Promise.all(operations); }
  };
}
