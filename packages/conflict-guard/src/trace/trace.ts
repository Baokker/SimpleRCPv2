import { createHash } from "node:crypto";
import type { ConflictGuardEvent, TextEditOp } from "../model/types.js";

export interface TraceEvent {
  schema: 1 | 2 | 3;
  seq: number;
  at: number;
  type: string;
  [key: string]: unknown;
}

export interface TraceValidationResult {
  valid: true;
  redactedFiles: string[];
  skippedFiles: string[];
}

export function readTrace(lines: string | string[]) {
  const source = Array.isArray(lines) ? lines : lines.split("\n");
  return source.filter((line) => line.trim().length > 0).map((line) => JSON.parse(line) as TraceEvent);
}

export function validateTrace(events: TraceEvent[]) {
  validateTraceDetailed(events);
  return true;
}

export function validateTraceDetailed(events: TraceEvent[]): TraceValidationResult {
  if (events.length === 0) throw new Error("Trace is empty");
  let expectedSequence = 1;
  let hasSession = false;
  const texts = new Map<string, string>();
  const retired = new Set<string>();
  const openBatches = new Set<string>();
  const openChangeSets = new Set<string>();
  const redactedFiles = new Set<string>();
  const skippedFiles = new Set<string>();
  const closedBatches = new Set<string>();
  const candidatePairs = new Set<string>();
  for (const event of events) {
    if (event.schema !== 1 && event.schema !== 2 && event.schema !== 3) throw new Error("Unsupported trace schema");
    if (event.seq !== expectedSequence++) throw new Error("Trace sequence is not contiguous");
    if (!Number.isFinite(event.at)) throw new Error("Trace timestamp is invalid");
    if (event.type === "session_start") {
      hasSession = true;
      candidatePairs.clear();
      continue;
    }
    if (!hasSession) throw new Error("Trace has no session_start");
    if (event.redacted && typeof event.file === "string") redactedFiles.add(event.file);
    if (event.type === "doc_open") {
      if (event.skipped === "sensitive") {
        if (typeof event.file !== "string") throw new Error("doc_open is incomplete");
        skippedFiles.add(event.file);
        continue;
      }
      if (typeof event.file !== "string" || typeof event.text !== "string" || typeof event.textHash !== "string") throw new Error("doc_open is incomplete");
      if (!event.redacted && hashText(event.text) !== event.textHash) throw new Error("doc_open text hash does not match");
      if (event.redacted) redactedFiles.add(event.file);
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
      if (typeof event.file !== "string" || typeof event.previousTextHash !== "string" || typeof event.textHash !== "string" || typeof event.text !== "string") throw new Error("mirror_resync is incomplete");
      const text = texts.get(event.file);
      if (text === undefined || (!redactedFiles.has(event.file) && hashText(text) !== event.previousTextHash)) throw new Error("mirror_resync previous text does not match");
      if (event.redacted) redactedFiles.add(event.file);
      if (!event.redacted && hashText(event.text) !== event.textHash) throw new Error("mirror_resync text hash does not match");
      texts.set(event.file, event.text);
      continue;
    }
    if (event.type === "edit") {
      const file = event.file;
      if (typeof file !== "string" || retired.has(file) || !Array.isArray(event.ops)) throw new Error("edit has no active document state");
      const current = texts.get(file);
      if (current === undefined) throw new Error("edit has no document state");
      if (!redactedFiles.has(file) && !event.redacted) texts.set(file, applyOps(current, event.ops as TextEditOp[]));
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
      if (!redactedFiles.has(event.file) && !event.redacted && (text === undefined || hashText(text) !== event.textAfterHash)) throw new Error("batch_closed text hash does not match replayed document");
      closedBatches.add(event.id);
      continue;
    }
    if (event.type === "change_unit") {
      if (event.schema < 2 || !event.actor || typeof event.batchId !== "string" || !closedBatches.has(event.batchId) || !Array.isArray(event.symbols)) throw new Error("change_unit 字段不完整");
      actorKey(event.actor);
      for (const symbol of event.symbols as Array<Record<string, unknown>>) {
        if (typeof symbol.key !== "string" || typeof symbol.file !== "string" || !["modified", "added", "deleted"].includes(String(symbol.status))
          || typeof symbol.beforeHash !== "string" || !/^[a-f0-9]{64}$/.test(symbol.beforeHash) || typeof symbol.afterHash !== "string" || !/^[a-f0-9]{64}$/.test(symbol.afterHash)) throw new Error("change_unit 符号字段不完整");
      }
      continue;
    }
    if (["pair_candidate_opened", "pair_candidate_updated", "pair_candidate_closed"].includes(event.type)) {
      const pair = event.pair as { id?: string; left?: { actor?: unknown; symbol?: string }; right?: { actor?: unknown; symbol?: string }; distance?: number; path?: { hops?: unknown[] } | null } | undefined;
      if (event.schema < 2 || !pair?.id || !pair.left?.symbol || !pair.right?.symbol || ![0, 1, 2].includes(pair.distance ?? -1)) throw new Error("候选对字段不完整");
      if (actorKey(pair.left.actor) === actorKey(pair.right.actor)) throw new Error("候选对两侧参与者相同");
      if (pair.distance === 0
        ? pair.path !== null || (pair.left.symbol !== pair.right.symbol && !isNestedSymbolPair(pair.left.symbol, pair.right.symbol))
        : pair.path?.hops?.length !== pair.distance) throw new Error("候选对路径无效");
      if (event.type === "pair_candidate_opened") {
        if (candidatePairs.has(pair.id)) throw new Error("候选对已经打开");
        candidatePairs.add(pair.id);
      } else if (!candidatePairs.has(pair.id)) throw new Error("候选对尚未打开");
      if (event.type === "pair_candidate_closed") candidatePairs.delete(pair.id);
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
    if (event.type === "change_set_file_closed") {
      if (!event.actor || typeof event.file !== "string") throw new Error("change_set_file_closed is incomplete");
      continue;
    }
    if (event.type === "cursor") {
      if (typeof event.memberId !== "string" || typeof event.file !== "string" || !event.position) throw new Error("cursor is incomplete");
      continue;
    }
    if (["pair_judged", "pair_stale", "pair_resolved", "pair_closed", "pair_analyzing", "pair_analysis_progress"].includes(event.type)) {
      if (typeof event.pairId !== "string" || !Number.isInteger(event.revision) || !event.pair) throw new Error("pair coordination event is incomplete");
      if (event.type === "pair_judged") {
        const verdict = event.verdict as { zone?: string; decision?: string; ruleId?: string } | undefined;
        if (!verdict || !["white", "black", "grey"].includes(verdict.zone ?? "") || !["allow", "warn", "lock"].includes(verdict.decision ?? "") || typeof verdict.ruleId !== "string") throw new Error("pair_judged verdict is incomplete");
      }
      continue;
    }
    if (event.type === "provider_subscription") {
      if (!["fast", "deep"].includes(String(event.role)) || !["success", "timeout", "failed", "invalid-format", "cancelled", "cache-hit"].includes(String(event.status))
        || !Number.isInteger(event.occurrence) || Number(event.occurrence) < 1 || typeof event.adapter !== "string" || typeof event.model !== "string" || typeof event.promptVersion !== "string"
        || typeof event.inputHash !== "string" || !/^[a-f0-9]{64}$/.test(event.inputHash) || typeof event.cacheKey !== "string" || !/^[a-f0-9]{64}$/.test(event.cacheKey)
        || !Number.isFinite(event.latencyMs) || Number(event.latencyMs) < 0 || !Number.isFinite(event.budgetMs) || Number(event.budgetMs) <= 0) throw new Error("provider_subscription 字段不完整");
      continue;
    }
    if (["freeze_violation", "freeze", "persist", "persist_gate", "persist_conflict", "persist_error", "ui_action", "t0_warning", "provider_call"].includes(event.type)) continue;
    if (event.type === "t3_incomplete") {
      const actor = event.actor as { kind?: string; runId?: string } | undefined;
      if (actor?.kind !== "agent" || typeof actor.runId !== "string" || !Array.isArray(event.files) || !event.files.length || event.files.some((entry) => !entry || typeof entry !== "object" || typeof entry.reason !== "string" || (entry.file !== undefined && typeof entry.file !== "string"))) throw new Error("t3_incomplete is incomplete");
      continue;
    }
    if (["agent_run_started", "agent_write_attributed", "agent_guard_error", "t2_judged", "t2_rejected", "t2_shadow", "t3_shadow", "t3_revert"].includes(event.type)) continue;
    if (["intent_created", "intent_updated", "intent_closed"].includes(event.type)) {
      const intent = event.intent as Record<string, unknown> | undefined;
      if (!intent || !intent.actor || typeof intent.owner !== "string" || typeof intent.task !== "string" || !Array.isArray(intent.plannedScope) || !Array.isArray(intent.actualScope) || !Number.isInteger(intent.taskRevision) || !["planning", "running", "waiting", "blocked", "done", "reverted"].includes(String(intent.status))) throw new Error("intent event is incomplete");
      actorKey(intent.actor);
      continue;
    }
    if (event.type === "intent_injected") {
      if (!event.actor || typeof event.inputHash !== "string" || !/^[a-f0-9]{64}$/.test(event.inputHash) || !Number.isInteger(event.count) || Number(event.count) < 0 || Number(event.count) > 5) throw new Error("intent_injected is incomplete");
      actorKey(event.actor);
      continue;
    }
    if (event.type === "project_snapshot") {
      if (!event.files || typeof event.files !== "object" || Array.isArray(event.files) || Object.values(event.files).some((value) => typeof value !== "string")) throw new Error("project_snapshot is incomplete");
      continue;
    }
    if (event.type === "candidate_summary") {
      const statistics = event.statistics as Record<string, unknown> | undefined;
      if (!statistics || ["total", "related", "unrelated", "typeOnly"].some((key) => !Number.isInteger(statistics[key]) || Number(statistics[key]) < 0) || Number(statistics.total) !== Number(statistics.related) + Number(statistics.unrelated)) throw new Error("candidate_summary 字段不完整");
      continue;
    }
    if (event.type === "agent_proposal" || event.type === "agent_review") {
      if (!event.actor || event.type === "agent_proposal" && typeof event.requestId !== "string" || !Array.isArray(event.proposals) || event.proposals.some((proposal) => !proposal || typeof proposal.file !== "string" || typeof proposal.before !== "string" || typeof proposal.after !== "string")) throw new Error("Agent proposal is incomplete");
      actorKey(event.actor);
      continue;
    }
    if (["arbitration_opened", "arbitration_updated", "arbitration_resolved", "arbitration_chat"].includes(event.type)) {
      const card = event.card as Record<string, unknown> | undefined;
      if (!card || typeof card.id !== "string" || !Array.isArray(card.owners) || !Array.isArray(card.intents) || !["waiting", "accepted", "yielded", "timeout", "closed"].includes(String(card.status))) throw new Error("arbitration card is incomplete");
      continue;
    }
    if (["arbitration_action", "arbitration_retry", "arbitration_continuation", "arbitration_error", "arbitration_suggestion_error", "interruption", "agent_notice"].includes(event.type)) continue;
    if (event.type.startsWith("opencode.") || ["run_cancel_requested", "run_cancelled", "run_interrupted", "run_completed", "run_failed", "runtime_cancel_error", "session_diff_observed", "listener_error", "unattributed_change"].includes(event.type)) continue;
    throw new Error(`Unknown trace event type: ${event.type}`);
  }
  if (!hasSession) throw new Error("Trace has no session_start");
  if (openBatches.size > 0) throw new Error("Trace has unclosed batches");
  return { valid: true, redactedFiles: [...redactedFiles], skippedFiles: [...skippedFiles] };
}

export function traceEventFromConflictEvent(event: ConflictGuardEvent, sensitiveValues: string[] = [], redacted = false): Record<string, unknown> {
  if (event.type === "edit") return { type: "edit", at: event.edit.at, file: event.edit.file, origin: redact(event.edit.origin, sensitiveValues), ops: redact(event.edit.ops, sensitiveValues), revisionAfter: event.edit.revisionAfter, ...(redacted ? { redacted: true } : {}) };
  if (event.type === "cursor") return { type: "cursor", at: event.cursor.at, memberId: event.cursor.actor.memberId, file: event.cursor.file, position: { lineNumber: event.cursor.lineNumber, column: event.cursor.column }, selection: event.cursor.selection };
  if (event.type === "batch_closed") return { type: "batch_closed", at: event.batch.endedAt, id: event.batch.id, actor: event.batch.actor, file: event.batch.file, startedAt: event.batch.startedAt, endedAt: event.batch.endedAt, closeReason: event.batch.closeReason, ranges: event.batch.ranges, textBeforeHash: hashText(redact(event.batch.textBefore, sensitiveValues) as string), textAfterHash: hashText(redact(event.batch.textAfter, sensitiveValues) as string), ...(redacted ? { redacted: true } : {}) };
  if (event.type === "batch_opened") return { type: "batch_opened", id: event.batch.id, actor: event.batch.actor, file: event.batch.file, startedAt: event.batch.startedAt, ranges: event.batch.ranges, ...(redacted ? { redacted: true } : {}) };
  if (event.type === "change_set_file_closed") return { type: "change_set_file_closed", actor: event.actor, file: event.file, reason: event.reason };
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
  if (value.kind === "guard-revert" && typeof value.memberId === "string") return `guard-revert:${value.memberId}`;
  if (value.kind === "unknown") return "unknown";
  throw new Error("Trace actor is invalid");
}

function isNestedSymbolPair(left: string, right: string) {
  const [leftFile, leftPath] = left.split("#");
  const [rightFile, rightPath] = right.split("#");
  if (!leftFile || leftFile !== rightFile || !leftPath || !rightPath) return false;
  return leftPath.startsWith(`${rightPath}.`) || rightPath.startsWith(`${leftPath}.`);
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

function hashText(text: string) { return createHash("sha256").update(text).digest("hex"); }
