import crypto from "node:crypto";
import type { AgentRun } from "@simplercp/shared";
import { evaluateAgentChanges, proposalFileChange, selectAgentReverts, parseSymbols, type ActiveChangeSet, type ActorRef, type AgentTextProposal, type ConflictGuardClock, type ConflictGuardTracker, type PairRecord, type SemanticFileProvider, type ZoneInput, type ZoneVerdict } from "@simplercp/conflict-guard";

type AgentActor = Extract<ActorRef, { kind: "agent" }>;
interface RunState {
  actor: AgentActor;
  startedAt: number;
  baseline: Map<string, string>;
  files: Map<string, AgentTextProposal>;
  writes: AgentTextProposal[];
  warnings: string[];
}
export interface AgentGuardNotice { id: string; memberId: string; runId: string; summary: string; at: number }

export function createProjectAgentGuard(options: {
  mode: "observe" | "rules" | "full";
  tracker: ConflictGuardTracker;
  clock: ConflictGuardClock;
  files: SemanticFileProvider;
  active(): ActiveChangeSet[];
  refresh(): void;
  gate(file: string): { allowed: boolean; reason?: string };
  current(file: string): string;
  adjudicate?(point: "T2" | "T3", input: ZoneInput, local: ZoneVerdict, signal: AbortSignal): Promise<ZoneVerdict>;
  emit(event: Record<string, unknown>): void;
  changed(): void;
}) {
  const runs = new Map<string, RunState>();
  const approved = new Map<string, Array<{ actor: AgentActor; proposal: AgentTextProposal; hash: string }>>();
  const decisions = new Map<string, PairRecord & { point: "T2" | "T3"; shadow?: boolean }>();
  const notices: AgentGuardNotice[] = [];
  const history: Array<{ at: number; set: ActiveChangeSet }> = [];
  const listeners = new Set<(event: Record<string, unknown>) => void>();
  const emit = (event: Record<string, unknown>) => { try { options.emit(event); } catch { console.error("Agent guard trace failed"); } for (const listener of listeners) { try { listener(event); } catch { console.error("Agent guard event listener failed"); } } };
  let queue: Promise<unknown> = Promise.resolve();
  const notify = (run: RunState, summary: string) => {
    notices.push({ id: crypto.randomUUID(), memberId: run.actor.ownerId, runId: run.actor.runId, summary, at: options.clock.now() });
    if (notices.length > 100) notices.shift();
    options.changed();
  };
  function start(actor: AgentActor, baseline: Map<string, string>) {
    runs.set(actor.runId, { actor, startedAt: options.clock.now(), baseline, files: new Map(), writes: [], warnings: [] });
    options.tracker.startAgent(actor);
    emit({ type: "agent_run_started", actor });
  }
  function remember(set: ActiveChangeSet, at: number) {
    history.push({ at, set: { ...set, files: new Map([...set.files].map(([file, change]) => [file, { ...change, ranges: change.ranges.map((range) => ({ ...range })), symbols: change.symbols?.map((symbol) => ({ ...symbol })) }])) } });
    const earliest = Math.min(...[...runs.values()].map((run) => run.startedAt));
    while (history.length && history[0]!.at < earliest) history.shift();
  }
  async function evaluate(run: RunState, proposals: AgentTextProposal[], point: "T2" | "T3", signal: AbortSignal, active: ActiveChangeSet[], shadow = false) {
    const reservations = new Map([...approved.values()].flat().map((entry) => [entry.proposal.file, entry.proposal.after]));
    const result = await evaluateAgentChanges({ actor: run.actor, proposals, mergeShared: point === "T2" && !shadow, currentView: point === "T3", active: mergeChangeSets(active), files: { ...options.files, readFile: (file) => reservations.get(file) ?? options.current(file), listFiles: () => [...new Set([...options.files.listFiles(), ...reservations.keys()])], version: (file) => reservations.has(file) ? hash(reservations.get(file)!) : options.files.version(file) }, now: options.clock.now, signal, onError: (error) => emit({ type: "agent_guard_error", point, runId: run.actor.runId, reason: error instanceof Error ? error.message : String(error) }), ...(options.adjudicate ? { adjudicate: (input, local, incoming) => options.adjudicate!(point, input, local, incoming) } : {}), onEvent(event) {
      const key = `${point}:${event.record.pair.id}`;
      const previous = decisions.get(key);
      const pair = { ...event.record.pair, id: key };
      const revision = previous ? previous.revision + Number(previous.revisionKey !== event.record.revisionKey) : 0;
      if (!previous) emit({ type: "pair_candidate_opened", pair, point, shadow });
      else if (previous.revisionKey !== event.record.revisionKey) emit({ type: "pair_candidate_updated", pair, point, shadow });
      decisions.set(key, { ...event.record, pair, revision, point, shadow });
      emit({ type: event.type, pairId: key, revision, pair, status: event.record.status, verdict: event.record.verdict, symbols: event.symbols, point, shadow });
      options.changed();
    } });
    return result;
  }
  function reserve(run: RunState, proposals: AgentTextProposal[]) {
    for (const proposal of proposals) {
      const entries = approved.get(proposal.file) ?? [];
      entries.push({ actor: run.actor, proposal, hash: hash(proposal.after) });
      approved.set(proposal.file, entries);
    }
  }
  function reservationSets(except: string): ActiveChangeSet[] {
    return [...runs.values()].filter((run) => run.actor.runId !== except).map((run) => {
      const proposals = [...approved.values()].flat().filter((entry) => entry.actor.runId === run.actor.runId).map((entry) => entry.proposal);
      return { actor: run.actor, status: "editing" as const, files: new Map(proposals.map((proposal) => [proposal.file, proposalFileChange(proposal, options.clock.now())])) };
    }).filter((set) => set.files.size > 0);
  }
  function judge(runId: string, proposals: AgentTextProposal[], signal: AbortSignal) {
    const task = queue.catch(() => undefined).then(async () => {
      const run = runs.get(runId);
      if (!run) return { decision: "lock" as const, message: "Run conflict context is unavailable; retry later." };
      if (signal.aborted) return { decision: "lock" as const, message: "Conflict analysis timed out; retry later." };
      options.refresh();
      for (const proposal of proposals) {
        const gate = options.gate(proposal.file);
        if (!gate.allowed) {
          notify(run, `Agent 修改被拒绝：${proposal.file} 正在等待冲突处理。`);
          emit({ type: "t2_rejected", actor: run.actor, file: proposal.file, reason: gate.reason });
          return { decision: "lock" as const, message: `Edit rejected: ${proposal.file} is paused (${gate.reason}). Wait for the related conflict to be resolved, then reread and retry.` };
        }
      }
      const active = [...options.active(), ...reservationSets(runId)];
      const result = await evaluate(run, proposals, "T2", signal, active);
      const record = result.records.find((record) => record.verdict?.decision === result.decision);
      const other = record && [record.pair.left, record.pair.right].find((side) => side.actor.kind !== "agent" || side.actor.runId !== runId);
      const verdict = record?.verdict;
      const recent = run.warnings.length ? ` Recent warnings: ${run.warnings.slice(-3).join("; ")}` : "";
      const message = result.decision === "lock" ? `Edit rejected: conflicts with ${other ? actorKey(other.actor) : "another participant"} modifying ${other?.symbol ?? "a related symbol"}. Rule: ${verdict?.ruleId ?? "analysis-unavailable"}. ${verdict?.summary ?? "Analysis did not complete; retry later."} ${verdict?.evidence.map((entry) => `${entry.symbol ?? entry.file}: ${entry.detail}`).join("; ") ?? ""} Update your implementation to use the current signature and behavior, or defer this edit and retry later.${recent}` : undefined;
      emit({ type: "t2_judged", actor: run.actor, decision: result.decision, files: proposals.map((proposal) => ({ file: proposal.file, beforeHash: hash(proposal.before), afterHash: hash(proposal.after) })), message });
      if (result.decision === "warn") run.warnings.push(verdict?.summary ?? "关联修改需要检查。 ");
      if (result.decision !== "allow") notify(run, `Agent ${result.decision === "lock" ? "修改被拒绝" : "修改警告"}：${verdict?.summary ?? "请检查关联修改。"}`);
      if (result.decision !== "lock") reserve(run, proposals);
      return { decision: result.decision, message };
    }).catch((error) => {
      emit({ type: "agent_guard_error", runId, point: "T2", reason: error instanceof Error ? error.message : String(error) });
      return { decision: "lock" as const, message: `Conflict guard could not verify the edit; please retry later. ${error instanceof Error ? error.message : ""}` };
    });
    queue = task;
    return task;
  }
  function resolveOrigin(file: string, text: string): AgentActor | undefined {
    const entries = approved.get(file);
    const match = entries?.find((entry) => entry.hash === hash(text));
    if (!match) return undefined;
    entries!.splice(0, entries!.indexOf(match) + 1);
    if (!entries!.length) approved.delete(file);
    const run = runs.get(match.actor.runId);
    if (run) {
      const previous = run.files.get(file);
      run.files.set(file, { ...match.proposal, before: previous?.before ?? match.proposal.before });
      run.writes.push(match.proposal);
      emit({ type: "agent_write_attributed", actor: run.actor, file, contentHash: match.hash });
    }
    return match.actor;
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
      if (result.decision === "lock") notify(run, "若启用将被拒绝：Agent 修改与其他参与者存在冲突。 ");
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
      const relevant = [...history, ...options.active().map((set) => ({ at: options.clock.now(), set }))].filter((entry) => entry.at >= run.startedAt && actorKey(entry.set.actor) !== actorKey(run.actor)).map((entry) => ({ ...entry.set, files: new Map([...entry.set.files].flatMap(([file, change]) => {
        if (change.lastTouchedAt <= run.startedAt) return [];
        const baseline = run.baseline.get(file) ?? "";
        const beforeSymbols = new Map(parseSymbols(file, baseline).map((symbol) => [symbol.key, baseline.slice(symbol.start, symbol.end)]));
        const keys = new Set((change.symbols ?? []).filter((symbol) => (beforeSymbols.get(symbol.key) ?? "") !== symbol.after).map((symbol) => symbol.key));
        const ranges = parseSymbols(file, options.current(file)).filter((symbol) => keys.has(symbol.key)).map((symbol) => ({ start: symbol.start, end: symbol.end }));
        if ([...keys].some((key) => change.symbols?.some((symbol) => symbol.key === key && symbol.status === "deleted"))) ranges.push(...change.ranges);
        return ranges.length ? [[file, { ...change, ranges }] as const] : [];
      })) })).filter((set) => set.files.size > 0);
      const active = mergeChangeSets(relevant);
      const result = await evaluate(run, [...proposals.values()], "T3", signal, active);
      if (options.mode === "observe") { emit({ type: "t3_shadow", actor: run.actor, decision: result.decision }); return result.decision === "allow" && !incomplete.length ? "passed" : "warned"; }
      if (result.decision === "allow") return incomplete.length ? "warned" : "passed";
      if (result.decision === "warn") { notify(run, "Agent 结束检查提示关联修改需要共同检查。 "); return "warned"; }
      const blocks: Array<Record<string, unknown>> = [];
      let reverted = 0; let skipped = 0;
      const writes = [...run.writes, ...remainingWrites];
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
      notify(run, `已撤回 Agent 的 ${reverted} 处修改${skipped ? `，${skipped} 处需要人工处理` : ""}。`);
      return skipped > 0 ? "partially-reverted" : "reverted";
    } catch (error) {
      emit({ type: "agent_guard_error", point: "T3", runId, reason: error instanceof Error ? error.message : String(error) });
      notify(run, "Agent 结束检查未完成，相关修改需要人工处理。 ");
      return "warned";
    } finally {
      options.tracker.markDone(run.actor);
      runs.delete(runId);
      for (const [file, entries] of approved) { const remaining = entries.filter((entry) => entry.actor.runId !== runId); if (remaining.length) approved.set(file, remaining); else approved.delete(file); }
      options.refresh();
    }
  }
  return { start, remember, judge, resolveOrigin, shadow, finish, warnings: (runId: string) => [...(runs.get(runId)?.warnings ?? [])], onEvent(listener: (event: Record<string, unknown>) => void) { listeners.add(listener); return () => listeners.delete(listener); }, actor: (runId: string) => runs.get(runId)?.actor, baseline: (runId: string, file: string) => runs.get(runId)?.files.get(file)?.after ?? runs.get(runId)?.baseline.get(file), records: () => [...decisions.values()], notices: (memberId?: string) => notices.filter((notice) => notice.memberId === memberId) };
}
function hash(value: string) { return crypto.createHash("sha256").update(value).digest("hex"); }
function actorKey(actor: ActorRef) { return actor.kind === "human" ? `human:${actor.memberId}` : actor.kind === "agent" ? `agent:${actor.runId}` : actor.kind; }
function mergeChangeSets(sets: ActiveChangeSet[]) {
  const result = new Map<string, ActiveChangeSet>();
  for (const set of sets) { const key = actorKey(set.actor); const previous = result.get(key); if (previous) for (const [file, change] of set.files) previous.files.set(file, change); else result.set(key, { ...set, files: new Map(set.files), status: "settled" }); }
  return [...result.values()];
}
