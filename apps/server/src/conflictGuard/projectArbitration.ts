import { getYDoc, docs } from "y-websocket/bin/utils";
import { arbitrate, buildIntentInjection, conflictKind, createIntentBoard, createOwnerCards, interruptionStats, participantKey, proposalSymbolKeys, sanitize, type ActiveChangeSet, type ActorRef, type AgentIntent, type AgentTextProposal, type ArbitrationMode, type ConflictGuardClock, type GuardConflict, type Interruption, type OwnerCard, type Participant, type SemanticIndex } from "@simplercp/conflict-guard";
import type { AgentPermissionRequest } from "../agent/permissionDispatcher.js";
import type { createProjectAgentGuard } from "./projectAgentGuard.js";

type AgentGuard = ReturnType<typeof createProjectAgentGuard>;
type Judgement = Awaited<ReturnType<AgentGuard["judge"]>>;
interface RunHooks {
  resolve(requestId: string, decision: { reply: "reject"; message: string }): boolean;
  cancel(): Promise<void>;
  continue?(instruction: string): Promise<void>;
}
export function createProjectArbitration(options: {
  projectId: string;
  clock: ConflictGuardClock;
  mode: ArbitrationMode;
  injection: boolean;
  guard: AgentGuard;
  index: SemanticIndex;
  active(): ActiveChangeSet[];
  display(actor: ActorRef): string;
  emit(event: Record<string, unknown>): void;
  changed(): void;
  sensitiveValues: string[];
  resolveHuman?(conflict: GuardConflict, yielding?: string): void;
  suggest?(conflict: GuardConflict, intents: AgentIntent[], input: Judgement["input"], signal: AbortSignal): Promise<{ explanation: string; suggestion: string } | undefined>;
}) {
  const documentName = `${options.projectId}|conflict-guard-intents`;
  const document = getYDoc(documentName);
  const destroy = document.destroy.bind(document);
  document.destroy = () => { docs.set(documentName, document); };
  const intentMap = document.getMap<AgentIntent>("intents");
  const hooks = new Map<string, RunHooks>();
  const runOrder = new Map<string, number>();
  let runSequence = 0;
  const completedHooks = new Map<string, RunHooks>();
  const pending = new Map<string, { runId: string; requestId: string; cardId: string }>();
  const finished = new Map<string, Set<() => void>>();
  const retryCounts = new Map<string, number>();
  let automaticRetries = 0;
  const reviewWaiters = new Map<string, Map<string, (action: "revert" | "continue" | "retry" | "warn") => void>>();
  const continuationCounts = new Map<string, number>();
  const interruptions: Interruption[] = [];
  const adviceController = new AbortController();
  const emit = (event: Record<string, unknown>) => options.emit(sanitize(event, options.sensitiveValues));
  const removeNoticeListener = options.guard.onEvent((event) => {
    if (["agent_write_attributed", "t2_shadow"].includes(String(event.type))) {
      const actor = event.actor as Extract<ActorRef, { kind: "agent" }>;
      if (board.get(actor.runId)) board.actual(actor.runId, options.guard.actualScope(actor.runId));
    }
    if (event.type !== "agent_notice" || event.level !== "light") return;
    const notice = event.notice as { id: string; memberId: string; at: number; conflict?: GuardConflict };
    const conflict = notice.conflict;
    const interruption: Interruption = { memberId: notice.memberId, at: notice.at, level: "light", kind: conflict ? conflictKind(conflict.self as Participant, conflict.other as Participant) : "agent-system", pairId: conflict?.pairId ?? notice.id, revision: conflict?.revision ?? 0 };
    interruptions.push(interruption); emit({ type: "interruption", ...interruption }); options.changed();
  });
  const board = createIntentBoard({ changed(type, intent, reason) {
    intent = sanitize(intent, options.sensitiveValues);
    document.transact(() => intentMap.set(intent.actor.runId, intent), "intent-board");
    emit({ type, intent, reason }); options.changed();
  } });
  const cards = createOwnerCards({ clock: options.clock, changed(type, card) {
    emit({ type, card });
    for (const intent of card.intents) if (board.get(intent.actor.runId) && card.status === "waiting") board.status(intent.actor.runId, "blocked");
    options.changed();
  }, notify(event) {
    interruptions.push(event); emit({ type: "interruption", ...event });
    const card = cards.list().find((entry) => entry.conflict.pairId === event.pairId && entry.conflict.revision === event.revision);
    const runId = card?.intents.find((intent) => intent.owner === event.memberId)?.actor.runId;
    if (runId) options.guard.notifyOwner(runId, "Agent 冲突需要你处理，请打开意图差异卡片。", card?.conflict, "action");
  }, async resolve(card) {
    let continued = false;
    try {
      const actors = [card.conflict.self, card.conflict.other].filter((actor): actor is Extract<ActorRef, { kind: "agent" }> => actor.kind === "agent");
      const yielding = card.status === "timeout" ? card.conflict.self : actors.find((actor) => actor.ownerId === card.yieldingOwner);
      if (card.status === "accepted" && card.suggestion && card.conflict.self.kind === "agent") {
        const intent = board.get(card.conflict.self.runId);
        if (intent) board.task(intent.actor.runId, `${intent.task}\n追加指令：${card.suggestion}`);
      }
      for (const request of pending.values()) if (request.cardId === card.id) {
        const message = card.status === "accepted" ? request.runId === (card.conflict.self.kind === "agent" ? card.conflict.self.runId : undefined) ? `双方属主已采纳建议。追加指令：${card.suggestion}。请重新读取文件后按建议修改。` : "双方已完成仲裁，请重新读取相关文件并继续你的原任务。" : card.status === "closed" ? `与 ${card.conflict.otherDisplayName} 的冲突处理已经结束，请重新读取文件后继续。` : request.runId === (yielding?.kind === "agent" ? yielding.runId : undefined) ? "属主仲裁要求本 Agent 让路，请停止相关修改。" : "另一方已让路，请重新读取文件后继续。";
        hooks.get(request.runId)?.resolve(request.requestId, { reply: "reject", message });
        pending.delete(`${request.runId}:${request.requestId}`);
        if (board.get(request.runId)) board.status(request.runId, "running");
      }
      if (yielding?.kind === "agent") { options.guard.requestRevert(yielding.runId); const hook = hooks.get(yielding.runId) ?? completedHooks.get(yielding.runId); if (hook) await hook.cancel(); else await options.guard.withdraw(yielding.runId); }
      if (card.status === "accepted" && card.suggestion && card.conflict.self.kind === "agent" && reviewWaiters.has(card.id)) {
        const runId = card.conflict.self.runId;
        const hook = hooks.get(runId);
        if (!hook?.continue || (continuationCounts.get(runId) ?? 0) >= 2) throw new Error("追加执行未完成，请人工检查冲突修改");
        continuationCounts.set(runId, (continuationCounts.get(runId) ?? 0) + 1);
        await hook.continue(`双方属主已采纳建议。请重新读取相关文件，执行追加指令：${card.suggestion}。完成后运行项目测试。`);
        continued = true;
      }
      if (card.conflict.self.kind === "human" || card.conflict.other.kind === "human") options.resolveHuman?.(card.conflict, card.yieldingOwner);
      if (card.status === "timeout") for (const actor of actors) options.guard.notifyOwner(actor.runId, "意图差异卡片超过等待时间，后到的 Agent 已让路。", card.conflict);
    } finally {
      for (const request of pending.values()) if (request.cardId === card.id) { hooks.get(request.runId)?.resolve(request.requestId, { reply: "reject", message: "仲裁处理已结束，请重新读取文件后继续。" }); pending.delete(`${request.runId}:${request.requestId}`); }
      for (const [runId, complete] of reviewWaiters.get(card.id) ?? []) {
        const owner = board.get(runId)?.owner;
        const yieldingOwner = card.status === "timeout" && card.conflict.self.kind === "agent" ? card.conflict.self.ownerId : card.yieldingOwner;
        complete(card.status === "closed" || card.status === "accepted" && !continued ? "warn" : card.status === "accepted" || owner !== yieldingOwner ? "retry" : "revert");
      }
      reviewWaiters.delete(card.id);
    }
  }, error(error) { emit({ type: "arbitration_error", reason: error instanceof Error ? error.message : String(error) }); } });
  function related(left: string[], right: string[]) { return left.some((key) => right.includes(key)) || options.index.findPaths(left, right, 2).length > 0; }
  function injection(runId: string, scope?: string[]) {
    const intent = board.get(runId); if (!intent) return "";
    const inferred = options.index.listFiles?.().flatMap((file) => options.index.symbolsInFile(file).filter((symbol) => intent.task.includes(symbol.name) || intent.task.includes(file)).map((symbol) => symbol.key)) ?? [];
    const result = buildIntentInjection({ enabled: options.injection, actor: intent.actor, scope: scope?.length ? scope : [...intent.plannedScope, ...intent.actualScope, ...inferred], intents: board.list(), changes: options.active().flatMap((set) => [...set.files.values()].flatMap((file) => (file.symbols ?? []).map((symbol) => ({ actor: set.actor, symbol: symbol.key, summary: symbol.after.slice(0, 300) })))), related, display: options.display });
    if (options.injection) emit({ type: "intent_injected", actor: intent.actor, inputHash: result.hash, count: result.count });
    return result.text;
  }
  function pause(runId: string, request: AgentPermissionRequest, card: OwnerCard) {
    const key = `${runId}:${request.id}`;
    pending.set(key, { runId, requestId: request.id, cardId: card.id }); board.status(runId, "blocked");
    return { decision: "lock" as const, defer: true, onRejected: () => { pending.delete(key); } };
  }
  function openCard(conflict: GuardConflict, input: Judgement["input"], recipients: string[]) {
    const existing = cards.list().find((card) => card.status === "waiting" && [card.conflict.self, card.conflict.other].some((actor) => participantKey(actor) === participantKey(conflict.self)) && [card.conflict.self, card.conflict.other].some((actor) => participantKey(actor) === participantKey(conflict.other)) && related([conflict.symbols.self, conflict.symbols.other], [card.conflict.symbols.self, card.conflict.symbols.other]));
    if (existing) return existing;
    const intents = [conflict.self, conflict.other].flatMap((actor) => actor.kind === "agent" && board.get(actor.runId) ? [board.get(actor.runId)!] : []);
    const path = input?.path?.hops.map((hop) => `${hop.from} ${hop.kind} ${hop.to}`).join("；") ?? "同一符号";
    const card = cards.open(conflict, intents, path, recipients);
    void Promise.resolve().then(() => options.suggest?.(conflict, intents, input, adviceController.signal)).then((suggestion) => cards.suggestion(card.id, suggestion)).catch((error) => { cards.suggestion(card.id); emit({ type: "arbitration_suggestion_error", reason: error instanceof Error ? error.message : String(error) }); });
    return card;
  }
  async function judge(runId: string, request: AgentPermissionRequest, proposals: AgentTextProposal[], signal: AbortSignal): Promise<Judgement & { defer?: boolean }> {
    emit({ type: "agent_proposal", actor: options.guard.actor(runId), requestId: request.id, proposals });
    board.status(runId, "waiting");
    const scope = [...new Set(proposals.flatMap((proposal) => [...proposalSymbolKeys(proposal)]))];
    const existing = cards.list().find((card) => card.status === "waiting" && [card.conflict.self, card.conflict.other].some((actor) => actor.kind === "agent" && actor.runId === runId) && related(scope, [card.conflict.symbols.self, card.conflict.symbols.other]));
    if (existing) return pause(runId, request, existing);
    let result = await options.guard.judge(runId, proposals, signal);
    if (!result.conflict || result.decision !== "lock") {
      board.status(runId, "running");
      const approve = result.onApproved;
      return { ...result, ...(result.decision === "lock" ? { message: [result.message, injection(runId, scope)].filter(Boolean).join("\n\n") } : {}), onApproved: () => { approve?.(); board.actual(runId, scope); } };
    }
    const conflict = result.conflict;
    const action = arbitrate({ left: conflict.self as Participant, right: conflict.other as Participant, later: conflict.self as Participant }, conflict, options.mode);
    emit({ type: "arbitration_action", conflict, action });
    if (action.type === "owner-card") {
      const card = openCard(conflict, result.input, action.recipients);
      if (card.status !== "waiting") return { ...result, message: card.status === "accepted" ? `双方已采纳建议：${card.suggestion}。请调整本次修改并重新读取文件。` : "此冲突已经处理，请重新读取文件并调整修改。" };
      return pause(runId, request, card);
    }
    if (action.type === "retry-agent" && conflict.other.kind === "agent") {
      const otherRunId = conflict.other.runId;
      const retryKey = `${runId}:${otherRunId}`;
      while ((retryCounts.get(retryKey) ?? 0) < 2 && result.decision === "lock") {
        retryCounts.set(retryKey, (retryCounts.get(retryKey) ?? 0) + 1);
        automaticRetries += 1;
        emit({ type: "arbitration_retry", actor: conflict.self, other: conflict.other, attempt: retryCounts.get(retryKey) });
        if (hooks.has(otherRunId)) await waitForRun(otherRunId, signal);
        if (signal.aborted) break;
        result = await options.guard.judge(runId, proposals, signal);
      }
      if (result.decision === "lock") options.guard.notifyOwner(runId, "同属主自动处理未完成，请检查关联任务。", conflict);
      else {
        result.onRejected?.(); board.status(runId, "running");
        return { decision: "lock", message: "前一个同属主任务已经结束，本次提案需要基于当前版本重新生成。请重新读取关联文件后继续修改。" };
      }
    }
    for (const memberId of action.lightRecipients) {
      const event: Interruption = { memberId, at: options.clock.now(), level: "light", kind: action.kind, pairId: conflict.pairId, revision: conflict.revision };
      if (!interruptions.some((entry) => entry.memberId === memberId && entry.pairId === event.pairId && entry.revision === event.revision && entry.level === "light")) options.guard.notifyOwner(runId, conflict.summaryZh, conflict);
    }
    board.status(runId, "running");
    const context = injection(runId, scope);
    return { ...result, message: [result.message, context].filter(Boolean).join("\n\n") };
  }
  function waitForRun(runId: string, signal: AbortSignal) {
    return new Promise<void>((resolve) => {
      const waiters = finished.get(runId) ?? new Set();
      const timer = options.clock.setTimeout(done, 300_000);
      function done() { options.clock.clearTimeout(timer); signal.removeEventListener("abort", done); waiters.delete(done); resolve(); }
      waiters.add(done); finished.set(runId, waiters); signal.addEventListener("abort", done, { once: true }); if (signal.aborted) done();
    });
  }
  return {
    document, board, cards, judge, injection,
    observe(conflict: GuardConflict, input: Judgement["input"]) {
      const action = arbitrate({ left: conflict.self as Participant, right: conflict.other as Participant, later: conflict.self as Participant }, conflict, options.mode);
      emit({ type: "arbitration_action", point: "T1", conflict, action });
      if (action.type === "owner-card") openCard(conflict, input, action.recipients);
      for (const memberId of action.lightRecipients) {
        const event: Interruption = { memberId, at: options.clock.now(), kind: action.kind, level: "light", pairId: conflict.pairId, revision: conflict.revision };
        if (interruptions.some((entry) => entry.memberId === memberId && entry.pairId === event.pairId && entry.revision === event.revision)) continue;
        const agent = [conflict.self, conflict.other].find((actor) => actor.kind === "agent");
        if (agent?.kind === "agent") options.guard.notifyOwner(agent.runId, conflict.summaryZh, conflict);
      }
    },
    act(cardId: string, memberId: string, action: "accept" | "yield" | "chat") {
      const card = cards.act(cardId, memberId, action);
      emit({ type: "ui_action", action: `arbitration_${action}`, cardId, memberId, pairId: card.conflict.pairId, actors: [card.conflict.self, card.conflict.other] });
      return card;
    },
    recordInterruption(event: Interruption) {
      if (interruptions.some((entry) => entry.memberId === event.memberId && entry.pairId === event.pairId && entry.revision === event.revision && entry.level === event.level)) return;
      interruptions.push(event); emit({ type: "interruption", ...event }); options.changed();
    },
    review(runId: string, conflict: GuardConflict, input: Judgement["input"]): Promise<"revert" | "continue" | "retry" | "warn"> {
      const action = arbitrate({ left: conflict.self as Participant, right: conflict.other as Participant, later: conflict.self as Participant }, conflict, options.mode);
      emit({ type: "arbitration_action", point: "T3", conflict, action });
      if (action.type === "retry-agent" && conflict.other.kind === "agent") {
        return (async () => {
          if ((runOrder.get(runId) ?? 0) < (runOrder.get(conflict.other.kind === "agent" ? conflict.other.runId : "") ?? 0)) return "continue" as const;
          const hook = hooks.get(runId);
          if (!hook?.continue || (continuationCounts.get(runId) ?? 0) >= 2) { options.guard.notifyOwner(runId, "同属主自动处理未完成，请检查关联任务。", conflict); return "warn" as const; }
          continuationCounts.set(runId, (continuationCounts.get(runId) ?? 0) + 1);
          automaticRetries += 1;
          if (conflict.other.kind === "agent" && hooks.has(conflict.other.runId)) await waitForRun(conflict.other.runId, adviceController.signal);
          await hook.continue(`同属主关联任务已经结束，请重新读取 ${conflict.symbols.other}，调整 ${conflict.symbols.self} 以使用当前接口和行为，并运行测试。`);
          return "retry" as const;
        })();
      }
      if (action.type !== "owner-card") return Promise.resolve("revert");
      const card = openCard(conflict, input, action.recipients);
      if (card.status !== "waiting") return Promise.resolve(card.status === "accepted" ? "warn" : card.yieldingOwner === board.get(runId)?.owner ? "revert" : "retry");
      return new Promise((resolve) => { const waiters = reviewWaiters.get(card.id) ?? new Map(); waiters.set(runId, resolve); reviewWaiters.set(card.id, waiters); });
    },
    cancel(runId: string) { cards.closeRun(runId); },
    attach(runId: string, runHooks: RunHooks) { hooks.set(runId, runHooks); if (!runOrder.has(runId)) runOrder.set(runId, ++runSequence); },
    finish(runId: string, reverted: boolean) {
      if (reverted) cards.closeRun(runId); else cards.finishRun(runId);
      if (board.get(runId)) board.status(runId, reverted ? "reverted" : "done");
      const hook = hooks.get(runId); if (hook) completedHooks.set(runId, hook);
      hooks.delete(runId); for (const done of finished.get(runId) ?? []) done(); finished.delete(runId);
    },
    basis(actor: ActorRef, symbols: string[], revision: number) { for (const intent of board.list()) if (!["done", "reverted"].includes(intent.status) && participantKey(intent.actor) !== participantKey(actor) && related([...intent.plannedScope, ...intent.actualScope], symbols)) for (const symbol of symbols) board.basis(intent.actor.runId, symbol, revision); },
    stats() { return { members: interruptionStats(interruptions, options.clock.now()), automaticRetries, ...cards.stats() }; },
    async dispose() { adviceController.abort(); await cards.dispose(); removeNoticeListener(); hooks.clear(); completedHooks.clear(); for (const waiters of finished.values()) for (const done of waiters) done(); if (docs.get(documentName) === document) docs.delete(documentName); document.destroy = destroy; destroy(); }
  };
}
