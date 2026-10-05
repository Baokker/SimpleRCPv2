import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import diff from "fast-diff";
import type * as Y from "yjs";
import {
  ConflictGuardTracker,
  type ConflictGuardClock,
  type ConflictGuardEvent,
  type CursorChange,
  type TextEditOp,
  traceEventFromConflictEvent,
  readTrace,
  createSemanticIndex,
  SemanticChangeTracker,
  type EditBatch,
  type FileChange,
  type ActorRef
} from "@simplercp/conflict-guard";
import { FILESYSTEM_ORIGIN } from "../textDelta.js";
import { createWorkspaceSemanticFiles } from "./semanticFiles.js";

export interface ProjectConflictGuardConfig {
  mode: "off" | "observe" | "rules" | "full";
  idleMs: number;
  cursorLeaveLines: number;
  maxBatchDurationMs: number;
  activeIdleMs: number;
  cursorDebounceMs: number;
}

interface ConnectionIdentity {
  projectId: string;
  memberId: string;
  connectedAt: number;
}

export function createProjectConflictGuard(options: {
  projectId: string;
  metadataPath: string;
  workspacePath: string;
  config: ProjectConflictGuardConfig;
  gitCommit?: string;
  sensitiveValues?: string[];
  getRevision(file: string): number;
}) {
  if (options.config.mode === "off") return undefined;
  const clock: ConflictGuardClock = {
    now: () => Date.now(),
    setTimeout: (callback, delay) => setTimeout(callback, delay),
    clearTimeout: (handle) => clearTimeout(handle as NodeJS.Timeout)
  };
  const tracker = new ConflictGuardTracker({
    clock,
    idleMs: options.config.idleMs,
    cursorLeaveLines: options.config.cursorLeaveLines,
    maxBatchDurationMs: options.config.maxBatchDurationMs,
    activeIdleMs: options.config.activeIdleMs
  });
  const connections = new Map<object, ConnectionIdentity>();
  const mirrors = new Map<string, { text: string; version: number; stop: () => void }>();
  let mirrorVersion = 0;
  const semanticFiles = createWorkspaceSemanticFiles(options.workspacePath, (file) => mirrors.get(file));
  const semanticIndex = createSemanticIndex({ files: semanticFiles, now: () => performance.now() });
  let latestUpdate: ReturnType<typeof semanticIndex.update> = { files: 0, durationMs: 0, full: true };
  let indexing = true;
  let degraded = false;
  let degradedReason: string | undefined;
  let stateVersion = 1;
  let semanticTimer: NodeJS.Timeout | undefined;
  const changedFiles = new Set<string>();
  const closedBatches: Array<{ batch: EditBatch; change?: FileChange }> = [];
  const semantic = new SemanticChangeTracker({ index: semanticIndex, now: clock.now, readFile: semanticFiles.readFile });
  let unknownOriginWarned = false;
  const pendingCursors = new Map<string, { event: ConflictGuardEvent; timer: NodeJS.Timeout }>();
  const tracePath = path.join(options.metadataPath, "conflict-guard", "trace.jsonl");
  let traceSequence = 0;
  let traceWriteFailures = 0;
  let traceOperations: Promise<void> = Promise.resolve();
  const redactedFiles = new Set<string>();

  function markDegraded(error: unknown) {
    degraded = true;
    degradedReason = error instanceof Error ? error.message : String(error);
    console.error("Conflict guard entered degraded state", error);
    stateVersion += 1;
  }

  async function initializeTraceSequence() {
    try {
      await fs.mkdir(path.dirname(tracePath), { recursive: true });
      await fs.appendFile(tracePath, "", "utf8");
      const source = await fs.readFile(tracePath, "utf8");
      const events = readTrace(source);
      for (const event of events) if (event.redacted && typeof event.file === "string") redactedFiles.add(event.file);
      const last = events.at(-1);
      if (!last) return;
      if (typeof last.seq !== "number" || !Number.isInteger(last.seq) || last.seq < 1) throw new Error("Conflict guard trace sequence is invalid");
      traceSequence = last.seq;
    } catch (error) {
      traceWriteFailures += 1;
      markDegraded(error);
    }
  }

  const appendTrace = (event: Record<string, unknown>) => {
    traceOperations = traceOperations.catch(() => undefined).then(async () => {
      const clean = redact(event, options.sensitiveValues ?? []) as Record<string, unknown>;
      if (typeof clean.file === "string" && redactedFiles.has(clean.file)) clean.redacted = true;
      const seq = traceSequence + 1;
      const record = { schema: 2, seq, at: clock.now(), ...clean };
      await fs.mkdir(path.dirname(tracePath), { recursive: true });
      await fs.appendFile(tracePath, `${JSON.stringify(record)}\n`, "utf8");
      traceSequence = seq;
    }).catch((error) => {
      traceWriteFailures += 1;
      console.error("Conflict guard trace write failed", error);
      markDegraded(error);
    });
    return traceOperations;
  };

  traceOperations = initializeTraceSequence().then(() => undefined).catch((error) => {
    traceWriteFailures += 1;
    console.error("Conflict guard trace initialization failed", error);
    markDegraded(error);
  });

  void appendTrace({
    type: "session_start",
    mode: options.config.mode,
    config: {
      idleMs: options.config.idleMs,
      cursorLeaveLines: options.config.cursorLeaveLines,
      maxBatchDurationMs: options.config.maxBatchDurationMs,
      activeIdleMs: options.config.activeIdleMs,
      cursorDebounceMs: options.config.cursorDebounceMs
    },
    gitCommit: options.gitCommit
  });

  const removeSemanticListener = semantic.onEvent((event) => { void appendTrace({ ...event }); });

  function scheduleSemanticUpdate(file?: string) {
    if (file) changedFiles.add(file);
    if (semanticTimer !== undefined) return;
    semanticTimer = setTimeout(() => {
      try {
        updateSemantic();
      } catch (error) {
        markDegraded(error);
      }
    }, 25);
  }

  function updateSemantic() {
    if (semanticTimer !== undefined) clearTimeout(semanticTimer);
    semanticTimer = undefined;
    if (indexing) return;
    const files = [...changedFiles];
    changedFiles.clear();
    if (files.length > 0) {
      semantic.captureStaleEdges(tracker.getActiveChangeSets());
      latestUpdate = semanticIndex.update(files);
    }
    const existingFiles = new Set(semanticFiles.listFiles());
    semantic.update(tracker.getActiveChangeSets(), closedBatches.splice(0).filter(({ batch }) => existingFiles.has(batch.file)));
    stateVersion += 1;
  }

  queueMicrotask(() => {
    try {
      latestUpdate = semanticIndex.update();
      indexing = false;
      updateSemantic();
      stateVersion += 1;
    } catch (error) {
      indexing = false;
      markDegraded(error);
    }
  });

  const removeTrackerListener = tracker.onEvent((event) => {
    try {
    if (event.type === "batch_closed") {
      const change = tracker.getActiveChangeSets().find((set) => set.actor.kind === "human" && event.batch.actor.kind === "human" && set.actor.memberId === event.batch.actor.memberId)?.files.get(event.batch.file);
      closedBatches.push({ batch: event.batch, change });
      scheduleSemanticUpdate(event.batch.file);
    }
    if (event.type === "change_set_closed" || event.type === "change_set_file_closed") scheduleSemanticUpdate();
    if (event.type === "cursor") {
      const memberId = event.cursor.actor.memberId;
      const pending = pendingCursors.get(memberId);
      if (pending) {
        pending.event = event;
        return;
      }
      const timer = setTimeout(() => {
        try {
          const latest = pendingCursors.get(memberId);
          pendingCursors.delete(memberId);
          if (latest) void appendTrace(traceEvent(latest.event));
        } catch (error) {
          markDegraded(error);
        }
      }, options.config.cursorDebounceMs);
      pendingCursors.set(memberId, { event, timer });
      return;
    }
    flushPendingCursors();
    void appendTrace(traceEvent(event));
    } catch (error) {
      markDegraded(error);
    }
  });

  function traceEvent(event: ConflictGuardEvent) {
    const file = event.type === "edit" || event.type === "cursor" || event.type === "batch_opened" || event.type === "batch_closed"
      ? event.type === "cursor" ? event.cursor.file : event.type === "edit" ? event.edit.file : event.batch.file
      : event.type === "change_set_file_closed" ? event.file : undefined;
    const record = traceEventFromConflictEvent(event, file && redactedFiles.has(file) ? [] : options.sensitiveValues ?? [], file ? redactedFiles.has(file) : false);
    if (file && redactedFiles.has(file)) maskTraceRecord(record);
    if (file && redactedFiles.has(file)) record.redacted = true;
    return record;
  }

  function flushPendingCursors() {
    for (const [memberId, pending] of pendingCursors) {
      clearTimeout(pending.timer);
      pendingCursors.delete(memberId);
      try {
        void appendTrace(traceEvent(pending.event));
      } catch (error) {
        markDegraded(error);
      }
    }
  }

  function documentPrepared(name: string, document: Y.Doc, file: string) {
    try {
    if (mirrors.has(file)) return;
    if (isSensitiveFile(file)) {
      void appendTrace({ type: "doc_open", file, skipped: "sensitive" });
      return;
    }
    const text = document.getText("content");
    const initial = text.toString();
    tracker.openDocument(file, initial);
    const safeInitial = redactText(initial, options.sensitiveValues ?? []);
    if (safeInitial.changed) redactedFiles.add(file);
    void appendTrace({ type: "doc_open", file, textHash: hashText(safeInitial.value), text: safeInitial.value, ...(redactedFiles.has(file) ? { redacted: true } : {}) });
    const observer = (event: Y.YTextEvent) => {
      try {
      const mirror = mirrors.get(file);
      if (!mirror) return;
      const before = mirror.text;
      const ops: TextEditOp[] = [];
      let from = 0;
      for (const delta of event.delta) {
        if (typeof delta.retain === "number") from += delta.retain;
        if (typeof delta.insert === "string") ops.push({ from, deleted: "", inserted: delta.insert });
        if (typeof delta.delete === "number") {
          ops.push({ from, deleted: before.slice(from, from + delta.delete), inserted: "" });
          from += delta.delete;
        }
      }
      const after = text.toString();
      const safeBefore = redactText(before, options.sensitiveValues ?? []);
      const safeAfter = redactText(after, options.sensitiveValues ?? []);
      if (safeBefore.changed || safeAfter.changed) redactedFiles.add(file);
      if (applyOps(before, ops) !== after) {
        const resyncOps = textDiffOps(before, after);
        if (resyncOps.length > 0) {
          tracker.edit({
            file,
            origin: { kind: "filesystem" },
            at: clock.now(),
            ops: resyncOps,
            revisionAfter: options.getRevision(file),
            textBefore: before,
            textAfter: after
          });
        }
        mirror.text = after;
        mirror.version = ++mirrorVersion;
        scheduleSemanticUpdate(file);
        void appendTrace({ type: "mirror_resync", file, previousTextHash: hashText(safeBefore.value), textHash: hashText(safeAfter.value), text: safeAfter.value, ...(redactedFiles.has(file) ? { redacted: true } : {}) });
        return;
      }
      const origin = actorForOrigin(event.transaction.origin);
      const revisionAfter = options.getRevision(file);
      tracker.edit({ file, origin, at: clock.now(), ops, revisionAfter, textBefore: before, textAfter: after });
      mirror.text = after;
      mirror.version = ++mirrorVersion;
      changedFiles.add(file);
      if (origin.kind === "filesystem") scheduleSemanticUpdate(file);
      } catch (error) {
        markDegraded(error);
      }
    };
    text.observe(observer);
    mirrors.set(file, { text: initial, version: ++mirrorVersion, stop: () => text.unobserve(observer) });
    scheduleSemanticUpdate(file);
    void name;
    } catch (error) {
      markDegraded(error);
    }
  }

  function actorForOrigin(origin: unknown): ActorRef {
    if (origin === FILESYSTEM_ORIGIN) return { kind: "filesystem" };
    if (origin && typeof origin === "object") {
      const identity = connections.get(origin);
      if (identity) return { kind: "human", memberId: identity.memberId };
    }
    if (!unknownOriginWarned) {
      unknownOriginWarned = true;
      console.warn("Conflict guard received an unknown Yjs transaction origin");
    }
    return { kind: "unknown" };
  }

  function registerConnection(socket: object, identity: ConnectionIdentity) { connections.set(socket, identity); }
  function unregisterConnection(socket: object) { connections.delete(socket); }

  function cursorChanged(input: { memberId: string; path: string; position: { lineNumber: number; column: number }; selection?: CursorChange["selection"]; at?: number }) {
    if (typeof input.path !== "string" || !input.position || !Number.isInteger(input.position.lineNumber) || !Number.isInteger(input.position.column) || input.position.lineNumber < 1 || input.position.column < 1) return;
    try {
      tracker.cursorChanged({ actor: { kind: "human", memberId: input.memberId }, file: input.path, lineNumber: input.position.lineNumber, column: input.position.column, selection: input.selection, at: input.at ?? clock.now() });
    } catch (error) {
      markDegraded(error);
    }
  }

  function retirePath(file: string) {
    try {
      for (const [name, mirror] of mirrors) {
        if (name === file || name.startsWith(`${file}/`)) {
          mirror.stop();
          mirrors.delete(name);
          tracker.retireFile(name);
          void appendTrace({ type: "doc_retired", file: name });
        }
      }
      scheduleSemanticUpdate(file);
    } catch (error) {
      markDegraded(error);
    }
  }

  function releaseDocument(file: string) {
    try {
      const mirror = mirrors.get(file);
      if (!mirror) return;
      mirror.stop();
      mirrors.delete(file);
      tracker.releaseDocument(file);
      scheduleSemanticUpdate(file);
    } catch (error) {
      markDegraded(error);
    }
  }

  function state() {
    const sets = semantic.getActiveChangeSets();
    return {
      version: stateVersion,
      indexing,
      degraded,
      ...(degradedReason ? { degradedReason } : {}),
      traceWriteFailures,
      index: { ...semanticIndex.stats(), latestUpdate },
      changeSets: tracker.getActiveChangeSets().map((changeSet) => ({ actor: changeSet.actor, status: changeSet.status, files: [...changeSet.files.values()].map((file) => ({ file: file.file, ranges: file.ranges, firstTouchedAt: file.firstTouchedAt, lastTouchedAt: file.lastTouchedAt })) })),
      activeSymbols: sets.map((set) => ({ actor: set.actor, symbols: [...set.files.values()].flatMap((file) => file.symbols ?? []).map(({ before: _before, after: _after, ...symbol }) => symbol) })),
      candidatePairs: semantic.getCandidatePairs(),
      statistics: semantic.statistics(),
      cursors: tracker.getLatestCursors().map((cursor) => {
        const text = mirrors.get(cursor.file)?.text;
        const lines = text?.split("\n");
        const start = lines ? lines.slice(0, cursor.lineNumber - 1).reduce((count, line) => count + line.length + 1, 0) + cursor.column - 1 : undefined;
        return { ...cursor, symbol: start === undefined ? null : semanticIndex.symbolsInRange(cursor.file, start, start)[0]?.key ?? null };
      })
    };
  }

  function symbol(key: string) {
    const file = key.slice(0, key.indexOf("#"));
    const info = file ? semanticIndex.symbolsInFile(file).find((symbol) => symbol.key === key) : undefined;
    const changes = semantic.getActiveChangeSets().flatMap((set) => [...set.files.values()].flatMap((file) => (file.symbols ?? []).filter((symbol) => symbol.key === key).map((change) => ({ actor: set.actor, ...change }))));
    if (!info && changes.length === 0) return undefined;
    return { symbol: info ?? null, text: info ? semanticFiles.readFile(info.file).slice(info.start, info.end) : "", changes, outgoing: semanticIndex.outgoing(key), incoming: semanticIndex.incoming(key) };
  }

  async function waitForTrace() {
    flushPendingCursors();
    await traceOperations;
  }

  async function exportTrace() {
    await waitForTrace();
    let source = "";
    try {
      source = await fs.readFile(tracePath, "utf8");
    } catch (error) {
      console.error("Conflict guard trace export read failed", error);
      return "";
    }
    return redactTraceForExport(source, options.sensitiveValues ?? []);
  }

  return {
    mode: options.config.mode,
    tracker,
    tracePath,
    semanticIndex,
    symbol,
    workspaceChanged: (file: string) => { if (!mirrors.has(file)) scheduleSemanticUpdate(file); },
    documentPrepared,
    registerConnection,
    unregisterConnection,
    cursorChanged,
    retirePath,
    releaseDocument,
    markDone: (memberId: string) => tracker.markDone({ kind: "human", memberId }),
    state,
    waitForTrace,
    exportTrace,
    dispose() {
      try {
        if (semanticTimer !== undefined) clearTimeout(semanticTimer);
        semanticTimer = undefined;
        flushPendingCursors();
        for (const pending of pendingCursors.values()) clearTimeout(pending.timer);
        pendingCursors.clear();
        tracker.flush();
        updateSemantic();
        removeSemanticListener();
        removeTrackerListener();
        for (const mirror of mirrors.values()) mirror.stop();
        mirrors.clear();
        connections.clear();
      } catch (error) {
        markDegraded(error);
      }
    }
  };
}

function redact(value: unknown, sensitiveValues: string[]): unknown {
  if (typeof value === "string") {
    let result = value;
    for (const sensitive of sensitiveValues.filter(Boolean).sort((left, right) => right.length - left.length)) result = result.split(sensitive).join("[REDACTED]");
    return result;
  }
  if (Array.isArray(value)) return value.map((entry) => redact(entry, sensitiveValues));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, redact(entry, sensitiveValues)]));
  return value;
}

function redactText(value: string, sensitiveValues: string[]) {
  const result = maskSensitiveText(value, sensitiveValues);
  return { value: result, changed: result !== value };
}

function maskSensitiveText(value: string, sensitiveValues: string[]) {
  let result = value;
  for (const sensitive of sensitiveValues.filter(Boolean).sort((left, right) => right.length - left.length)) {
    result = result.split(sensitive).join("•".repeat(sensitive.length));
  }
  return result;
}

function maskTraceRecord(record: Record<string, unknown>) {
  if (record.type === "edit" && Array.isArray(record.ops)) {
    record.ops = (record.ops as Array<Record<string, unknown>>).map((op) => ({
      ...op,
      deleted: typeof op.deleted === "string" ? "•".repeat(op.deleted.length) : op.deleted,
      inserted: typeof op.inserted === "string" ? "•".repeat(op.inserted.length) : op.inserted
    }));
  }
  if ((record.type === "doc_open" || record.type === "mirror_resync") && typeof record.text === "string") {
    record.text = "•".repeat(record.text.length);
  }
}

function isSensitiveFile(file: string) {
  return /(^|\/)\.env(?:\.[^/]*)?$/.test(file) || /\.(?:pem|key)$/i.test(file);
}

function applyOps(text: string, ops: TextEditOp[]) {
  let result = text;
  let offset = 0;
  for (const op of ops) {
    const from = op.from + offset;
    if (result.slice(from, from + op.deleted.length) !== op.deleted) throw new Error("Conflict guard edit does not match text mirror");
    result = result.slice(0, from) + op.inserted + result.slice(from + op.deleted.length);
    offset += op.inserted.length - op.deleted.length;
  }
  return result;
}

function textDiffOps(before: string, after: string): TextEditOp[] {
  const ops: TextEditOp[] = [];
  let from = 0;
  for (const [operation, value] of diff(before, after)) {
    if (operation === diff.EQUAL) {
      from += value.length;
    } else if (operation === diff.DELETE) {
      ops.push({ from, deleted: value, inserted: "" });
      from += value.length;
    } else {
      ops.push({ from, deleted: "", inserted: value });
    }
  }
  return ops;
}

function hashText(value: string) { return crypto.createHash("sha256").update(value).digest("hex"); }

function redactTraceForExport(source: string, sensitiveValues: string[]) {
  const events = readTrace(source) as Array<Record<string, unknown>>;
  const texts = new Map<string, string>();
  const redacted = new Set<string>();
  const eventIndexes = new Map<string, number[]>();
  const markRedacted = (file: string) => {
    if (redacted.has(file)) return;
    redacted.add(file);
    for (const index of eventIndexes.get(file) ?? []) {
      const event = events[index]!;
      event.redacted = true;
      maskTraceRecord(event);
    }
  };
  const remember = (file: string, index: number) => {
    const indexes = eventIndexes.get(file) ?? [];
    indexes.push(index);
    eventIndexes.set(file, indexes);
  };
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index]!;
    const file = typeof event.file === "string" ? event.file : undefined;
    if (file) remember(file, index);
    if (event.redacted && file) redacted.add(file);
    if (!file) continue;
    if (event.type === "doc_open" && typeof event.text === "string") {
      const text = event.text;
      texts.set(file, text);
      if (sensitiveValues.some((value) => value && text.includes(value))) markRedacted(file);
    } else if (event.type === "mirror_resync" && typeof event.text === "string") {
      const text = event.text;
      texts.set(file, text);
      if (sensitiveValues.some((value) => value && text.includes(value))) markRedacted(file);
    } else if (event.type === "edit" && Array.isArray(event.ops)) {
      const current = texts.get(file);
      if (current !== undefined && !redacted.has(file)) {
        try {
          const next = applyOps(current, event.ops as TextEditOp[]);
          texts.set(file, next);
          if (sensitiveValues.some((value) => value && next.includes(value))) markRedacted(file);
        } catch {
          markRedacted(file);
        }
      }
    }
    if (redacted.has(file)) {
      event.redacted = true;
      maskTraceRecord(event);
    }
  }
  return events.map((event) => JSON.stringify(event)).join("\n") + (events.length > 0 ? "\n" : "");
}

export type ProjectConflictGuard = NonNullable<ReturnType<typeof createProjectConflictGuard>>;
