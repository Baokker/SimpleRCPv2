export interface AgentPermissionRequest {
  id: string;
  sessionID: string;
  permission: string;
  metadata: Record<string, unknown>;
  patterns?: string[];
  tool?: { messageID: string; callID: string };
}

export interface PermissionDecision {
  reply: "once" | "reject" | "defer";
  message?: string;
  onApproved?: () => void | Promise<void>;
  onRejected?: () => void | Promise<void>;
}

export type PermissionHandler = (request: AgentPermissionRequest, signal: AbortSignal) => Promise<PermissionDecision>;
export interface PermissionHandlerRegistration { handle: PermissionHandler; budgetMs?: number | null }

export const AGENT_EDIT_PERMISSIONS = new Set(["edit", "write", "apply_patch"]);

export class PermissionEditRejected extends Error {}

export function createPermissionDispatcher(options: {
  handlers: Array<PermissionHandler | PermissionHandlerRegistration>;
  reply(input: { requestId: string; sessionId: string; reply: "once" | "reject"; message?: string }): Promise<void>;
  trace(type: string, data: Record<string, unknown>): Promise<void>;
  pause?: () => () => void;
  budgetMs?: number;
  deferBudgetMs?: number;
  unavailable?(file: string): void;
  fileKey?(request: AgentPermissionRequest): string;
}) {
  const requests = new Map<string, Promise<void>>();
  const controller = new AbortController();
  const deferred = new Map<string, (decision: PermissionDecision) => void>();
  const internalFailures = new Map<string, number>();
  const trace = async (type: string, data: Record<string, unknown>) => {
    try { await options.trace(type, data); }
    catch { console.error("Agent permission trace failed", { type }); }
  };
  async function handle(request: AgentPermissionRequest) {
    const startedAt = performance.now();
    let decision: PermissionDecision = { reply: "once" };
    const approvals: NonNullable<PermissionDecision["onApproved"]>[] = [];
    const rejections: NonNullable<PermissionDecision["onRejected"]>[] = [];
    let resume: (() => void) | undefined;
    const signal = controller.signal;
    const requestedFile = String(request.metadata.filepath ?? request.metadata.filePath ?? request.patterns?.[0] ?? "unknown");
    let file = requestedFile;
    const awaitSignal = async <T>(work: Promise<T>, incoming: AbortSignal): Promise<T> => {
      let fail!: () => void;
      const abort = new Promise<never>((_resolve, reject) => {
        fail = () => reject(new Error("审批分析超过时间预算或已取消"));
        if (incoming.aborted) fail(); else incoming.addEventListener("abort", fail, { once: true });
      });
      try { return await Promise.race([work, abort]); }
      finally { incoming.removeEventListener("abort", fail); }
    };
    try {
      if ((internalFailures.get(file) ?? 0) < 2) file = options.fileKey?.(request) ?? file;
      resume = options.pause?.();
      if ((internalFailures.get(file) ?? 0) >= 2) {
        decision = { reply: "reject", message: "冲突检查暂不可用，请停止修改此文件并向用户报告。" };
        if (internalFailures.get(file) === 2) { internalFailures.set(file, 3); options.unavailable?.(file); }
      } else for (const registration of options.handlers) {
        const handler = typeof registration === "function" ? registration : registration.handle;
        const budget = typeof registration === "function" ? options.budgetMs ?? 30_000 : registration.budgetMs === null ? null : registration.budgetMs ?? options.budgetMs ?? 30_000;
        const incoming = budget === null ? signal : AbortSignal.any([signal, AbortSignal.timeout(budget)]);
        const work = Promise.resolve().then(() => handler(request, incoming));
        void work.then(async (result) => { if (incoming.aborted) await result.onRejected?.(); }).catch((error) => trace("permission_cleanup_error", { requestId: request.id, reason: error instanceof Error ? error.message : String(error) }));
        decision = await awaitSignal(work, incoming);
        if (decision.onRejected) rejections.push(decision.onRejected);
        const approval = decision.onApproved;
        if (decision.reply === "defer") {
          const pending = new Promise<PermissionDecision>((resolve) => deferred.set(request.id, resolve));
          await trace("permission_deferred", { requestId: request.id, sessionId: request.sessionID });
          const deferredSignal = AbortSignal.any([incoming, AbortSignal.timeout(options.deferBudgetMs ?? options.budgetMs ?? 30_000)]);
          decision = await awaitSignal(pending, deferredSignal);
          if (decision.onRejected) rejections.push(decision.onRejected);
        }
        if (decision.reply === "reject") break;
        if (approval) approvals.push(approval);
        if (decision.onApproved && decision.onApproved !== approval) approvals.push(decision.onApproved);
      }
      if (signal.aborted) throw new Error("审批分析已取消");
      if (decision.reply === "once") for (const approve of approvals) await awaitSignal(Promise.resolve().then(approve), signal);
      if ((internalFailures.get(file) ?? 0) < 2) {
        internalFailures.delete(file);
        internalFailures.delete(requestedFile);
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      if (error instanceof PermissionEditRejected) {
        internalFailures.delete(file);
        internalFailures.delete(requestedFile);
      }
      else if (!signal.aborted) internalFailures.set(file, (internalFailures.get(file) ?? 0) + 1);
      decision = { reply: "reject", message: error instanceof PermissionEditRejected ? reason : `冲突检查拒绝本次修改，原因：${reason}。请停止重复提交同一修改并向用户报告。` };
      await trace(error instanceof PermissionEditRejected ? "permission_rejected" : "permission_handler_error", { requestId: request.id, file, reason });
    } finally {
      deferred.delete(request.id);
    }
    try {
      if (signal.aborted && decision.reply === "once") decision = { reply: "reject", message: "审批分析已取消，本次修改未获批准。" };
      await options.reply({ requestId: request.id, sessionId: request.sessionID, reply: decision.reply === "once" ? "once" : "reject", ...(decision.message ? { message: decision.message } : {}) });
      await trace("permission_reply", { requestId: request.id, sessionId: request.sessionID, reply: decision.reply, message: decision.message, approvalWaitMs: performance.now() - startedAt });
    } catch (error) {
      decision = { reply: "reject" };
      await trace("permission_reply_error", { requestId: request.id, reason: error instanceof Error ? error.message : String(error) });
    } finally {
      if (decision.reply === "reject") for (const reject of rejections) {
        try { await reject(); }
        catch (error) { await trace("permission_cleanup_error", { requestId: request.id, reason: error instanceof Error ? error.message : String(error) }); }
      }
      try { resume?.(); }
      catch (error) { await trace("permission_resume_error", { requestId: request.id, reason: error instanceof Error ? error.message : String(error) }); }
    }
  }
  return {
    dispatch(request: AgentPermissionRequest) {
      let pending = requests.get(request.id);
      if (!pending) {
        pending = handle(request).finally(() => requests.delete(request.id));
        requests.set(request.id, pending);
      }
      return pending;
    },
    resolve(requestId: string, decision: { reply: "once" | "reject"; message?: string }) {
      const resolve = deferred.get(requestId);
      if (!resolve) return false;
      deferred.delete(requestId);
      resolve(decision);
      return true;
    },
    async drain() { await Promise.all(requests.values()); },
    dispose() { controller.abort(); }
  };
}
