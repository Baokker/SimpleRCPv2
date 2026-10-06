import type { ActorRef } from "../model/types.js";
import type { ZoneVerdict } from "../routing/classifier.js";

export type ArbitrationMode = "owner" | "all-human" | "all-auto";
export type Participant = Extract<ActorRef, { kind: "human" | "agent" }>;
export type ConflictKind = "human-human" | "human-agent" | "agent-agent-same-owner" | "agent-agent-cross-owner";
export interface ArbitrationAction {
  type: "continue" | "freeze-humans" | "reject-agent" | "retry-agent" | "owner-card" | "reject-later";
  kind: ConflictKind;
  recipients: string[];
  lightRecipients: string[];
  later: Participant;
}
export function participantKey(actor: ActorRef) {
  return actor.kind === "human" ? `human:${actor.memberId}` : actor.kind === "agent" ? `agent:${actor.runId}` : actor.kind;
}
export function participantOwner(actor: Participant) { return actor.kind === "human" ? actor.memberId : actor.ownerId; }
export function conflictKind(left: Participant, right: Participant): ConflictKind {
  if (left.kind === "human" && right.kind === "human") return "human-human";
  if (left.kind !== right.kind) return "human-agent";
  return participantOwner(left) === participantOwner(right) ? "agent-agent-same-owner" : "agent-agent-cross-owner";
}
export function arbitrate(pair: { left: Participant; right: Participant; later: Participant }, verdict: Pick<ZoneVerdict, "zone" | "decision">, mode: ArbitrationMode = "owner"): ArbitrationAction {
  const kind = conflictKind(pair.left, pair.right);
  const result: ArbitrationAction = { type: "continue", kind, recipients: [], lightRecipients: [], later: pair.later };
  if (verdict.decision !== "lock" && verdict.zone !== "black") return result;
  if (mode === "all-auto") return { ...result, type: "reject-later" };
  if (mode === "all-human") return { ...result, type: kind === "human-human" ? "freeze-humans" : "owner-card", recipients: [...new Set([participantOwner(pair.left), participantOwner(pair.right)])] };
  if (kind === "human-human") return { ...result, type: "freeze-humans", recipients: [participantOwner(pair.left), participantOwner(pair.right)] };
  if (kind === "human-agent") {
    const agent = pair.left.kind === "agent" ? pair.left : pair.right;
    return { ...result, type: "reject-agent", later: agent, lightRecipients: [participantOwner(agent)] };
  }
  if (kind === "agent-agent-same-owner") return { ...result, type: "retry-agent" };
  return { ...result, type: "owner-card", recipients: [...new Set([participantOwner(pair.left), participantOwner(pair.right)])] };
}
