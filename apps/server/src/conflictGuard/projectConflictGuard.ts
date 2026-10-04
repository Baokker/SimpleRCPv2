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
  const revisions = new Map<string, number>();
  const unknownOrigins = new WeakSet<object>();
  const pendingCursors = new Map<string, { event: ConflictGuardEvent; timer: NodeJS.Timeout }>();
  const tracePath = path.join(options.metadataPath, "conflict-guard", "trace.jsonl");
  let traceSequence = 0;
  let traceOperations: Promise<void> = initializeTraceSequence();

  async function initializeTraceSequence() {
    try {
      const source = await fs.readFile(tracePath, "utf8");
      const lines = source.split("\n").filter(Boolean);
      const last = lines.length > 0 ? JSON.parse(lines.at(-1)!) as { seq?: unknown } : undefined;
      if (last && typeof last.seq === "number" && Number.isInteger(last.seq) && last.seq > 0) traceSequence = last.seq;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") console.warn("Conflict guard trace initialization failed", error);
    }
  }

  const appendTrace = (event: Record<string, unknown>) => {
    traceOperations = traceOperations.then(async () => {
      const clean = redact(event, options.sensitiveValues ?? []) as Record<string, unknown>;
      const record = { schema: 1, seq: ++traceSequence, at: clock.now(), ...clean };
      await fs.mkdir(path.dirname(tracePath), { recursive: true });
      await fs.appendFile(tracePath, `${JSON.stringify(record)}\n`, "utf8");
    }).catch((error) => {
      console.warn("Conflict guard trace write failed", error);
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
      if (pending) clearTimeout(pending.timer);
      const timer = setTimeout(() => {
        pendingCursors.delete(memberId);
        void appendTrace(traceEvent(event));
      }, options.config.cursorDebounceMs);
      pendingCursors.set(memberId, { event, timer });
      return;
    }
    flushPendingCursors();
    void appendTrace(traceEvent(event));
  });

  function traceEvent(event: ConflictGuardEvent) {
    return traceEventFromConflictEvent(event, options.sensitiveValues ?? []);
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
    const text = document.getText("content");
    const initial = text.toString();
    tracker.openDocument(file, initial);
    revisions.set(file, 0);
    const safeInitial = redact(initial, options.sensitiveValues ?? []) as string;
    void appendTrace({ type: "doc_open", file, textHash: hashText(safeInitial), text: safeInitial });
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
      let projected: string;
      try {
        projected = applyOps(before, ops);
      } catch {
        projected = "";
      }
      if (projected !== after) {
        mirror.text = after;
        void appendTrace({ type: "mirror_resync", file, previousTextHash: hashText(redact(before, options.sensitiveValues ?? []) as string), textHash: hashText(redact(after, options.sensitiveValues ?? []) as string) });
        return;
      }
      const origin = actorForOrigin(event.transaction.origin);
      const revisionAfter = (revisions.get(file) ?? 0) + 1;
      revisions.set(file, revisionAfter);
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
      if (!unknownOrigins.has(origin)) {
        unknownOrigins.add(origin);
        console.warn("Conflict guard received an unknown Yjs transaction origin");
      }
    }
    return { kind: "unknown" };
  }

  function registerConnection(socket: object, identity: ConnectionIdentity) { connections.set(socket, identity); }
  function unregisterConnection(socket: object) { connections.delete(socket); }

  function cursorChanged(input: { memberId: string; path: string; position: { lineNumber: number; column: number }; selection?: CursorChange["selection"]; at?: number }) {
    tracker.cursorChanged({ actor: { kind: "human", memberId: input.memberId }, file: input.path, lineNumber: input.position.lineNumber, column: input.position.column, selection: input.selection, at: input.at ?? clock.now() });
  }

  function retirePath(file: string) {
    for (const [name, mirror] of mirrors) {
      if (name === file || name.startsWith(`${file}/`)) {
        mirror.stop();
        mirrors.delete(name);
        revisions.delete(name);
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
    revisions.delete(file);
    tracker.releaseDocument(file);
  }

  function state() {
    return tracker.getActiveChangeSets().map((changeSet) => ({ actor: changeSet.actor, status: changeSet.status, files: [...changeSet.files.values()].map((file) => ({ file: file.file, ranges: file.ranges, firstTouchedAt: file.firstTouchedAt, lastTouchedAt: file.lastTouchedAt })) }));
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
    return result.replace(/sk-[A-Za-z0-9_-]{16,}/g, "[REDACTED]");
  }
  if (Array.isArray(value)) return value.map((entry) => redact(entry, sensitiveValues));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, redact(entry, sensitiveValues)]));
  return value;
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
