import { createHash } from "node:crypto";
import type { ConflictGuardEvent, TextEditOp } from "../model/types.js";

export interface TraceEvent {
  schema: 1;
  seq: number;
  at: number;
  type: string;
  [key: string]: unknown;
}

export function readTrace(lines: string | string[]) {
  const source = Array.isArray(lines) ? lines : lines.split("\n");
  return source.filter((line) => line.trim().length > 0).map((line) => JSON.parse(line) as TraceEvent);
}

export function validateTrace(events: TraceEvent[]) {
  if (events.length === 0) throw new Error("Trace is empty");
  let expectedSequence = 1;
  let hasSession = false;
  const texts = new Map<string, string>();
  const retired = new Set<string>();
  const openBatches = new Set<string>();
  const openChangeSets = new Set<string>();
  for (const event of events) {
    if (event.schema !== 1) throw new Error("Unsupported trace schema");
    if (event.seq !== expectedSequence++) throw new Error("Trace sequence is not contiguous");
    if (!Number.isFinite(event.at)) throw new Error("Trace timestamp is invalid");
    if (event.type === "session_start") {
      hasSession = true;
      continue;
    }
    if (event.type === "doc_open") {
      if (typeof event.file !== "string" || typeof event.text !== "string" || typeof event.textHash !== "string") throw new Error("doc_open is incomplete");
      if (hashText(event.text) !== event.textHash) throw new Error("doc_open text hash does not match");
      texts.set(event.file, event.text);
      retired.delete(event.file);
      continue;
    }
    if (event.type === "doc_retired") {
      if (typeof event.file !== "string" || !texts.has(event.file)) throw new Error("doc_retired has no document");
      retired.add(event.file);
      continue;
    }
    if (event.type === "mirror_resync") {
      if (typeof event.file !== "string" || typeof event.previousTextHash !== "string" || typeof event.textHash !== "string") throw new Error("mirror_resync is incomplete");
      const text = texts.get(event.file);
      if (text === undefined || hashText(text) !== event.previousTextHash) throw new Error("mirror_resync previous text does not match");
      throw new Error("mirror_resync cannot be replayed without replacement text");
      continue;
    }
    if (event.type === "edit") {
      const file = event.file;
      if (typeof file !== "string" || retired.has(file) || !Array.isArray(event.ops)) throw new Error("edit has no active document state");
      const current = texts.get(file);
      if (current === undefined) throw new Error("edit has no document state");
      texts.set(file, applyOps(current, event.ops as TextEditOp[]));
      continue;
    }
    if (event.type === "batch_opened") {
      if (typeof event.id !== "string" || typeof event.file !== "string" || openBatches.has(event.id)) throw new Error("batch_opened is incomplete");
      openBatches.add(event.id);
      continue;
    }
    if (event.type === "batch_closed") {
      if (typeof event.id !== "string" || !openBatches.delete(event.id) || typeof event.file !== "string" || typeof event.textAfterHash !== "string") throw new Error("batch_closed is incomplete");
      const text = texts.get(event.file);
      if (text === undefined || hashText(text) !== event.textAfterHash) throw new Error("batch_closed text hash does not match replayed document");
      continue;
    }
    if (event.type === "change_set_opened") {
      if (!event.actor || !Array.isArray(event.files)) throw new Error("change_set_opened is incomplete");
      const key = actorKey(event.actor);
      if (openChangeSets.has(key)) throw new Error("change_set_opened is duplicated");
      openChangeSets.add(key);
      continue;
    }
    if (event.type === "change_set_closed") {
      if (!event.actor || !Array.isArray(event.files) || !openChangeSets.delete(actorKey(event.actor))) throw new Error("change_set_closed is incomplete");
      continue;
    }
    if (event.type === "cursor") {
      if (typeof event.memberId !== "string" || typeof event.file !== "string" || !event.position) throw new Error("cursor is incomplete");
      continue;
    }
    throw new Error(`Unknown trace event type: ${event.type}`);
  }
  if (!hasSession) throw new Error("Trace has no session_start");
  if (openBatches.size > 0) throw new Error("Trace has unclosed batches");
  return true;
}

export function traceEventFromConflictEvent(event: ConflictGuardEvent, sensitiveValues: string[] = []): Record<string, unknown> {
  if (event.type === "edit") return { type: "edit", at: event.edit.at, file: event.edit.file, origin: redact(event.edit.origin, sensitiveValues), ops: redact(event.edit.ops, sensitiveValues), revisionAfter: event.edit.revisionAfter };
  if (event.type === "cursor") return { type: "cursor", at: event.cursor.at, memberId: event.cursor.actor.memberId, file: event.cursor.file, position: { lineNumber: event.cursor.lineNumber, column: event.cursor.column }, selection: event.cursor.selection };
  if (event.type === "batch_closed") return { type: "batch_closed", id: event.batch.id, actor: event.batch.actor, file: event.batch.file, startedAt: event.batch.startedAt, endedAt: event.batch.endedAt, closeReason: event.batch.closeReason, ranges: event.batch.ranges, textBeforeHash: hashText(redact(event.batch.textBefore, sensitiveValues) as string), textAfterHash: hashText(redact(event.batch.textAfter, sensitiveValues) as string) };
  if (event.type === "batch_opened") return { type: "batch_opened", id: event.batch.id, actor: event.batch.actor, file: event.batch.file, startedAt: event.batch.startedAt, ranges: event.batch.ranges };
  const files = [...event.changeSet.files.values()].map((file) => ({ file: file.file, ranges: file.ranges, firstTouchedAt: file.firstTouchedAt, lastTouchedAt: file.lastTouchedAt }));
  return { type: event.type, actor: event.changeSet.actor, files };
}

function applyOps(text: string, ops: TextEditOp[]) {
  let result = text;
  let offset = 0;
  for (const op of ops) {
    if (!Number.isInteger(op.from) || op.from < 0 || typeof op.deleted !== "string" || typeof op.inserted !== "string") throw new Error("Trace edit operation is invalid");
    const from = op.from + offset;
    if (result.slice(from, from + op.deleted.length) !== op.deleted) throw new Error("Trace edit does not match document text");
    result = result.slice(0, from) + op.inserted + result.slice(from + op.deleted.length);
    offset += op.inserted.length - op.deleted.length;
  }
  return result;
}

function actorKey(actor: unknown) {
  if (!actor || typeof actor !== "object") throw new Error("Trace actor is invalid");
  const value = actor as Record<string, unknown>;
  if (value.kind === "human" && typeof value.memberId === "string") return `human:${value.memberId}`;
  if (value.kind === "agent" && typeof value.runId === "string") return `agent:${value.runId}`;
  if (value.kind === "filesystem") return "filesystem";
  if (value.kind === "unknown") return "unknown";
  throw new Error("Trace actor is invalid");
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

function hashText(text: string) { return createHash("sha256").update(text).digest("hex"); }
