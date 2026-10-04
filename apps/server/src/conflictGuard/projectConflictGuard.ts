import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type * as Y from "yjs";
import {
  ConflictGuardTracker,
  type ConflictGuardClock,
  type ConflictGuardEvent,
  type CursorChange,
  type TextEditOp,
  traceEventFromConflictEvent,
  readTrace,
  type ActorRef
} from "@simplercp/conflict-guard";
import { FILESYSTEM_ORIGIN } from "../textDelta.js";

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
  const mirrors = new Map<string, { text: string; stop: () => void }>();
  let unknownOriginWarned = false;
  const pendingCursors = new Map<string, { event: ConflictGuardEvent; timer: NodeJS.Timeout }>();
  const tracePath = path.join(options.metadataPath, "conflict-guard", "trace.jsonl");
  let traceSequence = 0;
  let traceOperations: Promise<void> = initializeTraceSequence();
  const redactedFiles = new Set<string>();

  async function initializeTraceSequence() {
    await fs.mkdir(path.dirname(tracePath), { recursive: true });
    await fs.appendFile(tracePath, "", "utf8");
    const source = await fs.readFile(tracePath, "utf8");
    const events = readTrace(source);
    for (const event of events) if (event.redacted && typeof event.file === "string") redactedFiles.add(event.file);
    const last = events.at(-1);
    if (!last) return;
    if (typeof last.seq !== "number" || !Number.isInteger(last.seq) || last.seq < 1) throw new Error("Conflict guard trace sequence is invalid");
    traceSequence = last.seq;
  }

  const appendTrace = (event: Record<string, unknown>) => {
    traceOperations = traceOperations.then(async () => {
      const clean = redact(event, options.sensitiveValues ?? []) as Record<string, unknown>;
      if (typeof clean.file === "string" && redactedFiles.has(clean.file)) clean.redacted = true;
      const record = { schema: 1, seq: ++traceSequence, at: clock.now(), ...clean };
      await fs.mkdir(path.dirname(tracePath), { recursive: true });
      await fs.appendFile(tracePath, `${JSON.stringify(record)}\n`, "utf8");
    });
    return traceOperations;
  };

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

  const removeTrackerListener = tracker.onEvent((event) => {
    if (event.type === "cursor") {
      const memberId = event.cursor.actor.memberId;
      const pending = pendingCursors.get(memberId);
      if (pending) {
        pending.event = event;
        return;
      }
      const timer = setTimeout(() => {
        const latest = pendingCursors.get(memberId);
        pendingCursors.delete(memberId);
        if (latest) void appendTrace(traceEvent(latest.event));
      }, options.config.cursorDebounceMs);
      pendingCursors.set(memberId, { event, timer });
      return;
    }
    flushPendingCursors();
    void appendTrace(traceEvent(event));
  });

  function traceEvent(event: ConflictGuardEvent) {
    const file = event.type === "edit" || event.type === "cursor" || event.type === "batch_opened" || event.type === "batch_closed"
      ? event.type === "cursor" ? event.cursor.file : event.type === "edit" ? event.edit.file : event.batch.file
      : event.type === "change_set_file_closed" ? event.file : undefined;
    const record = traceEventFromConflictEvent(event, options.sensitiveValues ?? [], file ? redactedFiles.has(file) : false);
    if (file && redactedFiles.has(file)) record.redacted = true;
    return record;
  }

  function flushPendingCursors() {
    for (const [memberId, pending] of pendingCursors) {
      clearTimeout(pending.timer);
      pendingCursors.delete(memberId);
      void appendTrace(traceEvent(pending.event));
    }
  }

  function documentPrepared(name: string, document: Y.Doc, file: string) {
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
        tracker.openDocument(file, after);
        mirror.text = after;
        void appendTrace({ type: "mirror_resync", file, previousTextHash: hashText(safeBefore.value), textHash: hashText(safeAfter.value), text: safeAfter.value, ...(redactedFiles.has(file) ? { redacted: true } : {}) });
        return;
      }
      const origin = actorForOrigin(event.transaction.origin);
      // Y.Text observer 在 document update 事件之前执行。
      const revisionAfter = options.getRevision(file) + (origin.kind === "filesystem" ? 0 : 1);
      tracker.edit({ file, origin, at: clock.now(), ops, revisionAfter, textBefore: before, textAfter: after });
      mirror.text = after;
    };
    text.observe(observer);
    mirrors.set(file, { text: initial, stop: () => text.unobserve(observer) });
    void name;
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
    tracker.cursorChanged({ actor: { kind: "human", memberId: input.memberId }, file: input.path, lineNumber: input.position.lineNumber, column: input.position.column, selection: input.selection, at: input.at ?? clock.now() });
  }

  function retirePath(file: string) {
    for (const [name, mirror] of mirrors) {
      if (name === file || name.startsWith(`${file}/`)) {
        mirror.stop();
        mirrors.delete(name);
        tracker.retireFile(name);
        void appendTrace({ type: "doc_retired", file: name });
      }
    }
  }

  function releaseDocument(file: string) {
    const mirror = mirrors.get(file);
    if (!mirror) return;
    mirror.stop();
    mirrors.delete(file);
    tracker.releaseDocument(file);
  }

  function state() {
    return {
      changeSets: tracker.getActiveChangeSets().map((changeSet) => ({ actor: changeSet.actor, status: changeSet.status, files: [...changeSet.files.values()].map((file) => ({ file: file.file, ranges: file.ranges, firstTouchedAt: file.firstTouchedAt, lastTouchedAt: file.lastTouchedAt })) })),
      cursors: tracker.getLatestCursors()
    };
  }

  async function waitForTrace() {
    flushPendingCursors();
    await traceOperations;
  }

  return {
    mode: options.config.mode,
    tracker,
    tracePath,
    documentPrepared,
    registerConnection,
    unregisterConnection,
    cursorChanged,
    retirePath,
    releaseDocument,
    markDone: (memberId: string) => tracker.markDone({ kind: "human", memberId }),
    state,
    waitForTrace,
    dispose() {
      flushPendingCursors();
      tracker.flush();
      removeTrackerListener();
      for (const mirror of mirrors.values()) mirror.stop();
      mirrors.clear();
      connections.clear();
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
  const result = redact(value, sensitiveValues) as string;
  return { value: result, changed: result !== value };
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

function hashText(value: string) { return crypto.createHash("sha256").update(value).digest("hex"); }

export type ProjectConflictGuard = NonNullable<ReturnType<typeof createProjectConflictGuard>>;
