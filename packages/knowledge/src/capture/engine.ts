import { createHash } from "node:crypto";
import ts from "typescript";
import { shouldTriggerCapture, defaultCaptureTriggerThresholds } from "./triggerPolicy.js";
import type { CaptureSuggestion, CaptureTriggerType, KnowledgeCardType, SuggestedAnchor } from "../schema/card.js";
import { AuthorshipIndex, isMemberActor } from "./authorship.js";
import { VirtualCaptureClock, type CaptureClock } from "./clock.js";
import { parseActor, type CaptureChatEvent, type CaptureEditEvent, type CaptureEvent } from "./events.js";
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
  weights: { dwell: number; edits: number; speakers: number; textMatch: number };
}
export const defaultCaptureEngineConfig: CaptureEngineConfig = {
  ...defaultCaptureTriggerThresholds, magicMinDigits: 3,
  checkpointIdleMs: 30_000, chatWindowMs: 300_000, chatCooldownMs: 300_000,
  chatBeforeMs: 120_000, chatAfterMs: 60_000, todoCooldownMs: 300_000,
  magicCooldownMs: 120_000, dependencyCooldownMs: 0, rollbackWindowMs: 300_000,
  rollbackCooldownMs: 300_000, overwrittenWindowMs: 600_000, overwrittenCooldownMs: 300_000,
  overwrittenMinLines: 3, overwrittenMinRatio: 0.5, historyMs: 1_800_000,
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
  intervals: import("./authorship.js").OverwrittenInterval[];
  at: number;
}

export function resolveCaptureConfig(config: CaptureConfigInput = {}): CaptureEngineConfig {
  const resolved = { ...defaultCaptureEngineConfig, ...config, weights: { ...defaultCaptureEngineConfig.weights, ...config.weights } };
  for (const [key, value] of Object.entries(resolved)) if (key !== "weights" && (typeof value !== "number" || !Number.isFinite(value) || value < 0)) throw new Error("Capture configuration must contain nonnegative finite numbers");
  for (const value of Object.values(resolved.weights)) if (typeof value !== "number" || !Number.isFinite(value) || value < 0) throw new Error("Capture weights must contain nonnegative finite numbers");
  if (!resolved.checkpointIdleMs || !resolved.chatWindowMs) throw new Error("Capture windows must be positive");
  if (!Number.isInteger(resolved.chatMinMessages) || resolved.chatMinMessages < 1 || !Number.isInteger(resolved.magicMinDigits) || resolved.magicMinDigits < 1 || resolved.overwrittenMinRatio > 1) throw new Error("Capture thresholds are invalid");
  return resolved;
}

export function createCaptureEngine(options: {
  clock: CaptureClock;
  config?: CaptureConfigInput;
  onSuggestion(suggestion: CaptureSuggestion): void;
  onCheckpoint?(checkpoint: CaptureCheckpoint): void;
  onAgentRevised?(event: AgentRevisedEvent): void;
}) {
  const config = resolveCaptureConfig(options.config);
  const files = new Map<string, FileState>();
  const chats: CaptureChatEvent[] = [];
  const activities: CaptureActivity[] = [];
  const authorship = new AuthorshipIndex(config.historyMs);
  const cooldowns = new Map<string, number>();
  const seenChatIds = new Set<string>();
  const timers = new Set<number>();
  let sequence = 0;

  function emit(trigger: CaptureTriggerType, at: number, actors: string[], evidence: Record<string, unknown>, type: KnowledgeCardType, anchors: SuggestedAnchor[] = []) {
    options.onSuggestion({
      id: `capture-${at}-${++sequence}`, triggerType: trigger, createdAt: at, origin: "human-human",
      actors: { memberIds: [...new Set(actors.filter(isMemberActor))].sort(), runIds: [] },
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
    const overwritten = authorship.apply(event.file, event.actor, event.ops, event.at).filter(interval => event.at - interval.at <= config.overwrittenWindowMs);
    const groups = new Map<string, typeof overwritten>();
    for (const item of overwritten) groups.set(item.actor, [...(groups.get(item.actor) ?? []), item]);
    for (const [author, intervals] of groups) {
      const significant = intervals.some(item => shouldTriggerCapture({ triggerType: "edit.overwritten", overwrittenLines: countLines(item.deletedText), overwrittenRatio: item.ratio, overwrittenAgeMs: event.at - item.at }, config));
      const editorActor = parseActor(event.actor);
      const targetActor = parseActor(author);
      if (significant && editorActor.kind === "member" && targetActor.kind === "agent" && targetActor.runId) {
        options.onAgentRevised?.({ file: event.file, agent: author, runId: targetActor.runId, editor: event.actor, intervals, at: event.at });
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
    }
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
  function infer(messages: CaptureChatEvent[], endAt: number) {
    const firstAt = messages.length ? Math.min(...messages.map(message => message.at)) : endAt;
    const lastAt = messages.length ? Math.max(...messages.map(message => message.at)) : endAt;
    return inferCoOccurrence({ messages, activities, texts: new Map([...files].map(([file, state]) => [file, state.text])), from: firstAt - config.chatBeforeMs, to: Math.min(endAt, lastAt + config.chatAfterMs), weights: config.weights });
  }
  return { process, infer, config, dispose() { for (const id of timers) cancel(id); files.clear(); activities.length = 0; chats.length = 0; } };
}

export function replayEvents(events: CaptureEvent[], config: CaptureConfigInput = {}, endAt?: number): CaptureSuggestion[] {
  const clock = new VirtualCaptureClock(events[0]?.at ?? 0);
  const suggestions: CaptureSuggestion[] = [];
  const engine = createCaptureEngine({ clock, config, onSuggestion: suggestion => suggestions.push(suggestion) });
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
const titles: Record<string, string> = { "chat.dense": "协作讨论", "todo.cleared": "待办标记已完成", "magicNumber.added": "新增数字常量", "dependency.changed": "依赖变化", "rollback.detected": "内容恢复", "edit.overwritten": "成员改写了协作者的内容" };
