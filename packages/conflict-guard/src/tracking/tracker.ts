import type {
  ActiveChangeSet,
  ActorRef,
  BatchCloseReason,
  ConflictGuardEvent,
  CursorChange,
  EditBatch,
  FileChange,
  TextEdit,
  TrackedRange
} from "../model/types.js";
import { mergeRanges, transformRanges } from "./rangeTransform.js";
import { deletedSymbolKeys } from "../semantic/changes.js";

export interface ConflictGuardClock {
  now(): number;
  setTimeout(callback: () => void, delayMs: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface TrackerOptions {
  clock: ConflictGuardClock;
  idleMs?: number;
  cursorLeaveLines?: number;
  maxBatchDurationMs?: number;
  activeIdleMs?: number;
  createId?: () => string;
}

interface BatchState {
  batch: EditBatch;
  idleTimer?: unknown;
  maxTimer?: unknown;
}

interface FileState {
  text: string;
  batches: Map<string, BatchState>;
}

interface ActiveState {
  changeSet: ActiveChangeSet;
  fileTimers: Map<string, unknown>;
}

export class ConflictGuardTracker {
  private readonly files = new Map<string, FileState>();
  private readonly active = new Map<string, ActiveState>();
  private readonly latestCursors = new Map<string, CursorChange>();
  private readonly listeners = new Set<(event: ConflictGuardEvent) => void>();
  private sequence = 0;
  private readonly idleMs: number;
  private readonly cursorLeaveLines: number;
  private readonly maxBatchDurationMs: number;
  private readonly activeIdleMs: number;
  private readonly createId: () => string;

  constructor(private readonly options: TrackerOptions) {
    this.idleMs = options.idleMs ?? 1_500;
    this.cursorLeaveLines = options.cursorLeaveLines ?? 3;
    this.maxBatchDurationMs = options.maxBatchDurationMs ?? 5_000;
    this.activeIdleMs = options.activeIdleMs ?? 600_000;
    this.createId = options.createId ?? (() => `guard-${++this.sequence}`);
  }

  openDocument(file: string, text: string) {
    if (this.files.has(file)) this.retireFile(file);
    this.files.set(file, { text, batches: new Map() });
  }

  edit(edit: TextEdit) {
    const state = this.files.get(edit.file) ?? { text: edit.textBefore, batches: new Map() };
    if (!this.files.has(edit.file)) this.files.set(edit.file, state);
    if (state.text !== edit.textBefore) throw new Error(`Conflict guard text mirror is stale for ${edit.file}`);

    for (const activeState of this.active.values()) {
      const change = activeState.changeSet.files.get(edit.file);
      if (change) change.ranges = transformRanges(change.ranges, edit.ops);
    }
    for (const batch of state.batches.values()) batch.batch.ranges = transformRanges(batch.batch.ranges, edit.ops);
    this.emit({ type: "edit", edit });

    if (edit.origin.kind === "human") {
      const actorKey = actorKeyOf(edit.origin);
      let activeState = this.active.get(actorKey);
      let change = activeState?.changeSet.files.get(edit.file);
      const created = !activeState;
      if (!activeState) {
        activeState = { changeSet: { actor: { ...edit.origin }, files: new Map(), status: "editing" }, fileTimers: new Map() };
        this.active.set(actorKey, activeState);
      }
      activeState.changeSet.status = "editing";
      if (!change) {
        change = {
          file: edit.file,
          baseText: edit.textBefore,
          ranges: mergeRanges(rangesForOps(edit.ops)),
          firstTouchedAt: edit.at,
          lastTouchedAt: edit.at
        };
        activeState.changeSet.files.set(edit.file, change);
      } else {
        change.ranges = mergeRanges([...change.ranges, ...rangesForOps(edit.ops)]);
        change.lastTouchedAt = edit.at;
      }
      if (created) this.emit({ type: "change_set_opened", changeSet: snapshotChangeSet(activeState.changeSet) });
      this.resetActiveTimer(actorKey, edit.file);

      const existing = state.batches.get(actorKey);
      if (existing) {
        existing.batch.ranges = mergeRanges([...existing.batch.ranges, ...rangesForOps(edit.ops)]);
        existing.batch.endedAt = edit.at;
        existing.batch.textAfter = edit.textAfter;
        if (edit.ops.some((op) => op.deleted.length > 0)) existing.batch.deletionEdits = [...(existing.batch.deletionEdits ?? []), { file: edit.file, ops: edit.ops, textBefore: edit.textBefore, textAfter: edit.textAfter }];
        this.resetBatchTimers(edit.file, actorKey);
      } else {
        const batch: EditBatch = {
          id: this.createId(),
          actor: { ...edit.origin },
          file: edit.file,
          startedAt: edit.at,
          endedAt: edit.at,
          closeReason: "flush",
          ranges: mergeRanges(rangesForOps(edit.ops)),
          textBefore: edit.textBefore,
          textAfter: edit.textAfter,
          ...(edit.ops.some((op) => op.deleted.length > 0) ? { deletionEdits: [{ file: edit.file, ops: edit.ops, textBefore: edit.textBefore, textAfter: edit.textAfter }] } : {})
        };
        state.batches.set(actorKey, { batch });
        this.emit({ type: "batch_opened", batch: snapshotBatch(batch) });
        this.resetBatchTimers(edit.file, actorKey);
      }
    }
    state.text = edit.textAfter;
  }

  cursorChanged(cursor: CursorChange) {
    const actorKey = actorKeyOf(cursor.actor);
    this.latestCursors.set(cursor.actor.memberId, { ...cursor, actor: { ...cursor.actor } });
    for (const [file, state] of this.files) {
      if (file !== cursor.file && state.batches.has(actorKey)) this.closeBatch(file, actorKey, "cursor-left");
    }
    const state = this.files.get(cursor.file);
    const batch = state?.batches.get(actorKey);
    if (state && batch && this.cursorIsOutsideBatch(state.text, batch.batch.ranges, cursor.lineNumber)) {
      this.closeBatch(cursor.file, actorKey, "cursor-left");
    }
    this.emit({ type: "cursor", cursor });
  }

  markDone(actor: Extract<ActorRef, { kind: "human" }>) {
    const key = actorKeyOf(actor);
    for (const [file, state] of this.files) if (state.batches.has(key)) this.closeBatch(file, key, "flush");
    this.closeActive(key);
  }

  retireFile(file: string) {
    const state = this.files.get(file);
    if (!state) return;
    for (const key of state.batches.keys()) this.closeBatch(file, key, "file-retired");
    for (const [key, activeState] of this.active) if (activeState.changeSet.files.has(file)) this.removeActiveFile(key, file, "file-retired");
    this.files.delete(file);
  }

  releaseDocument(file: string) {
    const state = this.files.get(file);
    if (!state) return;
    for (const key of state.batches.keys()) this.closeBatch(file, key, "flush");
    this.files.delete(file);
  }

  flush() {
    for (const [file, state] of this.files) for (const key of state.batches.keys()) this.closeBatch(file, key, "flush");
    for (const key of this.active.keys()) this.closeActive(key);
  }

  getActiveChangeSets() {
    return [...this.active.values()].map(({ changeSet }) => snapshotChangeSet(changeSet));
  }

  getLatestCursors() {
    return [...this.latestCursors.values()].map((cursor) => ({ ...cursor, actor: { ...cursor.actor }, selection: cursor.selection ? { ...cursor.selection } : undefined }));
  }

  onEvent(listener: (event: ConflictGuardEvent) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private resetBatchTimers(file: string, key: string) {
    const state = this.files.get(file);
    const batch = state?.batches.get(key);
    if (!state || !batch) return;
    if (batch.idleTimer !== undefined) this.options.clock.clearTimeout(batch.idleTimer);
    batch.idleTimer = this.options.clock.setTimeout(() => this.closeBatch(file, key, "idle"), this.idleMs);
    if (batch.maxTimer === undefined) batch.maxTimer = this.options.clock.setTimeout(() => this.closeBatch(file, key, "max-duration"), this.maxBatchDurationMs);
  }

  private resetActiveTimer(key: string, file: string) {
    const activeState = this.active.get(key);
    if (!activeState) return;
    const old = activeState.fileTimers.get(file);
    if (old !== undefined) this.options.clock.clearTimeout(old);
    activeState.fileTimers.set(file, this.options.clock.setTimeout(() => this.removeActiveFile(key, file, "idle"), this.activeIdleMs));
  }

  private closeBatch(file: string, key: string, reason: BatchCloseReason) {
    const state = this.files.get(file);
    const current = state?.batches.get(key);
    if (!state || !current) return;
    if (current.idleTimer !== undefined) this.options.clock.clearTimeout(current.idleTimer);
    if (current.maxTimer !== undefined) this.options.clock.clearTimeout(current.maxTimer);
    state.batches.delete(key);
    const batch: EditBatch = { ...current.batch, endedAt: this.options.clock.now(), closeReason: reason, textAfter: state.text, ranges: current.batch.ranges.map((range) => ({ ...range })) };
    const activeState = this.active.get(key);
    const change = activeState?.changeSet.files.get(file);
    if (change && batch.deletionEdits?.length) {
      change.deletedSymbolKeys = [...new Set([...(change.deletedSymbolKeys ?? []), ...batch.deletionEdits.flatMap((deletion) => deletedSymbolKeys({ ...deletion, origin: batch.actor, at: batch.endedAt, revisionAfter: 0 }))])];
    }
    this.emit({ type: "batch_closed", batch });
    if (activeState && ![...this.files.values()].some((candidate) => [...candidate.batches.values()].some((item) => actorKeyOf(item.batch.actor) === key))) activeState.changeSet.status = "settled";
  }

  private removeActiveFile(key: string, file: string, reason: "idle" | "file-retired") {
    const activeState = this.active.get(key);
    if (!activeState || !activeState.changeSet.files.has(file)) return;
    const timer = activeState.fileTimers.get(file);
    if (timer !== undefined) this.options.clock.clearTimeout(timer);
    activeState.fileTimers.delete(file);
    if (activeState.changeSet.files.size === 1) {
      this.emit({ type: "change_set_file_closed", actor: activeState.changeSet.actor, file, reason });
      activeState.changeSet.status = "closed";
      this.active.delete(key);
      this.emit({ type: "change_set_closed", changeSet: snapshotChangeSet(activeState.changeSet) });
      return;
    }
    activeState.changeSet.files.delete(file);
    this.emit({ type: "change_set_file_closed", actor: activeState.changeSet.actor, file, reason });
  }

  private closeActive(key: string) {
    const activeState = this.active.get(key);
    if (!activeState) return;
    for (const timer of activeState.fileTimers.values()) this.options.clock.clearTimeout(timer);
    activeState.fileTimers.clear();
    activeState.changeSet.status = "closed";
    this.active.delete(key);
    this.emit({ type: "change_set_closed", changeSet: snapshotChangeSet(activeState.changeSet) });
  }

  private cursorIsOutsideBatch(text: string, ranges: TrackedRange[], cursorLine: number) {
    if (ranges.length === 0) return false;
    const lines = ranges.map((range) => ({ start: lineNumberAt(text, range.start), end: lineNumberAt(text, range.end) }));
    const min = Math.min(...lines.map((range) => range.start));
    const max = Math.max(...lines.map((range) => range.end));
    return cursorLine < min ? min - cursorLine > this.cursorLeaveLines : cursorLine > max ? cursorLine - max > this.cursorLeaveLines : false;
  }

  private emit(event: ConflictGuardEvent) {
    for (const listener of this.listeners) listener(event);
  }
}

function actorKeyOf(actor: ActorRef) {
  if (actor.kind === "human") return `human:${actor.memberId}`;
  if (actor.kind === "agent") return `agent:${actor.runId}`;
  if (actor.kind === "unknown") return "unknown";
  return "filesystem";
}

function rangesForOps(ops: TextEdit["ops"]): TrackedRange[] {
  let offset = 0;
  return ops.map((op) => {
    const start = op.from + offset;
    offset += op.inserted.length - op.deleted.length;
    return { start, end: start + op.inserted.length };
  });
}

function lineNumberAt(text: string, position: number) {
  return text.slice(0, Math.max(0, Math.min(position, text.length))).split("\n").length;
}

function snapshotBatch(batch: EditBatch): EditBatch {
  return { ...batch, actor: { ...batch.actor }, ranges: batch.ranges.map((range) => ({ ...range })) };
}

function snapshotChangeSet(changeSet: ActiveChangeSet): ActiveChangeSet {
  return {
    actor: { ...changeSet.actor },
    status: changeSet.status,
    files: new Map([...changeSet.files].map(([file, change]) => [file, { ...change, ranges: change.ranges.map((range) => ({ ...range })) }]))
  };
}
