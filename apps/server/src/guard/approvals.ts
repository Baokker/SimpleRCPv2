import { nanoid } from "nanoid";
import type { GuardDecision, GuardRequest } from "./types.js";

export type ApprovalOutcome = "approved" | "rejected" | "withdrawn" | "timeout" | "cancelled";

export interface PendingApproval {
  id: string;
  request: GuardRequest;
  decision: GuardDecision;
  createdAt: string;
  expiresAt?: string;
  approverIds: string[];
  noApprover?: boolean;
  resolve: (approved: boolean) => void;
  resolveOutcome: (outcome: ApprovalOutcome) => void;
  resolveApprover: (memberId: string | undefined) => void;
  timer?: ReturnType<typeof setTimeout>;
}

export function createApprovalQueue(timeoutMs = 120_000) {
  const pending = new Map<string, PendingApproval>();
  const listeners = new Set<(approval: Omit<PendingApproval, "resolve" | "resolveOutcome" | "resolveApprover" | "timer">) => void>();
  const resolutionListeners = new Set<(id: string, outcome: ApprovalOutcome) => void>();
  function enqueue(request: GuardRequest, decision: GuardDecision, approverIds: string[], requestTimeoutMs: number | null | undefined = undefined, noApprover = false) {
    let resolve!: (approved: boolean) => void;
    let resolveOutcome!: (outcome: ApprovalOutcome) => void;
    let resolveApprover!: (memberId: string | undefined) => void;
    const result = new Promise<boolean>((nextResolve) => { resolve = nextResolve; });
    const outcome = new Promise<ApprovalOutcome>((nextResolve) => { resolveOutcome = nextResolve; });
    const approver = new Promise<string | undefined>((nextResolve) => { resolveApprover = nextResolve; });
    const id = nanoid(12);
    const createdAt = new Date().toISOString();
    const effectiveTimeoutMs = requestTimeoutMs === undefined ? timeoutMs : requestTimeoutMs;
    const timer = effectiveTimeoutMs === null ? undefined : setTimeout(() => finish(id, "timeout"), effectiveTimeoutMs);
    const expiresAt = effectiveTimeoutMs === null ? undefined : new Date(Date.parse(createdAt) + effectiveTimeoutMs).toISOString();
    const item: PendingApproval = { id, request, decision, createdAt, expiresAt, approverIds, noApprover, resolve, resolveOutcome, resolveApprover, timer };
    pending.set(id, item);
    const { resolve: _resolve, resolveOutcome: _resolveOutcome, resolveApprover: _resolveApprover, timer: _timer, ...publicItem } = item;
    for (const listener of listeners) listener(publicItem);
    return { id, result, outcome, approver };
  }
  function finish(id: string, outcome: ApprovalOutcome, approverId?: string) {
    const item = pending.get(id);
    if (!item) return false;
    if (approverId && item.approverIds.length > 0 && !item.approverIds.includes(approverId)) return false;
    if (item.timer) clearTimeout(item.timer);
    pending.delete(id);
    item.resolve(outcome === "approved");
    item.resolveOutcome(outcome);
    item.resolveApprover(approverId);
    for (const listener of resolutionListeners) listener(id, outcome);
    return true;
  }
  return {
    enqueue,
    approve(id: string, memberId: string) { return finish(id, "approved", memberId); },
    reject(id: string, memberId: string) { return finish(id, "rejected", memberId); },
    withdraw(id: string) { return finish(id, "withdrawn"); },
    cancelForRun(runId: string) { for (const item of pending.values()) if (item.request.agentRunId === runId) finish(item.id, "cancelled"); },
    list() { return [...pending.values()].map(({ resolve: _resolve, resolveOutcome: _resolveOutcome, resolveApprover: _resolveApprover, timer: _timer, ...item }) => item); },
    onPending(listener: (approval: Omit<PendingApproval, "resolve" | "resolveOutcome" | "resolveApprover" | "timer">) => void) { listeners.add(listener); return () => listeners.delete(listener); },
    onResolution(listener: (id: string, outcome: ApprovalOutcome) => void) { resolutionListeners.add(listener); return () => resolutionListeners.delete(listener); },
    clear() { for (const item of pending.values()) finish(item.id, "cancelled"); }
  };
}
