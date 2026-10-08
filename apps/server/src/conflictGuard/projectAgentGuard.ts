import crypto from "node:crypto";
import { PermissionEditRejected } from "../agent/permissionDispatcher.js";
import type { AgentRun } from "@simplercp/shared";
import type { GuardConflict } from "@simplercp/conflict-guard";
import { createGuardNotificationStore } from "./notificationStore.js";
import { agentInputRevision, evaluateAgentChanges, changedAgentDependencies, mergeActiveChanges, proposalFileChange, proposalSymbolKeys, selectAgentReverts, createGuardConflict, verdictFingerprint, sanitize, type ActiveChangeSet, type ActorRef, type AgentTextProposal, type ConflictGuardClock, type ConflictGuardTracker, type PairRecord, type SemanticFileProvider, type ZoneInput, type ZoneVerdict } from "@simplercp/conflict-guard";

type AgentActor = Extract<ActorRef, { kind: "agent" }>;
interface RunState {
  actor: AgentActor;
  startedAt: number;
  baseline: Map<string, string>;
  files: Map<string, AgentTextProposal>;
  writes: AgentTextProposal[];
  warnings: string[];
  forceRevert?: boolean;
  consecutiveRejection?: { opponent: string; count: number };
  judgements: Map<string, Map<string, { verdict: ZoneVerdict; pair: PairRecord["pair"] }>>;
}
export interface AgentGuardNotice { id: string; memberId: string; runId: string; summary: string; at: number }

export function createProjectAgentGuard(options: {
  mode: "observe" | "rules" | "full";
  tracker: ConflictGuardTracker;
  clock: ConflictGuardClock;
  files: SemanticFileProvider;
  bodyUnrelatedMaxAdjacentLines?: number;
  active(): ActiveChangeSet[];
  refresh(): void;
  gate(file: string): { allowed: boolean; reason?: string };
  current(file: string): string;
  readDisk?(file: string): Promise<string>;
  reconcile?(file: string): Promise<void>;
  displayActor?(actor: ActorRef): string;
  notificationsPath?: string;
  sensitiveValues?: string[];
  adjudicate?(point: "T2" | "T3", input: ZoneInput, local: ZoneVerdict, signal: AbortSignal): Promise<ZoneVerdict>;
  onT3Conflict?(runId: string, conflict: GuardConflict, input: ZoneInput | undefined): Promise<"revert" | "continue" | "retry" | "warn">;
  emit(event: Record<string, unknown>): void;
  changed(): void;
  beforePair?(signal: AbortSignal): Promise<void>;
}) {
  const runs = new Map<string, RunState>();
  const completed = new Map<string, { run: RunState; revert: Parameters<typeof finish>[2] }>();
  type Reservation = { actor: AgentActor; proposal: AgentTextProposal; hash: string; pending: boolean; timer?: ReturnType<typeof setTimeout> };
  const approved = new Map<string, Reservation[]>();
  const decisions = new Map<string, PairRecord & { point: "T2" | "T3"; shadow?: boolean }>();
  const published = new Map<string, string>();
  const noticeStore = createGuardNotificationStore(options.notificationsPath, options.sensitiveValues);
  const history: Array<{ at: number; set: ActiveChangeSet }> = [];
  const listeners = new Set<(event: Record<string, unknown>) => void>();
  const emit = (event: Record<string, unknown>) => { try { options.emit(event); } catch { console.error("Agent guard trace failed"); } for (const listener of listeners) { try { listener(event); } catch { console.error("Agent guard event listener failed"); } } };
  const queues = new Map<string, Promise<unknown>>();
  const notify = (run: RunState, summary: string, conflict?: GuardConflict, level: "light" | "action" = "light") => {
    const notice = { id: crypto.randomUUID(), memberId: run.actor.ownerId, runId: run.actor.runId, summary: summary.trim(), at: options.clock.now(), level, ...(conflict ? { conflict } : {}) };
    noticeStore.add(notice);
    emit({ type: "agent_notice", actor: run.actor, notice, level });
    options.changed();
  };
  function start(actor: AgentActor, baseline: Map<string, string>) {
    runs.set(actor.runId, { actor, startedAt: options.clock.now(), baseline, files: new Map(), writes: [], warnings: [], judgements: new Map() });
    options.tracker.startAgent(actor);
    emit({ type: "agent_run_started", actor, baseline: Object.fromEntries(baseline) });
  }
  function remember(set: ActiveChangeSet, at: number) {
    history.push({ at, set: { ...set, files: new Map([...set.files].map(([file, change]) => [file, { ...change, proposalText: options.current(file), ranges: change.ranges.map((range) => ({ ...range })), semanticRanges: change.semanticRanges?.map((range) => ({ ...range })), symbols: change.symbols?.map((symbol) => ({ ...symbol })) }])) } });
    const earliest = Math.min(...[...runs.values()].map((run) => run.startedAt));
    while (history.length && history[0]!.at < earliest) history.shift();
  }
  async function evaluate(run: RunState, proposals: AgentTextProposal[], point: "T2" | "T3", signal: AbortSignal, active: ActiveChangeSet[], shadow = false, changedSymbols?: ReadonlyMap<string, ReadonlySet<string>>) {
    const cacheKey = `${point}:${shadow}`;
    if (!run.judgements.has(cacheKey)) run.judgements.set(cacheKey, new Map());
    const resultCache = run.judgements.get(cacheKey)!;
    const reservations = new Map([...approved.values()].flat().map((entry) => [entry.proposal.file, entry.proposal.after]));
    const result = await evaluateAgentChanges({ actor: run.actor, proposals, beforePair: options.beforePair, mergeShared: point === "T2" && !shadow, currentView: point === "T3", changedSymbols, bodyUnrelatedMaxAdjacentLines: options.bodyUnrelatedMaxAdjacentLines, active: mergeActiveChanges(active), files: { ...options.files, readFile: (file) => reservations.get(file) ?? options.current(file), listFiles: () => [...new Set([...options.files.listFiles(), ...reservations.keys()])], version: (file) => reservations.has(file) ? hash(reservations.get(file)!) : options.files.version(file) }, now: options.clock.now, signal, onError: (error) => emit({ type: "agent_guard_error", point, runId: run.actor.runId, reason: error instanceof Error ? error.message : String(error) }), ...(options.adjudicate ? { adjudicate: (input, local, incoming) => options.adjudicate!(point, input, local, incoming) } : {}), onEvent(event) {
      const key = `${point}:${event.record.pair.id}`;
      const previous = decisions.get(key);
      const pair = { ...event.record.pair, id: key };
      const revision = previous ? previous.revision + Number(previous.revisionKey !== event.record.revisionKey) : 0;
      if (!previous) emit({ type: "pair_candidate_opened", pair, point, shadow });
      else if (previous.revisionKey !== event.record.revisionKey) emit({ type: "pair_candidate_updated", pair, point, shadow });
      decisions.set(key, { ...event.record, pair, revision, point, shadow });
      if (event.type === "pair_judged" && event.record.verdict) {
        const fingerprint = verdictFingerprint(event.record.verdict);
        if (published.get(key) === fingerprint) return;
        published.set(key, fingerprint);
      }
      emit({ type: event.type, pairId: key, revision, pair, status: event.record.status, verdict: event.record.verdict, symbols: event.symbols, point, shadow });
      options.changed();
    }, resultCache });
    return result;
  }
  function reserve(run: RunState, proposals: AgentTextProposal[]) {
    const reservations: Reservation[] = [];
    for (const proposal of proposals) {
      const entries = approved.get(proposal.file) ?? [];
      const reservation: Reservation = { actor: run.actor, proposal, hash: hash(proposal.after), pending: false };
      entries.push(reservation);
      reservations.push(reservation);
      approved.set(proposal.file, entries);
    }
    const clear = (selected = reservations) => {
      for (const reservation of selected) {
        clearTimeout(reservation.timer);
        const entries = approved.get(reservation.proposal.file);
        if (!entries) continue;
        const index = entries.indexOf(reservation);
        if (index >= 0) entries.splice(index, 1);
        if (!entries.length) approved.delete(reservation.proposal.file);
      }
      options.changed();
    };
    return { onRejected: () => clear(), onApproved: () => {
      if (reservations.some((reservation) => approved.get(reservation.proposal.file)?.some((entry) => entry !== reservation && entry.pending))) throw new PermissionEditRejected("此文件正在确认另一位 Agent 的修改，请等待写入完成并重新读取后修改");
      for (const reservation of reservations) {
        reservation.pending = true;
        reservation.timer = setTimeout(() => {
          void (async () => {
            try {
              if (options.readDisk) {
                const actual = await options.readDisk(reservation.proposal.file);
                if (actual !== reservation.proposal.before) {
                  if (hash(actual) !== reservation.hash) emit({ type: "reservation_mismatch", actor: run.actor, file: reservation.proposal.file, expectedHash: reservation.hash, actualHash: hash(actual) });
                  reservation.proposal = { ...reservation.proposal, after: actual };
                  reservation.hash = hash(actual);
                  await options.reconcile?.(reservation.proposal.file);
                  if (approved.get(reservation.proposal.file)?.includes(reservation)) resolveOrigin(reservation.proposal.file, actual);
                }
              }
            } catch (error) { emit({ type: "agent_guard_error", point: "reservation", reason: error instanceof Error ? error.message : String(error) }); }
            finally { clear([reservation]); }
          })();
        }, 2000);
      }
      options.changed();
    } };
  }
  function conflictFor(run: RunState, result: Pick<Awaited<ReturnType<typeof evaluate>>, "decision" | "records" | "inputs">, point: "T2" | "T3"): GuardConflict | undefined {
    const record = result.records.find((record) => record.verdict?.decision === result.decision);
    const other = record && [record.pair.left, record.pair.right].find((side) => actorKey(side.actor) !== actorKey(run.actor));
    const verdict = record?.verdict;
    if (!record || !other || !verdict) return undefined;
    const input = result.inputs[result.records.indexOf(record)];
    const displayed = decisions.get(`${point}:${record.pair.id}`);
    const otherChange = input && [input.left, input.right].find((side) => actorKey(side.actor) === actorKey(other.actor) && side.symbol.key === other.symbol)?.symbol;
    return sanitize(createGuardConflict({ record: displayed ?? { ...record, pair: { ...record.pair, id: `${point}:${record.pair.id}` } }, self: run.actor, otherDisplayName: options.displayActor?.(other.actor) ?? (other.actor.kind === "human" ? "协作成员" : "另一位成员的 Agent"), otherChange }), options.sensitiveValues ?? []);
  }
  function reservationSets(except: string): ActiveChangeSet[] {
    return [...runs.values()].filter((run) => run.actor.runId !== except).map((run) => {
      const proposals = [...approved.values()].flat().filter((entry) => entry.actor.runId === run.actor.runId).map((entry) => entry.proposal);
      return { actor: run.actor, status: "editing" as const, files: new Map(proposals.map((proposal) => [proposal.file, proposalFileChange(proposal, options.clock.now())])) };
    }).filter((set) => set.files.size > 0);
  }
  function inputRevision(proposals: AgentTextProposal[], active: ActiveChangeSet[]) {
    return agentInputRevision(proposals, active, options.current);
  }
  async function evaluateCurrent(run: RunState, proposals: AgentTextProposal[], point: "T2" | "T3", signal: AbortSignal, active: () => ActiveChangeSet[], changedSymbols?: ReadonlyMap<string, ReadonlySet<string>>) {
    for (;;) {
      const changeSets = active();
      const revision = inputRevision(proposals, changeSets);
      const result = await evaluate(run, proposals, point, signal, changeSets, false, changedSymbols);
      options.refresh();
      if (signal.aborted || revision === inputRevision(proposals, active())) return result;
    }
  }
  function changedDependencies(run: RunState) {
    return changedAgentDependencies({ actor: run.actor, startedAt: run.startedAt, baseline: run.baseline, history, active: options.active(), now: options.clock.now(), current: options.current });
  }
  function judge(runId: string, proposals: AgentTextProposal[], signal: AbortSignal): Promise<{ decision: "allow" | "warn" | "lock"; message?: string; conflict?: GuardConflict; input?: ZoneInput; onApproved?: () => void; onRejected?: () => void }> {
    const keys = [...new Set(proposals.map((proposal) => proposal.file))].sort();
    const waiting = Promise.all(keys.map((key) => queues.get(key)?.catch(() => undefined)));
    const task = waiting.then(async () => {
      signal = AbortSignal.any([signal, AbortSignal.timeout(30_000)]);
      const run = runs.get(runId);
      if (!run) return { decision: "lock" as const, message: "本次 run 的冲突上下文不可用，请停止修改并向用户报告。" };
      if (signal.aborted) return { decision: "lock" as const, message: "冲突分析超过时间预算或已取消，本次修改未获批准。" };
      options.refresh();
      for (const proposal of proposals) {
        const gate = options.gate(proposal.file);
        if (!gate.allowed && gate.reason !== "agent-write") {
          notify(run, `Agent 修改被拒绝：${proposal.file} 正在等待冲突处理。`);
          emit({ type: "t2_rejected", actor: run.actor, file: proposal.file, reason: gate.reason });
          return { decision: "lock" as const, message: `修改被拒绝：${proposal.file} 正在等待冲突处理，原因 ${gate.reason}。请等待处理完成后重新读取文件。` };
        }
      }
      const result = await evaluateCurrent(run, proposals, "T2", signal, () => [...options.active(), ...reservationSets(runId)]);
      for (const proposal of proposals) {
        const gate = options.gate(proposal.file);
        if (!gate.allowed && gate.reason !== "agent-write") return { decision: "lock" as const, message: `修改被拒绝：${proposal.file} 正在等待冲突处理，原因 ${gate.reason}。请等待处理完成后重新读取文件。` };
      }
      const record = result.records.find((record) => record.verdict?.decision === result.decision);
      const verdict = record?.verdict;
      if (verdict?.ruleId === "agent-analysis-unavailable") throw new Error("检查组件无法核验本次修改，请停止修改此文件并向用户报告");
      const conflict = conflictFor(run, result, "T2");
      const recent = run.warnings.length ? ` 近期警告：${run.warnings.slice(-3).join("；")}` : "";
      let message = result.decision === "lock" ? conflict ? `修改被拒绝：与 ${conflict.otherDisplayName} 修改的 ${conflict.symbols.other} 存在冲突。规则 ${conflict.ruleId}。${conflict.summaryZh} 对方修改后：${conflict.afterSignature || "请重新读取关联符号"}。${conflict.suggestionZh ?? "请使用当前接口与行为调整实现，或暂停修改此处。"}${recent}` : "冲突检查未完成，请停止重复同一修改并向用户报告。" : undefined;
      if (result.decision === "lock" && conflict) {
        const opponent = actorKey(conflict.other);
        const count = run.consecutiveRejection?.opponent === opponent ? run.consecutiveRejection.count + 1 : 1;
        run.consecutiveRejection = { opponent, count };
        if (count >= 3) {
          message = `停止修改该文件，向用户说明冲突并等待指示。${message}`;
          if (count === 3) notify(run, "Agent 已连续提交与同一参与者冲突的修改，请处理冲突后提供继续执行的指示。", conflict, "action");
        }
      } else run.consecutiveRejection = undefined;
      emit({ type: "t2_judged", actor: run.actor, decision: result.decision, files: proposals.map((proposal) => ({ file: proposal.file, beforeHash: hash(proposal.before), afterHash: hash(proposal.after) })), message, conflict });
      if (result.decision === "warn") run.warnings.push(verdict?.summary.trim() ?? "关联修改需要检查。");
      if (result.decision === "warn") notify(run, `Agent 修改警告：${conflict?.summaryZh ?? "请检查关联修改。"}`, conflict);
      const reservation = result.decision !== "lock" ? reserve(run, proposals) : undefined;
      return { decision: result.decision, message, conflict, input: result.inputs[result.records.indexOf(record!)], ...reservation };
    }).catch((error) => {
      emit({ type: "agent_guard_error", runId, point: "T2", reason: error instanceof Error ? error.message : String(error) });
      throw error;
    });
    for (const key of keys) queues.set(key, task);
    const cleanup = () => { for (const key of keys) if (queues.get(key) === task) queues.delete(key); };
    void task.then(cleanup, cleanup);
    return task;
  }
  function resolveOrigin(file: string, text: string): AgentActor | undefined {
    const entries = approved.get(file);
    const match = entries?.find((entry) => entry.hash === hash(text));
    if (!match) return undefined;
    clearTimeout(match.timer);
    const run = runs.get(match.actor.runId);
    if (run) {
      const previous = run.files.get(file);
      run.files.set(file, { ...match.proposal, before: previous?.before ?? match.proposal.before });
      run.writes.push(match.proposal);
      emit({ type: "agent_write_attributed", actor: run.actor, file, contentHash: match.hash });
    }
    return match.actor;
  }
  function completeOrigin(file: string, text: string) {
    const entries = approved.get(file);
    const index = entries?.findIndex((entry) => entry.hash === hash(text)) ?? -1;
    if (index < 0) return;
    for (const entry of entries!.splice(0, index + 1)) clearTimeout(entry.timer);
    if (!entries!.length) approved.delete(file);
    options.changed();
  }
  async function shadow(runId: string, proposals: AgentTextProposal[]) {
    const run = runs.get(runId); if (!run) return;
    try {
      options.refresh();
      const result = await evaluate(run, proposals, "T2", AbortSignal.timeout(30_000), options.active(), true);
      reserve(run, proposals);
      for (const proposal of proposals) options.tracker.attributeAgentChange(run.actor, proposalFileChange(proposal, options.clock.now()));
      options.refresh();
      for (const proposal of proposals) { const previous = run.files.get(proposal.file); run.files.set(proposal.file, { ...proposal, before: previous?.before ?? proposal.before }); run.writes.push(proposal); }
      emit({ type: "t2_shadow", actor: run.actor, decision: result.decision, files: proposals.map((proposal) => proposal.file) });
      if (result.decision === "lock") notify(run, "若启用将被拒绝：Agent 修改与其他参与者存在冲突。");
    } catch (error) { emit({ type: "agent_guard_error", point: "T2", runId, reason: error instanceof Error ? error.message : String(error) }); }
  }
  async function finish(runId: string, net: AgentTextProposal[], revert: (file: string, expected: string, text: string, ownerId: string, remove?: boolean) => Promise<boolean>, unverified: Array<{ file?: string; reason: string }> = []): Promise<NonNullable<AgentRun["conflictGuard"]>["t3"]> {
    const run = runs.get(runId); if (!run) return "passed";
    const signal = AbortSignal.timeout(60_000);
    try {
      options.tracker.flushActorBatches(run.actor);
      options.refresh();
      const incomplete = unverified.filter(({ file }) => !file || run.files.get(file)?.after !== options.current(file));
      if (incomplete.length) {
        emit({ type: "t3_incomplete", actor: run.actor, files: incomplete });
        notify(run, "Agent 结束检查存在无法核验的修改，需要人工处理。");
      }
      const proposals = new Map([...run.files].map(([file, proposal]) => [file, { ...proposal }]));
      const remainingWrites: AgentTextProposal[] = [];
      for (const proposal of net) {
        const previous = proposals.get(proposal.file);
        if (previous?.after === proposal.after) continue;
        proposals.set(proposal.file, { ...proposal, before: previous?.before ?? proposal.before });
        remainingWrites.push({ ...proposal, before: previous?.after ?? proposal.before, existedBefore: previous ? true : proposal.existedBefore });
      }
      run.writes.push(...remainingWrites);
      for (const [file, proposal] of proposals) run.files.set(file, proposal);
      const changedSymbols = new Map<string, Set<string>>();
      for (const proposal of run.writes) {
        const keys = changedSymbols.get(proposal.file) ?? new Set<string>();
        for (const key of proposalSymbolKeys(proposal)) keys.add(key);
        changedSymbols.set(proposal.file, keys);
      }
      emit({ type: "agent_review", actor: run.actor, proposals: [...proposals.values()], writes: run.writes, forceRevert: Boolean(run.forceRevert) });
      const result: Pick<Awaited<ReturnType<typeof evaluate>>, "decision" | "records" | "inputs"> = run.forceRevert ? { decision: "lock", records: [], inputs: [] } : await evaluateCurrent(run, [...proposals.values()], "T3", signal, () => changedDependencies(run), changedSymbols);
      const conflict = conflictFor(run, result, "T3");
      if (options.mode === "observe") { emit({ type: "t3_shadow", actor: run.actor, decision: result.decision }); return result.decision === "allow" && !incomplete.length ? "passed" : "warned"; }
      if (result.decision === "allow") return incomplete.length ? "warned" : "passed";
      if (result.decision === "warn") { notify(run, "Agent 结束检查提示关联修改需要共同检查。", conflict); return "warned"; }
      if (conflict && options.onT3Conflict) {
        const record = result.records.find((record) => record.verdict?.decision === "lock");
        const action = await options.onT3Conflict(runId, conflict, result.inputs[result.records.indexOf(record!)]);
        if (action === "retry") {
          return await finish(runId, [], revert, unverified);
        }
        if (action === "continue") return incomplete.length ? "warned" : "passed";
        if (action === "warn") return "warned";
      }
      const blocks: Array<Record<string, unknown>> = [];
      let reverted = 0; let skipped = 0;
      const writes = [...run.writes];
      for (const proposal of writes.reverse()) {
        const current = options.current(proposal.file);
        const selected = selectAgentReverts(proposal.before, proposal.after, current);
        let applied = false;
        if (selected.reverted.length) applied = await revert(proposal.file, current, selected.text, run.actor.ownerId, proposal.existedBefore === false && selected.text === "");
        const undone = applied ? selected.reverted : [];
        const untouched = [...selected.skipped, ...(!applied ? selected.reverted.map((block) => ({ from: block.from, reason: "共享文本已改变，需要人工处理。" })) : [])];
        reverted += undone.length; skipped += untouched.length;
        blocks.push({ file: proposal.file, reverted: undone, skipped: untouched });
      }
      emit({ type: "t3_revert", actor: run.actor, blocks, reverted, skipped });
      notify(run, `已撤回 Agent 的 ${reverted} 处修改${skipped ? `，${skipped} 处需要人工处理` : ""}。`, conflict);
      return skipped > 0 ? "partially-reverted" : "reverted";
    } catch (error) {
      emit({ type: "agent_guard_error", point: "T3", runId, reason: error instanceof Error ? error.message : String(error) });
      notify(run, "Agent 结束检查未完成，相关修改需要人工处理。");
      return "warned";
    } finally {
      options.tracker.markDone(run.actor);
      completed.set(runId, { run, revert });
      runs.delete(runId);
      for (const [file, entries] of approved) { for (const entry of entries) if (entry.actor.runId === runId) clearTimeout(entry.timer); const remaining = entries.filter((entry) => entry.actor.runId !== runId); if (remaining.length) approved.set(file, remaining); else approved.delete(file); }
      options.refresh();
    }
  }
  return { completeOrigin, start, remember, judge, resolveOrigin, shadow, finish, updateNotice: noticeStore.update, flushNotices: noticeStore.flush,
    notifyOwner(runId: string, summary: string, conflict?: GuardConflict, level: "light" | "action" = "light") { const run = runs.get(runId) ?? completed.get(runId)?.run; if (run) notify(run, summary, conflict, level); },
    async withdraw(runId: string) {
      const archived = completed.get(runId); if (!archived) throw new Error("Agent 修改记录不可用");
      runs.set(runId, archived.run); archived.run.forceRevert = true;
      return finish(runId, [], archived.revert);
    },
    requestRevert(runId: string) { const run = runs.get(runId); if (run) run.forceRevert = true; },
    actualScope(runId: string) { return [...new Set([...(runs.get(runId)?.files.values() ?? [])].flatMap((proposal) => [...proposalSymbolKeys(proposal)]))]; },
    unavailable(runId: string, file: string) { const run = runs.get(runId); if (run) notify(run, `冲突检查暂不可用，Agent 已停止修改 ${file}，请检查错误记录。`); }, pendingFile: (file: string) => approved.get(file)?.some((entry) => entry.pending) ?? false, warnings: (runId: string) => [...(runs.get(runId)?.warnings ?? [])], onEvent(listener: (event: Record<string, unknown>) => void) { listeners.add(listener); return () => listeners.delete(listener); }, actor: (runId: string) => runs.get(runId)?.actor, baseline: (runId: string, file: string) => runs.get(runId)?.files.get(file)?.after ?? runs.get(runId)?.baseline.get(file), records: () => [...decisions.values()], notices: noticeStore.list };
}
function hash(value: string) { return crypto.createHash("sha256").update(value).digest("hex"); }
function actorKey(actor: ActorRef) { return actor.kind === "human" ? `human:${actor.memberId}` : actor.kind === "agent" ? `agent:${actor.runId}` : actor.kind; }
