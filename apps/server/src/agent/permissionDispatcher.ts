export interface AgentPermissionRequest {
  id: string;
  sessionID: string;
  permission: string;
  metadata: Record<string, unknown>;
  patterns?: string[];
  tool?: { messageID: string; callID: string };
}

export interface PermissionDecision {
  reply: "once" | "reject";
  message?: string;
  onApproved?: () => void | Promise<void>;
}

export type PermissionHandler = (request: AgentPermissionRequest, signal: AbortSignal) => Promise<PermissionDecision>;

export const AGENT_EDIT_PERMISSIONS = new Set(["edit", "write", "apply_patch"]);

export function createPermissionDispatcher(options: {
  handlers: PermissionHandler[];
  reply(input: { requestId: string; reply: "once" | "reject"; message?: string }): Promise<void>;
  trace(type: string, data: Record<string, unknown>): Promise<void>;
  pause?: () => () => void;
  budgetMs?: number;
}) {
  const requests = new Map<string, Promise<void>>();
  const controller = new AbortController();
  const trace = async (type: string, data: Record<string, unknown>) => {
    try { await options.trace(type, data); }
    catch { console.error("Agent permission trace failed", { type }); }
  };
  async function handle(request: AgentPermissionRequest) {
    const resume = options.pause?.();
    const startedAt = performance.now();
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(options.budgetMs ?? 30_000)]);
    let decision: PermissionDecision = { reply: "once" };
    const approvals: NonNullable<PermissionDecision["onApproved"]>[] = [];
    let fail: () => void;
    const abort = new Promise<never>((_resolve, reject) => {
      fail = () => reject(new Error("Permission analysis cancelled or timed out; retry later."));
      if (signal.aborted) fail(); else signal.addEventListener("abort", fail, { once: true });
    });
    void abort.catch(() => undefined);
    try {
      for (const handler of options.handlers) {
        decision = await Promise.race([handler(request, signal), abort]);
        if (decision.reply === "reject") break;
        if (decision.onApproved) approvals.push(decision.onApproved);
      }
      if (decision.reply === "once") for (const approve of approvals) await approve();
    } catch (error) {
      decision = { reply: "reject", message: "Conflict guard could not verify this edit. Please retry later." };
      await trace("permission_handler_error", { requestId: request.id, reason: error instanceof Error ? error.message : String(error) });
    } finally {
      signal.removeEventListener("abort", fail!);
      requests.delete(request.id);
    }
    try {
      await options.reply({ requestId: request.id, reply: decision.reply, ...(decision.message ? { message: decision.message } : {}) });
      await trace("permission_reply", { requestId: request.id, reply: decision.reply, message: decision.message, approvalWaitMs: performance.now() - startedAt });
    } catch (error) {
      await trace("permission_reply_error", { requestId: request.id, reason: error instanceof Error ? error.message : String(error) });
    } finally { resume?.(); }
  }
  return {
    dispatch(request: AgentPermissionRequest) {
      let pending = requests.get(request.id);
      if (!pending) { pending = handle(request); requests.set(request.id, pending); }
      return pending;
    },
    dispose() { controller.abort(); }
  };
}
