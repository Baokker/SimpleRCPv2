import { createHash } from "node:crypto";
import ts from "typescript";
import { shouldTriggerCapture, defaultCaptureTriggerThresholds } from "./triggerPolicy.js";
import type { CaptureSuggestion, CaptureTriggerType, KnowledgeCardType, SuggestedAnchor } from "../schema/card.js";
import { AuthorshipIndex, isMemberActor } from "./authorship.js";
import { VirtualCaptureClock, type CaptureClock } from "./clock.js";
import { parseActor, type CaptureAgentFileChange, type CaptureAgentRunEvent, type CaptureAgentToolEvent, type CaptureChatEvent, type CaptureEditEvent, type CaptureEvent, type ExternalCollaborationEvent } from "./events.js";
import { inferCoOccurrence, type CaptureActivity } from "./inference.js";

export interface CaptureEngineConfig {
  checkpointIdleMs: number;
  chatWindowMs: number;
  chatMinMessages: number;
  magicMinDigits: number;
  chatCooldownMs: number;
  chatAfterMs: number;
  chatBeforeMs: number;
  todoCooldownMs: number;
  magicCooldownMs: number;
  dependencyCooldownMs: number;
  rollbackWindowMs: number;
  rollbackCooldownMs: number;
  rollbackMinChars: number;
  rollbackMinLines: number;
  overwrittenWindowMs: number;
  overwrittenCooldownMs: number;
  overwrittenMinLines: number;
  overwrittenMinRatio: number;
  historyMs: number;
  agentInterruptWindowMs: number;
  agentRevisionWindowMs: number;
  agentRevisionCooldownMs: number;
  agentRevisionMinRatio: number;
  agentCorrectionWindowMs: number;
  agentRetryWindowMs: number;
  agentSimilarityThreshold: number;
  correctionTerms: string[];
  weights: { dwell: number; edits: number; speakers: number; textMatch: number };
}
export const defaultCaptureEngineConfig: CaptureEngineConfig = {
  ...defaultCaptureTriggerThresholds, magicMinDigits: 3,
  checkpointIdleMs: 30_000, chatWindowMs: 300_000, chatCooldownMs: 300_000,
  chatBeforeMs: 120_000, chatAfterMs: 60_000, todoCooldownMs: 300_000,
  magicCooldownMs: 120_000, dependencyCooldownMs: 0, rollbackWindowMs: 300_000,
  rollbackCooldownMs: 300_000, overwrittenWindowMs: 600_000, overwrittenCooldownMs: 300_000,
  overwrittenMinLines: 3, overwrittenMinRatio: 0.5, historyMs: 1_800_000,
  agentInterruptWindowMs: 180_000, agentRevisionWindowMs: 900_000, agentRevisionCooldownMs: 300_000, agentCorrectionWindowMs: 600_000,
  agentRevisionMinRatio: 0.3,
  agentRetryWindowMs: 1_800_000, agentSimilarityThreshold: 0.35,
  correctionTerms: ["改", "改成", "修改", "纠正", "不要", "换成", "重做", "修复", "instead", "revert", "change", "correct", "fix", "do not"],
  weights: { dwell: 1, edits: 0.02, speakers: 2, textMatch: 3 }
};
export type CaptureConfigInput = Partial<Omit<CaptureEngineConfig, "weights">> & { weights?: Partial<CaptureEngineConfig["weights"]> };
interface CheckpointState { baseline: string; dependencyBaseline?: string; lastEditAt: number; timer?: number; dirty: boolean; }
interface FileState {
  text: string;
  dependencyBaseline?: string;
  checkpoints: Map<string, CheckpointState>;
  rollbacks: Array<{ at: number; hash: string; before: string; after: string; removedChars: number; deletedLines: number; actor: string }>;
}
export interface CaptureCheckpoint { at: number; file: string; actor: string; before: string; after: string; }
export interface AgentRevisedEvent {
  file: string;
  agent: string;
  runId: string;
  editor: string;
  ownerId?: string;
  intervals: import("./authorship.js").OverwrittenInterval[];
  at: number;
  anchors?: SuggestedAnchor[];
  diff?: ReturnType<typeof changedSnippet>;
  replacement?: string;
  chatMessages?: CaptureChatEvent[];
  cursors?: CaptureActivity[];
  restored?: { beforeText: string; afterText: string };
  agentPrompt?: string;
  agentFileChange?: CaptureAgentFileChange;
  correctionFiles?: Array<{file: string; beforeText: string; afterText: string}>;
}

export function createAgentRevisedSuggestion(event: AgentRevisedEvent): CaptureSuggestion {
  const digest = createHash("sha256").update(`${event.file}\n${event.editor}\n${event.runId}`).digest("hex").slice(0, 16);
  const lineCount = Math.max(1, event.intervals.reduce((max, interval) => Math.max(max, interval.deletedText.split(/\r?\n/).length), 1));
  return {
    id: `capture-${event.at}-agent-revised-${digest}`,
    triggerType: "agent.revised",
    createdAt: event.at,
    origin: "human-agent",
    actors: { memberIds: [...new Set([event.editor, ...(event.ownerId ? [event.ownerId] : [])])].sort(), runIds: [event.runId] },
    suggestedType: "decision",
    suggestedTitle: "成员改写了 Agent 的内容",
    suggestedSummary: `成员在 ${event.file} 上改写了 Agent 的内容`,
    suggestedAnchors: event.anchors ?? [{ file: event.file, startLine: 1, endLine: lineCount, score: 1, reasons: ["Agent 修改范围"] }],
    evidence: { file: event.file, runId: event.runId, editor: event.editor, ownerId: event.ownerId, overwritten: event.intervals, ...(event.diff ? { diff: event.diff } : {}), ...(event.replacement !== undefined ? { replacement: event.replacement } : {}), ...(event.chatMessages ? { chatMessages: event.chatMessages } : {}), ...(event.cursors ? { cursors: event.cursors } : {}), ...(event.restored ? { restored: event.restored } : {}), ...(event.agentPrompt !== undefined ? { agentPrompt: event.agentPrompt } : {}), ...(event.agentFileChange ? { agentFileChange: event.agentFileChange } : {}), ...(event.correctionFiles ? {correctionFiles: event.correctionFiles} : {}) },
    confidence: 0.7,
    state: "open"
  };
}

interface AgentRunState {
  event: CaptureAgentRunEvent;
  status: CaptureAgentRunEvent["status"];
  endedAt?: number;
  editedAfterFailure?: boolean;
  retryFrom?: { event: CaptureAgentRunEvent; similarity: number };
}

export function resolveCaptureConfig(config: CaptureConfigInput = {}): CaptureEngineConfig {
  const resolved = { ...defaultCaptureEngineConfig, ...config, weights: { ...defaultCaptureEngineConfig.weights, ...config.weights } };
  for (const [key, value] of Object.entries(resolved)) if (key !== "weights" && key !== "correctionTerms" && (typeof value !== "number" || !Number.isFinite(value) || value < 0)) throw new Error("Capture configuration must contain nonnegative finite numbers");
  for (const value of Object.values(resolved.weights)) if (typeof value !== "number" || !Number.isFinite(value) || value < 0) throw new Error("Capture weights must contain nonnegative finite numbers");
  if (!resolved.checkpointIdleMs || !resolved.chatWindowMs) throw new Error("Capture windows must be positive");
  if (!Number.isInteger(resolved.chatMinMessages) || resolved.chatMinMessages < 1 || !Number.isInteger(resolved.magicMinDigits) || resolved.magicMinDigits < 1 || resolved.overwrittenMinRatio > 1) throw new Error("Capture thresholds are invalid");
  if (resolved.agentSimilarityThreshold > 1 || resolved.agentRevisionMinRatio > 1 || !Array.isArray(resolved.correctionTerms) || resolved.correctionTerms.some((term) => typeof term !== "string" || !term)) throw new Error("Agent capture thresholds are invalid");
  return resolved;
}

export function createCaptureEngine(options: {
  clock: CaptureClock;
  config?: CaptureConfigInput;
  onSuggestion(suggestion: CaptureSuggestion): void;
  onCheckpoint?(checkpoint: CaptureCheckpoint): void;
  onAgentRevised?(event: AgentRevisedEvent): void;
  onExternalEvent?(event: ExternalCollaborationEvent): void | Promise<void>;
}) {
  const config = resolveCaptureConfig(options.config);
  const files = new Map<string, FileState>();
  const chats: CaptureChatEvent[] = [];
  const activities: CaptureActivity[] = [];
  const authorship = new AuthorshipIndex(config.historyMs);
  const cooldowns = new Map<string, number>();
  const seenChatIds = new Set<string>();
  const timers = new Set<number>();
  const agentRuns = new Map<string, AgentRunState>();
  const failedTools = new Map<string, { command?: string; executable?: string; at: number; error?: string; traceSeq?: number; editedFiles: Set<string> }[]>();
  let sequence = 0;

  function emit(trigger: CaptureTriggerType, at: number, actors: string[], evidence: Record<string, unknown>, type: KnowledgeCardType, anchors: SuggestedAnchor[] = [], origin: "human-human" | "human-agent" = "human-human", runIds: string[] = []) {
    options.onSuggestion({
      id: `capture-${at}-${++sequence}`, triggerType: trigger, createdAt: at, origin,
      actors: { memberIds: [...new Set(actors.filter(isMemberActor))].sort(), runIds: [...new Set(runIds)] },
      suggestedType: type, suggestedTitle: titles[trigger] ?? trigger,
      suggestedSummary: `${titles[trigger] ?? trigger}${typeof evidence.file === "string" ? `：${evidence.file}` : ""}`, suggestedAnchors: anchors,
      evidence, confidence: 0.7, state: "open"
    });
  }
  function cooled(key: string, at: number, duration: number) {
    const previous = cooldowns.get(key);
    if (previous !== undefined && at - previous < duration) return false;
    cooldowns.set(key, at);
    return true;
  }
  function stateFor(file: string, initial: string): FileState {
    const existing = files.get(file);
    if (existing) return existing;
    const state: FileState = { text: initial, checkpoints: new Map<string, CheckpointState>(), rollbacks: [] };
    updateDependencyBaseline(file, state, initial);
    files.set(file, state);
    return state;
  }
  function updateDependencyBaseline(file: string, state: FileState, text: string) {
    if (isPackage(file) && dependencyNames(text) !== undefined) state.dependencyBaseline = text;
  }
  function timer(at: number, callback: () => void) {
    const id = options.clock.schedule(at, () => { timers.delete(id); callback(); });
    timers.add(id);
    return id;
  }
  function cancel(id?: number) { if (id !== undefined) { options.clock.cancel(id); timers.delete(id); } }

  function checkpoint(file: string, actor: string, at: number) {
    const state = files.get(file);
    const member = state?.checkpoints.get(actor);
    if (!state || !member || !member.dirty) return;
    cancel(member.timer);
    member.timer = undefined;
    const before = member.baseline;
    const after = state.text;
    member.baseline = after;
    member.dirty = false;
    if (before === after) return;
    const diff = changedSnippet(before, after);
    const anchor = rangeAnchor(file, after, diff.startOffset, diff.endOffset);
    const todo = markerLines(before);
    if (shouldTriggerCapture({ triggerType: "todo.cleared", beforeTodos: todo.length, afterTodos: markerLines(after).length }) && cooled(`todo:${file}:${actor}`, at, config.todoCooldownMs)) {
      emit("todo.cleared", at, [actor], { file, todo: { before: todo }, diff }, "tutorial", anchor);
    }
    if (/\.[cm]?[jt]sx?$/.test(file)) {
      const previous = magicNumbers(before, config.magicMinDigits);
      const added = magicNumbers(after, config.magicMinDigits).filter(item => {
        const index = previous.findIndex(old => old.number === item.number);
        if (index < 0) return true;
        previous.splice(index, 1);
        return false;
      });
      if (shouldTriggerCapture({ triggerType: "magicNumber.added", addedMagicNumbers: added.length }) && cooled(`magic:${file}:${actor}`, at, config.magicCooldownMs)) {
        emit("magicNumber.added", at, [actor], { file, added, diff, usage: added.map(item => ({ number: item.number, occurrences: findUsages(item.number, file) })) }, "constraint", anchor);
      }
    }
    if (isPackage(file)) {
      dependencies(file, member.dependencyBaseline ?? before, after, actor, at, anchor);
      if (dependencyNames(after) !== undefined) member.dependencyBaseline = after;
    }
    options.onCheckpoint?.({ file, actor, at, before, after });
  }
  function dependencies(file: string, before: string, after: string, actor: string, at: number, anchors: SuggestedAnchor[]) {
    const old = dependencyNames(before);
    const next = dependencyNames(after);
    if (!old || !next) return;
    const added = next.filter(item => !old.includes(item));
    const removed = old.filter(item => !next.includes(item));
    if (!shouldTriggerCapture({ triggerType: "dependency.changed", dependencyChanges: added.length + removed.length }) || !cooled(`dependency:${file}:${actor}`, at, config.dependencyCooldownMs)) return;
    emit("dependency.changed", at, [actor], { file, added, removed, diff: changedSnippet(before, after), source: actor, dependencyUsages: Object.fromEntries([...added, ...removed].map(name => [name, findUsages(name, file)])) }, "risk", anchors);
  }
  function findUsages(value: string, exclude: string) {
    const hits: Array<{ file: string; line: number; context: string }> = [];
    for (const [file, state] of files) {
      if (file === exclude) continue;
      state.text.split("\n").forEach((line, index) => { if (line.includes(value) && hits.length < 40) hits.push({ file, line: index + 1, context: line.slice(0, 240) }); });
    }
    return hits;
  }

  function edit(event: CaptureEditEvent) {
    const state = stateFor(event.file, event.textBefore ?? "");
    const before = state.text;
    const after = applyCaptureOps(before, event.ops);
    if (event.textAfter !== undefined && after !== event.textAfter) throw new Error(`Capture text mismatch: ${event.file}`);
    const overwritten = authorship.apply(event.file, event.actor, event.ops, event.at).filter(interval => event.at - interval.at <= Math.max(config.overwrittenWindowMs, config.agentRevisionWindowMs));
    const groups = new Map<string, typeof overwritten>();
    const revisedRuns = new Set<string>();
    for (const item of overwritten) groups.set(item.actor, [...(groups.get(item.actor) ?? []), item]);
    for (const [author, intervals] of groups) {
      const significant = intervals.some(item => shouldTriggerCapture({ triggerType: "edit.overwritten", overwrittenLines: countLines(item.deletedText), overwrittenRatio: item.ratio, overwrittenAgeMs: event.at - item.at }, config));
      const editorActor = parseActor(event.actor);
      const targetActor = parseActor(author);
      const agentSignificant = intervals.some((item) => item.deletedLineIds.length / Math.max(1, item.groupLineCount) >= config.agentRevisionMinRatio && event.at - item.at <= config.agentRevisionWindowMs);
      if ((significant || agentSignificant) && editorActor.kind === "member" && targetActor.kind === "agent" && targetActor.runId) {
        const ownerId = intervals.find((interval) => interval.ownerId)?.ownerId;
        if (cooled(`agent-revised:${event.file}:${targetActor.runId}`, event.at, config.agentRevisionCooldownMs)) {
          const start = Math.min(...event.ops.map((operation) => operation.start));
          const end = Math.max(...event.ops.map((operation) => operation.start + operation.insertText.length));
          const run = targetActor.runId ? agentRuns.get(targetActor.runId) : undefined;
          const agentFileChange = run?.event.fileChanges?.find((change) => change.file === event.file);
          options.onAgentRevised?.({
            file: event.file,
            agent: author,
            runId: targetActor.runId,
            editor: event.actor,
            ownerId,
            intervals,
            at: event.at,
            anchors: rangeAnchor(event.file, after, start, end),
            diff: changedSnippet(before, after), correctionFiles: [{file: event.file, beforeText: before, afterText: after}],
            replacement: event.ops.map((operation) => operation.insertText).join(""),
            chatMessages: chats.filter(message => [event.actor, ownerId].includes(message.authorId) && message.at >= Math.min(...intervals.map(item => item.at))),
            cursors: [event.actor, ownerId].filter((actor): actor is string => Boolean(actor)).map(actor => activities.filter(activity => activity.type === "cursor" && activity.actor === actor).at(-1)).filter((activity): activity is CaptureActivity => Boolean(activity)),
            agentPrompt: run?.event.prompt,
            agentFileChange
          });
          revisedRuns.add(targetActor.runId);
        }
        continue;
      }
      const pair = [author, event.actor].sort().join(":");
      if (!significant || !cooled(`overwrite:${event.file}:${pair}`, event.at, config.overwrittenCooldownMs)) continue;
      emit("edit.overwritten", event.at, [author, event.actor], {
        file: event.file, author, editor: event.actor, overwritten: intervals,
        replacement: event.ops.map(op => op.insertText).join(""), elapsedMs: event.at - Math.min(...intervals.map(item => item.at)),
        chatMessages: chats.filter(message => [author, event.actor].includes(message.authorId) && message.at >= Math.min(...intervals.map(item => item.at))),
        cursors: [author, event.actor].map(actor => activities.filter(activity => activity.type === "cursor" && activity.actor === actor).at(-1)).filter(Boolean),
        diff: changedSnippet(before, after), revisionAfter: event.revisionAfter
      }, "decision", rangeAnchor(event.file, after, event.ops[0]?.start ?? 0, (event.ops[0]?.start ?? 0) + (event.ops[0]?.insertText.length ?? 0)));
    }
    if (isMemberActor(event.actor) && event.textAfter !== undefined) {
      for (const [runId, run] of agentRuns) {
        const fileChange = run.event.fileChanges?.find((change) => change.file === event.file && change.beforeText !== undefined && change.afterText !== undefined && change.beforeText !== change.afterText);
        if (revisedRuns.has(runId) || !fileChange || run.endedAt === undefined || event.at - run.endedAt > config.agentRevisionWindowMs || fileChange.afterText !== before || fileChange.beforeText !== after) continue;
        if (!cooled(`agent-revised:${event.file}:${runId}`, event.at, config.agentRevisionCooldownMs)) continue;
        options.onAgentRevised?.({
          file: event.file,
          agent: `agent:${runId}`,
          runId,
          editor: event.actor,
          ownerId: run.event.memberId,
          intervals: [],
          at: event.at,
          anchors: rangeAnchor(event.file, after, 0, after.length),
          diff: changedSnippet(before, after), correctionFiles: [{file: event.file, beforeText: before, afterText: after}],
          replacement: after,
          restored: { beforeText: fileChange.beforeText!, afterText: fileChange.afterText! },
          agentPrompt: run.event.prompt,
          agentFileChange: fileChange
        });
      }
    }
    if (isMemberActor(event.actor)) {
      const removedChars = event.ops.reduce((sum, op) => sum + op.deleteCount, 0);
      const insertedChars = event.ops.reduce((sum, op) => sum + op.insertText.length, 0);
      const deletedLines = Math.max(0, event.ops.reduce((sum, op) => sum + (before.slice(op.start, op.start + op.deleteCount).match(/\n/g)?.length ?? 0) - (op.insertText.match(/\n/g)?.length ?? 0), 0));
      state.rollbacks = state.rollbacks.filter(item => event.at - item.at <= config.rollbackWindowMs);
      const rollback = state.rollbacks.find(item => sha(after) === item.hash);
      if (rollback && before !== after
        && shouldTriggerCapture({ triggerType: "rollback.detected", netDeletedChars: rollback.removedChars, deletedLines: rollback.deletedLines, restoredOriginalHash: true, intermediateHashChanged: true, rollbackAgeMs: event.at - rollback.at }, config)
        && cooled(`rollback:${event.file}`, event.at, config.rollbackCooldownMs)) {
        emit("rollback.detected", event.at, [rollback.actor, event.actor], { file: event.file, deletedAt: rollback.at, deletion: { removedChars: rollback.removedChars, deletedLines: rollback.deletedLines }, beforeAfter: { before: rollback.before.slice(0, 6000), after: rollback.after.slice(0, 6000) }, restored: after.slice(0, 6000), deleter: rollback.actor, restorer: event.actor }, "negative", rangeAnchor(event.file, after, 0, after.length));
        state.rollbacks = state.rollbacks.filter(item => item !== rollback);
      }
      if (removedChars - insertedChars > config.rollbackMinChars || deletedLines > config.rollbackMinLines) state.rollbacks.push({ at: event.at, hash: sha(before), before, after, removedChars: removedChars - insertedChars, deletedLines, actor: event.actor });
      const member = state.checkpoints.get(event.actor) ?? {
        baseline: before,
        dependencyBaseline: isPackage(event.file) && dependencyNames(before) !== undefined ? before : state.dependencyBaseline,
        lastEditAt: event.at,
        dirty: false
      };
      member.lastEditAt = event.at;
      member.dirty = true;
      cancel(member.timer);
      member.timer = timer(event.at + config.checkpointIdleMs, () => checkpoint(event.file, event.actor, options.clock.now()));
      state.checkpoints.set(event.actor, member);
      for (const op of event.ops) activities.push({ type: "edit", actor: event.actor, file: event.file, at: event.at, startLine: lineAt(before, op.start), endLine: lineAt(before, op.start + op.deleteCount) + (op.insertText.match(/\n/g)?.length ?? 0), chars: op.deleteCount + op.insertText.length });
    }
    state.text = after;
    updateDependencyBaseline(event.file, state, after);
  }

  function agentRun(event: CaptureAgentRunEvent) {
    const previous = event.previousRunId
      ? agentRuns.get(event.previousRunId)
      : event.sessionId
        ? [...agentRuns.values()].filter((run) => run.event.sessionId === event.sessionId && run.endedAt !== undefined).sort((a, b) => (b.endedAt ?? 0) - (a.endedAt ?? 0))[0]
        : undefined;
    const retryPrevious = event.previousRunId
      ? agentRuns.get(event.previousRunId)
      : [...agentRuns.values()].filter((run) => run.event.memberId === event.memberId && run.endedAt !== undefined && (run.status === "failed" || run.status === "cancelled")).sort((a, b) => (b.endedAt ?? 0) - (a.endedAt ?? 0))[0];
    if (event.action === "start") {
      if (previous?.status === "cancelled" && previous.event.action === "cancelled" && !previous.event.interruptedByMemberId && previous.endedAt !== undefined && event.at - previous.endedAt <= config.agentInterruptWindowMs && previous.event.memberId === event.memberId) {
        emit("agent.interrupted", event.at, [event.memberId], {
          primaryActor: event.memberId,
          run: previous.event,
          interruption: { memberId: event.memberId, nextRunId: event.runId, nextPrompt: event.prompt },
          chatMessages: chats.filter(message => message.authorId === event.memberId && message.at >= event.at - config.agentInterruptWindowMs && message.at <= event.at)
        }, "negative", [], "human-agent", [previous.event.runId, event.runId]);
      }
      if (previous?.endedAt !== undefined && event.at - previous.endedAt <= config.agentCorrectionWindowMs && isCorrection(event.prompt, previous.event.fileChanges, config.correctionTerms)) {
        emit("agent.corrected", event.at, [event.memberId, previous.event.memberId], { primaryActor: event.memberId, previousRun: previous.event, correction: event, previousDiff: previous.event.fileChanges }, "decision", [], "human-agent", [previous.event.runId, event.runId]);
      }
      const retrySimilarity = retryPrevious ? promptSimilarity(event.prompt, retryPrevious.event.prompt) : 0;
      agentRuns.set(event.runId, {
        event,
        status: "running",
        ...(retryPrevious && (retryPrevious.status === "failed" || retryPrevious.status === "cancelled") && retryPrevious.endedAt !== undefined && event.at - retryPrevious.endedAt <= config.agentRetryWindowMs && retrySimilarity >= config.agentSimilarityThreshold ? { retryFrom: { event: retryPrevious.event, similarity: retrySimilarity } } : {})
      });
      return;
    }
    const state = agentRuns.get(event.runId) ?? { event, status: event.status };
    state.event = { ...state.event, ...event };
    state.status = event.status ?? (event.action === "end" ? "completed" : event.action === "interrupted" ? "cancelled" : event.action);
    state.endedAt = event.at;
    agentRuns.set(event.runId, state);
    if (event.agentRanges?.length) {
      const grouped = new Map<string, Array<{ start: number; end: number; text: string; ownerId?: string }>>();
      for (const range of event.agentRanges) grouped.set(range.file, [...(grouped.get(range.file) ?? []), range]);
      for (const [file, ranges] of grouped) authorship.register(file, `agent:${event.runId}`, ranges.map((range) => ({ ...range, ownerId: range.ownerId ?? event.memberId })), event.at);
    }
    if (event.action === "end" && state.status === "completed" && state.retryFrom && state.retryFrom.event.memberId === event.memberId) {
      emit("agent.retried", event.at, [event.memberId], { failedRun: state.retryFrom.event, retryRun: event, similarity: state.retryFrom.similarity }, "tutorial", [], "human-agent", [state.retryFrom.event.runId, event.runId]);
    }
    if (event.action === "interrupted" || (event.action === "cancelled" && event.interruptedByMemberId)) {
      const interrupter = event.interruptedByMemberId ?? event.memberId;
      emit("agent.interrupted", event.at, [interrupter, event.memberId], {
        primaryActor: interrupter,
        run: event,
        interruption: { memberId: interrupter, runId: event.interruptsRunId, nextPrompt: event.interruptedByPrompt },
        chatMessages: chats.filter(message => (message.authorId === interrupter || message.authorId === event.memberId) && message.at >= event.at - config.agentInterruptWindowMs && message.at <= event.at)
      }, "negative", [], "human-agent", [event.runId, ...(event.interruptsRunId ? [event.interruptsRunId] : [])]);
    }
    failedTools.delete(event.runId);
  }

  function agentTool(event: CaptureAgentToolEvent) {
    const command = event.command?.trim();
    const executable = command?.split(/\s+/)[0];
    const entries = failedTools.get(event.runId) ?? [];
    if (!event.success) {
      if (!isNetworkError(event.error)) entries.push({ command, executable, at: event.at, error: event.error, traceSeq: event.traceSeq, editedFiles: new Set() });
      failedTools.set(event.runId, entries);
      return;
    }
    const failure = entries.find((item) => commandsMatch(item.command, command));
    if (!failure || (event.exitCode !== undefined && event.exitCode !== 0)) return;
    failedTools.set(event.runId, entries.filter((item) => item !== failure));
    if (!failure.editedFiles.size) return;
    const traceRefs = [failure.traceSeq, event.traceSeq].filter((seq): seq is number => seq !== undefined).map((seq) => ({ runId: event.runId, seq }));
    emit("agent.toolRecovered", event.at, [event.memberId], { runId: event.runId, ...(traceRefs.length ? { traceRefs } : {}), failure: { command: failure.command, error: failure.error?.slice(0, 2000) }, modifiedFiles: [...failure.editedFiles], success: { command, exitCode: event.exitCode, traceSeq: event.traceSeq } }, "tutorial", [], "human-agent", [event.runId]);
  }

  function process(event: CaptureEvent) {
    if (event.at !== options.clock.now()) throw new Error("Advance the capture clock before processing an event");
    if (event.type === "docOpen") {
      const state = stateFor(event.file, event.text);
      if (state.text !== event.text) { state.text = event.text; authorship.retire(event.file); }
      updateDependencyBaseline(event.file, state, event.text);
    } else if (event.type === "edit") edit(event);
    else if (event.type === "cursor") activities.push({ type: "cursor", actor: event.memberId, file: event.file, at: event.at, startLine: event.position.line + 1, endLine: event.selection.endLine + 1 });
    else if (event.type === "chat" && event.kind === "member" && !seenChatIds.has(event.messageId)) {
      seenChatIds.add(event.messageId);
      chats.push(event);
      const window = chats.filter(message => message.at >= event.at - config.chatWindowMs);
      if (shouldTriggerCapture({ triggerType: "chat.dense", messageCount: window.length, windowMs: config.chatWindowMs }, config) && cooled("chat", event.at, config.chatCooldownMs)) {
        timer(event.at + config.chatAfterMs, () => emit("chat.dense", options.clock.now(), window.map(message => message.authorId), { chatMessages: window, windowStart: window[0]!.at, windowEnd: event.at, primaryActor: mostActiveSpeaker(window) }, "context", infer(window, options.clock.now())));
      }
    } else if (event.type === "fileExternal") {
      const state = stateFor(event.file, event.textBefore ?? "");
      if (event.change === "unlink") {
        for (const member of state.checkpoints.values()) cancel(member.timer);
        authorship.retire(event.file);
        files.delete(event.file);
        return;
      }
      const before = event.textBefore ?? state.text;
      if (event.textAfter !== undefined) {
        if (event.textAfter !== before) for (const failures of failedTools.values()) for (const failure of failures) failure.editedFiles.add(event.file);
        if (isPackage(event.file)) {
          const baseline = dependencyNames(before) !== undefined ? before : state.dependencyBaseline ?? before;
          dependencies(event.file, baseline, event.textAfter, "filesystem", event.at, rangeAnchor(event.file, event.textAfter, 0, event.textAfter.length));
          updateDependencyBaseline(event.file, state, event.textAfter);
        }
        if (!event.hasDocument) state.text = event.textAfter;
      }
    } else if (event.type === "memberPresence" && event.action !== "join") {
      activities.push({ type: "presence", actor: event.memberId, file: event.previousFile ?? "", at: event.at, startLine: 0, endLine: 0 });
      for (const file of files.keys()) if (event.action === "leave" || file === event.previousFile) checkpoint(file, event.memberId, event.at);
    } else if (event.type === "docRetired") {
      const state = files.get(event.file);
      for (const [actor] of state?.checkpoints ?? []) checkpoint(event.file, actor, event.at);
      authorship.retire(event.file);
      state?.checkpoints.clear();
    } else if (event.type === "agentRun") agentRun(event);
    else if (event.type === "agentTool") agentTool(event);
    const cutoff = event.at - config.historyMs;
    let expiredCount = 0;
    const dwellBoundaries = new Map<string, CaptureActivity>();
    while (activities[expiredCount] && activities[expiredCount]!.at < cutoff) {
      const activity = activities[expiredCount++]!;
      if (activity.type !== "edit") dwellBoundaries.set(activity.actor, activity);
    }
    if (expiredCount) activities.splice(0, expiredCount, ...[...dwellBoundaries.values()].sort((a, b) => a.at - b.at));
    while (chats[0] && chats[0].at < cutoff) seenChatIds.delete(chats.shift()!.messageId);
    for (const [key, at] of cooldowns) if (at < cutoff) cooldowns.delete(key);
  }
  async function processExternal(event: ExternalCollaborationEvent) {
    if (!["terminal.commandDenied", "terminal.commandApproved", "conflict.detected", "conflict.resolved"].includes(event.type)
      || !Number.isFinite(event.at) || event.at < 0
      || !Array.isArray(event.participants) || event.participants.length === 0 || event.participants.some((participant) => typeof participant !== "string" || !participant.trim())
      || typeof event.description !== "string" || !event.description.trim()
      || (event.file !== undefined && (typeof event.file !== "string" || !event.file.trim()))) throw new Error("External collaboration event is invalid");
    if (event.at !== options.clock.now()) throw new Error("Advance the capture clock before processing an external event");
    await options.onExternalEvent?.(event);
  }
  function infer(messages: CaptureChatEvent[], endAt: number) {
    const firstAt = messages.length ? Math.min(...messages.map(message => message.at)) : endAt;
    const lastAt = messages.length ? Math.max(...messages.map(message => message.at)) : endAt;
    return inferCoOccurrence({ messages, activities, texts: new Map([...files].map(([file, state]) => [file, state.text])), from: firstAt - config.chatBeforeMs, to: Math.min(endAt, lastAt + config.chatAfterMs), weights: config.weights });
  }
  return { process, processExternal, infer, config, authorship, dispose() { for (const id of timers) cancel(id); files.clear(); activities.length = 0; chats.length = 0; agentRuns.clear(); failedTools.clear(); } };
}

export function replayEvents(events: CaptureEvent[], config: CaptureConfigInput = {}, endAt?: number): CaptureSuggestion[] {
  const clock = new VirtualCaptureClock(events[0]?.at ?? 0);
  const suggestions: CaptureSuggestion[] = [];
  const engine = createCaptureEngine({ clock, config, onSuggestion: suggestion => suggestions.push(suggestion), onAgentRevised: event => suggestions.push(createAgentRevisedSuggestion(event)) });
  let seq = -1;
  for (const event of events) {
    if (event.seq <= seq) throw new Error("Capture events must have increasing sequence numbers");
    seq = event.seq;
    clock.advanceTo(event.at);
    engine.process(event);
  }
  clock.advanceTo(endAt ?? clock.now() + Math.max(engine.config.checkpointIdleMs, engine.config.chatAfterMs));
  engine.dispose();
  return suggestions;
}

export function applyCaptureOps(before: string, ops: CaptureEditEvent["ops"]) {
  let previousEnd = 0;
  let result = "";
  for (const op of ops) {
    if (!Number.isInteger(op.start) || !Number.isInteger(op.deleteCount) || op.start < previousEnd || op.deleteCount < 0 || op.start + op.deleteCount > before.length) throw new Error("Capture edit operation is invalid");
    result += before.slice(previousEnd, op.start) + op.insertText;
    previousEnd = op.start + op.deleteCount;
  }
  return result + before.slice(previousEnd);
}
export function lineAt(text: string, offset: number) { return text.slice(0, offset).split("\n").length; }
function sha(text: string) { return createHash("sha256").update(text).digest("hex"); }
function countLines(text: string) { return text ? text.split(/\r?\n/).length - (text.endsWith("\n") ? 1 : 0) : 0; }
function isPackage(file: string) { return file === "package.json" || file.endsWith("/package.json"); }
function markerLines(text: string) { return text.split("\n").flatMap((line, index) => { const token = line.match(/\b(TODO|FIXME|HACK)\b/)?.[0]; return token ? [{ line: index + 1, token, text: line }] : []; }); }
function magicNumbers(text: string, minDigits: number) {
  const lines = text.split("\n");
  const source = ts.createSourceFile("capture.ts", text, ts.ScriptTarget.Latest);
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, false, ts.LanguageVariant.Standard, text);
  const comments = new Set<number>();
  const numbers: Array<{ number: string; line: number; lineText: string }> = [];
  for (let token = scanner.scan(); token !== ts.SyntaxKind.EndOfFileToken; token = scanner.scan()) {
    const startLine = source.getLineAndCharacterOfPosition(scanner.getTokenPos()).line + 1;
    if (token === ts.SyntaxKind.SingleLineCommentTrivia || token === ts.SyntaxKind.MultiLineCommentTrivia) {
      const endLine = source.getLineAndCharacterOfPosition(scanner.getTextPos()).line + 1;
      for (let line = startLine; line <= endLine; line++) comments.add(line);
    } else if (token === ts.SyntaxKind.NumericLiteral) {
      const number = scanner.getTokenText();
      const digits = number.replaceAll("_", "").match(/^\d+/)?.[0];
      if (digits && digits.length >= minDigits) numbers.push({ number, line: startLine, lineText: lines[startLine - 1]! });
    }
  }
  return numbers.filter(item => !comments.has(item.line) && !comments.has(item.line - 1));
}
function dependencyNames(text: string): string[] | undefined {
  if (!text.trim()) return [];
  try {
    const value = JSON.parse(text) as Record<string, unknown>;
    if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
    return [...new Set(["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"].flatMap(field => value[field] && typeof value[field] === "object" ? Object.keys(value[field] as object) : []))].sort();
  } catch (error) { if (error instanceof SyntaxError) return undefined; throw error; }
}
export function changedSnippet(before: string, after: string) {
  let startOffset = 0;
  while (startOffset < before.length && startOffset < after.length && before[startOffset] === after[startOffset]) startOffset++;
  let oldEnd = before.length; let endOffset = after.length;
  while (oldEnd > startOffset && endOffset > startOffset && before[oldEnd - 1] === after[endOffset - 1]) { oldEnd--; endOffset--; }
  return { startOffset, endOffset, startLine: lineAt(after, startOffset), endLine: lineAt(after, endOffset), before: before.slice(Math.max(0, startOffset - 120), Math.min(before.length, oldEnd + 120)).slice(0, 6000), after: after.slice(Math.max(0, startOffset - 120), Math.min(after.length, endOffset + 120)).slice(0, 6000) };
}
function rangeAnchor(file: string, text: string, start: number, end: number): SuggestedAnchor[] {
  if (!text) return [];
  return [{ file, startLine: lineAt(text, Math.min(start, text.length)), endLine: lineAt(text, Math.min(Math.max(start, end), text.length)), score: 1, reasons: ["编辑范围"] }];
}
function mostActiveSpeaker(messages: CaptureChatEvent[]) {
  const counts = new Map<string, number>();
  for (const message of messages) counts.set(message.authorId, (counts.get(message.authorId) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0];
}
function isCorrection(prompt: string, changes: unknown, terms: string[]) {
  const value = prompt.toLowerCase();
  const previousFiles = Array.isArray(changes) && changes.some((change) => change && typeof change === "object" && typeof (change as { file?: unknown }).file === "string" && prompt.includes((change as { file: string }).file));
  const correction = terms.some((term) => value.includes(term.toLowerCase()));
  return correction || (previousFiles && correction);
}
function promptSimilarity(left: string, right: string) {
  const tokens = (value: string) => new Set(value.toLowerCase().split(/[^\p{L}\p{N}_]+/u).filter((item) => item.length > 1));
  const a = tokens(left); const b = tokens(right); const intersection = [...a].filter((item) => b.has(item)).length;
  return intersection / Math.max(1, Math.min(a.size, b.size));
}
function isNetworkError(value?: string) { return /timeout|timed out|dns|network|eai_again|enotfound|connection reset|install source/i.test(value ?? ""); }
function commandsMatch(left?: string, right?: string) {
  if (!left || !right) return false;
  if (left.trim() === right.trim()) return true;
  const leftTokens = left.trim().split(/\s+/);
  const rightTokens = right.trim().split(/\s+/);
  if (leftTokens[0] !== rightTokens[0]) return false;
  const leftArguments = new Set(leftTokens.slice(1));
  const rightArguments = new Set(rightTokens.slice(1));
  if (!leftArguments.size || !rightArguments.size) return true;
  const shared = [...leftArguments].filter((token) => rightArguments.has(token)).length;
  return shared / Math.max(1, Math.min(leftArguments.size, rightArguments.size)) >= 0.5;
}
const titles: Record<string, string> = { "chat.dense": "协作讨论", "todo.cleared": "待办标记已完成", "magicNumber.added": "新增数字常量", "dependency.changed": "依赖变化", "rollback.detected": "内容恢复", "edit.overwritten": "成员改写了协作者的内容", "agent.interrupted": "Agent 任务被打断", "agent.revised": "成员改写了 Agent 的内容", "agent.corrected": "成员纠正了 Agent 任务", "agent.retried": "失败任务再次运行", "agent.toolRecovered": "工具失败后修复" };
