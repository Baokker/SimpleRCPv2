import { nanoid } from "nanoid";
import type { GuardDecision, GuardRequest } from "./types.js";

export interface PendingApproval {
  id: string;
  request: GuardRequest;
  decision: GuardDecision;
  createdAt: string;
  approverIds: string[];
  resolve: (approved: boolean) => void;
  timer: ReturnType<typeof setTimeout>;
}

export function createApprovalQueue(timeoutMs = 120_000) {
  const pending = new Map<string, PendingApproval>();
  const listeners = new Set<(approval: Omit<PendingApproval, "resolve" | "timer">) => void>();
  function enqueue(request: GuardRequest, decision: GuardDecision, approverIds: string[], requestTimeoutMs = timeoutMs) {
    let resolve!: (approved: boolean) => void;
    const result = new Promise<boolean>((nextResolve) => { resolve = nextResolve; });
    const id = nanoid(12);
    const timer = setTimeout(() => finish(id, false), requestTimeoutMs);
    const item: PendingApproval = { id, request, decision, createdAt: new Date().toISOString(), approverIds, resolve, timer };
    pending.set(id, item);
    const { resolve: _resolve, timer: _timer, ...publicItem } = item;
    for (const listener of listeners) listener(publicItem);
    return { id, result };
  }
  function finish(id: string, approved: boolean, approverId?: string) {
    const item = pending.get(id);
    if (!item) return false;
    if (approverId && !item.approverIds.includes(approverId)) return false;
    clearTimeout(item.timer);
    pending.delete(id);
    item.resolve(approved);
    return true;
  }
  return {
    enqueue,
    approve(id: string, memberId: string) { return finish(id, true, memberId); },
    reject(id: string, memberId: string) { return finish(id, false, memberId); },
    cancelForRun(runId: string) { for (const item of pending.values()) if (item.request.agentRunId === runId) finish(item.id, false); },
    list() { return [...pending.values()].map(({ resolve: _resolve, timer: _timer, ...item }) => item); },
    onPending(listener: (approval: Omit<PendingApproval, "resolve" | "timer">) => void) { listeners.add(listener); return () => listeners.delete(listener); },
    clear() { for (const item of pending.values()) finish(item.id, false); }
  };
}
