import { createHash } from "node:crypto";
import type { ActiveChangeSet, ActorRef, AgentIntent, AgentTextProposal, ArbitrationMode, Interruption, PairRecord, Participant, TraceEvent, ZoneInput, ZoneVerdict } from "../index.js";
import { arbitrate, participantKey } from "../coordination/arbitration.js";
import { buildIntentInjection, createIntentBoard } from "../coordination/intents.js";
import { createOwnerCards, interruptionStats } from "../coordination/ownerCards.js";
import { agentInputRevision, changedAgentDependencies, createGuardConflict, evaluateAgentChanges, mergeActiveChanges, proposalFileChange, proposalSymbolKeys } from "../coordination/agentGuard.js";
import { createSessionCoordinator } from "../coordination/session.js";
import { classify } from "../routing/classifier.js";
import { createSemanticIndex } from "../semantic/index.js";
import { SemanticChangeTracker, type SemanticChangeEvent } from "../routing/candidates.js";
import { ConflictGuardTracker } from "../tracking/tracker.js";
import { textDiffOps } from "../tracking/textDiff.js";
import { MemoryFileProvider } from "./files.js";
import { VirtualClock } from "./clock.js";

export async function replayAgentTrace(events: TraceEvent[], options: {
  mode: ArbitrationMode;
  injection?: boolean;
  initialFiles?: Record<string, string>;
  libs?: Record<string, string>;
  judgementFrameMs?: number;
  maxJudgementsPerFrame?: number;
  onSemanticEvent?(event: SemanticChangeEvent, at: number): void;
  adjudicate?(input: ZoneInput, local: ZoneVerdict, signal: AbortSignal, point: "T1" | "T2" | "T3"): Promise<ZoneVerdict>;
}) {
  const clock = new VirtualClock(events[0]?.at ?? 0);
  const snapshot = events.find((event) => event.type === "project_snapshot")?.files as Record<string, string> | undefined;
  const injectionEnabled = options.injection ?? (events.find((event) => event.type === "session_start")?.intentInjection as boolean | undefined) ?? events.some((event) => event.type === "intent_injected");
  const files = new MemoryFileProvider(options.initialFiles ?? snapshot, options.libs);
  const config = events.find((event) => event.type === "session_start")?.config as { idleMs?: number; activeIdleMs?: number; maxBatchDurationMs?: number; cursorLeaveLines?: number; cursorDebounceMs?: number; judgementFrameMs?: number; maxJudgementsPerFrame?: number } | undefined;
  let sequence = 0;
  const tracker = new ConflictGuardTracker({ ...config, clock, idleMs: config?.idleMs ?? 1500, activeIdleMs: config?.activeIdleMs ?? 600000, createId: () => `agent-replay-${++sequence}` });
  const index = createSemanticIndex({ files, now: () => clock.now() }); index.update();
  const semantic = new SemanticChangeTracker({ index, readFile: (file) => files.readFile(file), now: () => clock.now() });
  if (options.onSemanticEvent) semantic.onEvent((event) => options.onSemanticEvent!(event, clock.now()));
  const actions: Array<Record<string, unknown>> = [];
  const judgements: Array<{ at: number; point: "T1" | "T2" | "T3"; pair: PairRecord["pair"]; revision: number; verdict: ZoneVerdict }> = [];
  const published = new Map<string, string>();
  const resultCaches = new Map<string, Map<string, { verdict: ZoneVerdict; pair: PairRecord["pair"] }>>();
  const closedBatches: NonNullable<Parameters<typeof semantic.update>[1]> = [];
  const recordJudgement = (record: PairRecord, point: "T1" | "T2" | "T3") => {
    if (!record.verdict) return;
    const key = `${point}:${record.pair.id}`;
    const value = JSON.stringify([record.verdict.zone, record.verdict.decision, record.verdict.ruleId, record.verdict.summary]);
    if (published.get(key) === value) return;
    published.set(key, value);
    judgements.push({ at: clock.now(), point, pair: record.pair, revision: record.revision, verdict: record.verdict });
  };
  const interruptions: Interruption[] = [];
  const injections: Array<{ at: number; runId: string; count: number; hash: string }> = [];
  const board = createIntentBoard({ changed() {} });
  const seen = new Set<string>();
  const proposals = new Map<string, AgentTextProposal[]>();
  const requests = new Map<string, string>();
  const pendingAttributions = new Set<string>();
  const reservations = new Map<string, { actor: Extract<ActorRef, { kind: "agent" }>; changes: AgentTextProposal[] }>();
  const revisions = new Map<string, { key?: string; revision: number }>();
  const errors: string[] = [];
  const history: Array<{ at: number; set: ActiveChangeSet }> = [];
  const runs = new Map<string, { actor: Extract<ActorRef, { kind: "agent" }>; startedAt: number; baseline: Map<string, string> }>();
  const pendingJudgements: Promise<void>[] = [];
  const scheduled: Array<{ at: number; order: number; complete(): Promise<void> }> = [];
  let schedulingOrder = 0;
  const cards = createOwnerCards({ clock, changed(_type, card) {
    board.statusForActors([card.conflict.self, card.conflict.other], card.status === "waiting" ? "blocked" : "running", cards.waitingActors());
  }, notify(event) { interruptions.push(event); }, resolve() {}, error(error) { throw error; } });
  const related = (left: string[], right: string[]) => left.some((key) => right.includes(key)) || index.findPaths(left, right, 2).length > 0;
  function inject(actor: Extract<ActorRef, { kind: "agent" }>, scope?: string[]) {
    if (!injectionEnabled) return;
    const intent = board.get(actor.runId); if (!intent) return;
    const inferred = files.listFiles().flatMap((file) => index.symbolsInFile(file).filter((symbol) => intent.task.includes(symbol.name) || intent.task.includes(file)).map((symbol) => symbol.key));
    const result = buildIntentInjection({ enabled: true, actor, scope: scope?.length ? scope : [...intent.plannedScope, ...intent.actualScope, ...inferred], intents: board.list(), changes: semantic.getActiveChangeSets().flatMap((set) => [...set.files.values()].flatMap((file) => (file.symbols ?? []).map((symbol) => ({ actor: set.actor, symbol: symbol.key, summary: symbol.after.slice(0, 300) })))), related, display: participantKey });
    injections.push({ at: clock.now(), runId: actor.runId, count: result.count, hash: result.hash });
  }
  function recordAction(record: PairRecord, actor: Participant, point: "T1" | "T2" | "T3") {
    if (point !== "T1") {
      const key = `${point}:${record.pair.id}`;
      const previous = revisions.get(key);
      record.revision = (previous?.revision ?? 0) + Number(Boolean(previous) && previous?.key !== record.revisionKey);
      revisions.set(key, { key: record.revisionKey, revision: record.revision }); record.pair = { ...record.pair, id: key };
    }
    const other = [record.pair.left, record.pair.right].find((side) => participantKey(side.actor) !== participantKey(actor))!;
    const action = arbitrate({ left: actor, right: other.actor as Participant, later: actor }, record.verdict!, options.mode);
    const conflict = createGuardConflict({ record, self: actor, otherDisplayName: participantKey(other.actor) });
    if (!conflict) throw new Error("Arbitration replay has no conflict description");
    actions.push({ at: clock.now(), point, conflict, action });
    if (action.type === "owner-card") {
      const existing = cards.list().find((card) => card.status === "waiting" && [card.conflict.self, card.conflict.other].every((side) => [actor, other.actor].some((target) => participantKey(side) === participantKey(target))) && related([conflict.symbols.self, conflict.symbols.other], [card.conflict.symbols.self, card.conflict.symbols.other]));
      if (!existing) cards.open(conflict, board.list().filter((intent) => [participantKey(actor), participantKey(other.actor)].includes(participantKey(intent.actor))), record.pair.path?.hops.map((hop) => `${hop.from} ${hop.kind} ${hop.to}`).join("; ") ?? "", action.recipients);
    }
    for (const [level, members] of [["action", action.recipients], ["light", action.lightRecipients]] as const) for (const memberId of members) {
      if (level === "action" && action.type === "owner-card") continue;
      const key = `${record.pair.id}:${record.revision}:${memberId}:${level}`;
      if (!seen.has(key)) { seen.add(key); interruptions.push({ at: clock.now(), memberId, kind: action.kind, level, pairId: record.pair.id, revision: record.revision }); }
    }
    return action;
  }
  const session = createSessionCoordinator({ tracker, semantic, index, clock, now: () => clock.now(), intervene: false, arbitrationMode: options.mode, onError(error) { throw error; }, ...(options.adjudicate ? { adjudicate(pair, local, signal, complete) {
    if (pair.left.actor.kind !== "human" || pair.right.actor.kind !== "human") { complete(local); return; }
    const left = session.symbolFor(pair.left.actor, pair.left.symbol); const right = session.symbolFor(pair.right.actor, pair.right.symbol);
    if (!left || !right) throw new Error("Replay pair has no symbols");
    const startedAt = clock.now();
    pendingJudgements.push(options.adjudicate!({ left: { actor: pair.left.actor, symbol: left }, right: { actor: pair.right.actor, symbol: right }, path: pair.path, nested: pair.distance === 0 && pair.left.symbol !== pair.right.symbol, typeOnly: Boolean(pair.path?.typeOnly), project: index }, local, signal, "T1").then((verdict) => {
      if (verdict.adjudication?.status !== "success") errors.push(`provider:${verdict.adjudication?.status ?? "unavailable"}`);
      scheduled.push({ at: startedAt + (verdict.adjudication?.latencyMs ?? 0), order: ++schedulingOrder, async complete() { if (!signal.aborted) complete(verdict); } });
    }));
  } } : {}), classify(pair) {
    const left = session.symbolFor(pair.left.actor, pair.left.symbol); const right = session.symbolFor(pair.right.actor, pair.right.symbol);
    if (!left || !right) throw new Error("Replay pair has no symbols");
    return classify({ left: { actor: pair.left.actor, symbol: left }, right: { actor: pair.right.actor, symbol: right }, path: pair.path, nested: pair.distance === 0 && pair.left.symbol !== pair.right.symbol, typeOnly: Boolean(pair.path?.typeOnly), project: index });
  }, judgementFrameMs: options.judgementFrameMs ?? config?.judgementFrameMs ?? 0, maxJudgementsPerFrame: options.maxJudgementsPerFrame ?? config?.maxJudgementsPerFrame ?? 20 });
  session.coordinator.onEvent((event) => {
    if (event.type === "pair_judged") recordJudgement(event.record, "T1");
    if (event.type === "pair_judged" && event.record.verdict?.decision === "lock") {
    const sides = [event.record.pair.left, event.record.pair.right];
    if (sides.some((side) => side.actor.kind === "human")) {
      const latest = sides.every((side) => side.actor.kind === "human") ? sides.sort((left, right) => (session.symbolFor(right.actor, right.symbol)?.lastTouchedAt ?? 0) - (session.symbolFor(left.actor, left.symbol)?.lastTouchedAt ?? 0))[0]! : sides.find((side) => side.actor.kind === "human")!;
      recordAction(event.record, latest.actor as Participant, "T1");
    }
  } });
  function refresh() {
    semantic.captureStaleEdges(tracker.getActiveChangeSets()); index.update(); session.refresh(closedBatches.splice(0));
    for (const set of semantic.getActiveChangeSets()) history.push({ at: clock.now(), set: { ...set, files: new Map([...set.files].map(([file, change]) => [file, { ...change, proposalText: files.readFile(file), ranges: change.ranges.map((range) => ({ ...range })), semanticRanges: change.semanticRanges?.map((range) => ({ ...range })), symbols: change.symbols?.map((symbol) => ({ ...symbol })) }])) } });
  }
  async function advanceTo(at: number) {
    while (true) {
      await Promise.all(pendingJudgements.splice(0));
      const next = scheduled.filter((job) => job.at <= at).sort((left, right) => left.at - right.at || left.order - right.order)[0];
      const timerAt = clock.nextTimerAt();
      if (timerAt !== undefined && timerAt <= at && (!next || timerAt <= next.at)) {
        clock.advanceTo(Math.max(clock.now(), timerAt));
        continue;
      }
      if (!next) { clock.advanceTo(Math.max(clock.now(), at)); break; }
      scheduled.splice(scheduled.indexOf(next), 1);
      clock.advanceTo(Math.max(clock.now(), next.at));
      await next.complete();
    }
  }
  async function evaluate(point: "T2" | "T3", actor: Extract<ActorRef, { kind: "agent" }>, build: () => Parameters<typeof evaluateAgentChanges>[0], accepted?: () => void, startedAt = clock.now()) {
    const cacheKey = `${point}:${actor.runId}`;
    if (!resultCaches.has(cacheKey)) resultCaches.set(cacheKey, new Map());
    const view = () => { const input = build(); return agentInputRevision(input.proposals, input.active, (file) => files.readFile(file)); };
    const before = view(); let latencyMs = 0;
    const result = await evaluateAgentChanges({ ...build(), resultCache: resultCaches.get(cacheKey), ...(options.adjudicate ? { adjudicate: async (input, local, signal) => {
      const verdict = await options.adjudicate!(input, local, signal, point);
      latencyMs += verdict.adjudication?.latencyMs ?? 0;
      if (verdict.adjudication?.status !== "success") errors.push(`provider:${verdict.adjudication?.status ?? "unavailable"}`);
      return verdict;
    } } : {}) });
    scheduled.push({ at: clock.now() + latencyMs, order: ++schedulingOrder, async complete() {
      if (before !== view() && clock.now() - startedAt < (point === "T2" ? 30000 : 60000)) { refresh(); await evaluate(point, actor, build, accepted, startedAt); return; }
      if (point === "T2") board.statusForActors([actor], "running", cards.waitingActors());
      for (const record of result.records) recordJudgement(record, point);
      if (result.decision !== "lock") accepted?.();
      const arbitration = result.records.filter((record) => record.verdict?.decision === "lock").map((record) => recordAction(record, actor, point));
      if (point === "T2" && arbitration.some((action) => action.type === "retry-agent")) board.statusForActors([actor], "waiting", cards.waitingActors());
      if (point === "T2" && result.decision === "lock" && arbitration.every((action) => action.type !== "owner-card")) inject(actor, build().proposals.flatMap((proposal) => [...proposalSymbolKeys(proposal)]));
    } });
  }
  tracker.onEvent((event) => {
    if (event.type === "batch_closed") closedBatches.push({ batch: event.batch, change: tracker.getActiveChangeSets().find((set) => participantKey(set.actor) === participantKey(event.batch.actor))?.files.get(event.batch.file) });
    if (["batch_closed", "change_set_closed"].includes(event.type)) refresh();
  });
  try {
    for (const event of events) {
      await advanceTo(event.at);
      if (event.type === "doc_open" && typeof event.text === "string") { files.open(String(event.file), event.text); tracker.openDocument(String(event.file), event.text); refresh(); }
      if (event.type === "cursor") { const position = event.position as { lineNumber: number; column: number }; tracker.cursorChanged({ actor: { kind: "human", memberId: String(event.memberId) }, file: String(event.file), ...position, at: event.at }); }
      if (event.type === "mirror_resync" && typeof event.text === "string") {
        const file = String(event.file); const before = files.readFile(file); files.set(file, event.text);
        tracker.edit({ file, origin: { kind: "filesystem" }, at: event.at, ops: textDiffOps(before, event.text), textBefore: before, textAfter: event.text, revisionAfter: Number(event.revisionAfter ?? 0) }); refresh();
      }
      if (event.type === "intent_created") { const intent = event.intent as AgentIntent; board.create(intent.actor, intent.task, intent.baseRevision); }
      if (event.type === "intent_updated") {
        const intent = event.intent as AgentIntent;
        if (board.get(intent.actor.runId)) {
          if (event.reason === "task") board.task(intent.actor.runId, intent.task);
          if (event.reason === "plan" && intent.plannedScope.length) board.plan(intent.actor.runId, `PLAN:\n${intent.plannedScope.join("\n")}\nEND_PLAN`);
        }
      }
      if (event.type === "intent_closed") { const intent = event.intent as AgentIntent; if (board.get(intent.actor.runId)) board.status(intent.actor.runId, intent.status); tracker.markDone(intent.actor); if (intent.status === "reverted") cards.closeRun(intent.actor.runId); else cards.finishRun(intent.actor.runId); for (const [id, reservation] of reservations) if (reservation.actor.runId === intent.actor.runId) reservations.delete(id); refresh(); }
      if (event.type === "agent_run_started") {
        const actor = event.actor as Extract<ActorRef, { kind: "agent" }>;
        runs.set(actor.runId, { actor, startedAt: event.at, baseline: new Map(Object.entries(event.baseline as Record<string, string> ?? Object.fromEntries(files.listFiles().map((file) => [file, files.readFile(file)])))) }); tracker.startAgent(actor);
        inject(actor);
      }
      if (event.type === "edit") {
        const file = String(event.file); const before = files.readFile(file);
        const origin = event.origin as ActorRef;
        const ops = event.ops as import("../model/types.js").TextEditOp[];
        let current = before; let shift = 0;
        for (const op of ops) { const position = op.from + shift; if (current.slice(position, position + op.deleted.length) !== op.deleted) throw new Error("Agent replay edit does not match current text"); current = current.slice(0, position) + op.inserted + current.slice(position + op.deleted.length); shift += op.inserted.length - op.deleted.length; }
        files.set(file, current); tracker.edit({ file, origin, at: event.at, ops: textDiffOps(before, current), textBefore: before, textAfter: current, revisionAfter: Number(event.revisionAfter ?? 0) }); refresh();
        const attributionKey = `${participantKey(origin)}:${file}`;
        if (origin.kind === "agent" && pendingAttributions.delete(attributionKey) && board.get(origin.runId)) board.actual(origin.runId, [...proposalSymbolKeys({ file, before, after: current })]);
        const changed = semantic.getActiveChangeSets().find((set) => participantKey(set.actor) === participantKey(origin))?.files.get(file)?.symbols ?? [];
        for (const intent of board.list().filter((intent) => !["done", "reverted"].includes(intent.status) && participantKey(intent.actor) !== participantKey(origin))) for (const symbol of changed) if (related([...intent.plannedScope, ...intent.actualScope], [symbol.key])) board.basis(intent.actor.runId, symbol.key, Number(event.revisionAfter ?? 0));
      }
      if (event.type === "agent_proposal") {
        const actor = event.actor as Extract<ActorRef, { kind: "agent" }>;
        const changes = event.proposals as AgentTextProposal[];
        board.statusForActors([actor], "waiting", cards.waitingActors());
        for (const proposal of changes) if (!files.listFiles().includes(proposal.file)) { files.open(proposal.file, proposal.before); tracker.openDocument(proposal.file, proposal.before); }
        refresh();
        await evaluate("T2", actor, () => {
          const reserved = [...reservations.values()].filter((entry) => entry.actor.runId !== actor.runId);
          const active: ActiveChangeSet[] = [...semantic.getActiveChangeSets(), ...reserved.map((entry) => ({ actor: entry.actor, status: "editing" as const, files: new Map(entry.changes.map((proposal) => [proposal.file, proposalFileChange(proposal, clock.now())])) }))];
          const pendingFiles = new Map(reserved.flatMap((entry) => entry.changes.map((proposal) => [proposal.file, proposal.after] as const)));
          return { actor, proposals: changes, mergeShared: true, active: mergeActiveChanges(active), files: { readFile: (file) => pendingFiles.get(file) ?? files.readFile(file), listFiles: () => [...new Set([...files.listFiles(), ...pendingFiles.keys()])], readLib: (name) => files.readLib(name), version: (file) => pendingFiles.get(file) ?? files.version(file) }, now: () => clock.now(), signal: new AbortController().signal };
        }, () => reservations.set(String(event.requestId), { actor, changes }));
        proposals.set(String(event.requestId), changes); requests.set(String(event.requestId), actor.runId);
      }
      if (event.type === "agent_review" && !event.forceRevert) {
        const actor = event.actor as Extract<ActorRef, { kind: "agent" }>; const run = runs.get(actor.runId);
        if (!run) throw new Error("Agent review has no run baseline");
        refresh();
        const changedSymbols = new Map<string, Set<string>>();
        for (const proposal of event.writes as AgentTextProposal[]) { const keys = changedSymbols.get(proposal.file) ?? new Set<string>(); for (const key of proposalSymbolKeys(proposal)) keys.add(key); changedSymbols.set(proposal.file, keys); }
        await evaluate("T3", actor, () => ({ actor, proposals: event.proposals as AgentTextProposal[], currentView: true, changedSymbols, active: changedAgentDependencies({ ...run, history, active: semantic.getActiveChangeSets(), now: clock.now(), current: (file) => files.readFile(file) }), files, now: () => clock.now(), signal: new AbortController().signal }));
      }
      if (event.type === "agent_write_attributed") {
        const actor = event.actor as Extract<ActorRef, { kind: "agent" }>;
        const confirmed = [...proposals].filter(([id]) => requests.get(id) === actor.runId).flatMap(([, list]) => list).filter((proposal) => proposal.file === event.file && createHash("sha256").update(proposal.after).digest("hex") === event.contentHash).at(-1);
        if (confirmed && board.get(actor.runId)) board.actual(actor.runId, [...proposalSymbolKeys(confirmed)]);
        else pendingAttributions.add(`${participantKey(actor)}:${String(event.file)}`);
        for (const [id, reservation] of reservations) if (reservation.actor.runId === actor.runId && reservation.changes.some((proposal) => proposal.file === event.file)) reservations.delete(id);
      }
      if (event.type === "arbitration_updated") {
        const recorded = event.card as import("../coordination/ownerCards.js").OwnerCard;
        const card = cards.list().find((entry) => entry.conflict.pairId === recorded.conflict.pairId);
        if (card && recorded.suggestionStatus !== "analyzing") cards.suggestion(card.id, recorded.suggestion ? { explanation: recorded.explanation, suggestion: recorded.suggestion } : undefined);
      }
      if (event.type === "ui_action" && String(event.action).startsWith("arbitration_")) {
        const action = String(event.action).slice("arbitration_".length);
        const card = cards.list().find((entry) => entry.conflict.pairId === event.pairId && entry.status === "waiting");
        if (card && ["accept", "yield", "chat"].includes(action)) cards.act(card.id, String(event.memberId), action as "accept" | "yield" | "chat");
        else if (options.mode !== "all-auto") errors.push(`unmatched-action:${event.seq}`);
      }
      if (event.type === "agent_notice" && event.level === "light") {
        const notice = event.notice as { id: string; memberId: string; at: number; conflict?: import("../model/types.js").GuardConflict };
        const conflict = notice.conflict;
        const kind = conflict ? arbitrate({ left: conflict.self as Participant, right: conflict.other as Participant, later: conflict.self as Participant }, conflict, options.mode).kind : "agent-system";
        const key = `${conflict?.pairId ?? notice.id}:${conflict?.revision ?? 0}:${notice.memberId}:light`;
        if (!seen.has(key) && (!conflict || conflict.decision !== "lock" || options.mode === "owner")) { seen.add(key); interruptions.push({ memberId: notice.memberId, at: notice.at, kind, level: "light", pairId: conflict?.pairId ?? notice.id, revision: conflict?.revision ?? 0 }); }
      }
      await Promise.all(pendingJudgements.splice(0));
    }
    await advanceTo(clock.now() + Math.ceil(semantic.getCandidatePairs().length / (options.maxJudgementsPerFrame ?? config?.maxJudgementsPerFrame ?? 20)) * (options.judgementFrameMs ?? config?.judgementFrameMs ?? 0));
    for (const attribution of pendingAttributions) errors.push(`unmatched-attribution:${attribution}`);
    return { mode: options.mode, actions, judgements, changeUnits: semantic.statistics(), changeUnitsByActor: semantic.statisticsByActor(), injections, interruptions, statistics: interruptionStats(interruptions, clock.now()), outcomes: cards.stats(), cards: cards.list(), intents: board.list(), errors, modelSimulation: options.adjudicate ? "provider" : "local-rules" };
  } finally { await cards.dispose(); tracker.flush(); session.dispose(); }
}
