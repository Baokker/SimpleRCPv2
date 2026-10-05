import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import diff from "fast-diff";
import { createRequire } from "node:module";
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
  type ActorRef,
  classify,
  createPairCoordinator,
  type PairCoordinator
} from "@simplercp/conflict-guard";
import { FILESYSTEM_ORIGIN } from "../textDelta.js";
import { createWorkspaceSemanticFiles } from "./semanticFiles.js";

const require = createRequire(import.meta.url);
const YRuntime = require("yjs") as typeof import("yjs");

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
  const mirrors = new Map<string, { text: string; version: number; stop: () => void; document: Y.Doc }>();
  const undoManagers = new Map<string, Y.UndoManager>();
  const undoBaselines = new Map<string, number>();
  const revertOrigins = new Map<Y.UndoManager, string>();
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
  const blockedPersists = new Map<string, string>();
  let persistBlockedCount = 0;
  let persistConflicts = 0;
  let uiActionCount = 0;
  const t0Warnings: Array<{ id: string; memberId: string; pairId: string; summary: string; at: number }> = [];
  const pairCoordinator: PairCoordinator = createPairCoordinator({ now: clock.now, classify: (pair) => {
    try {
      const sets = semantic.getActiveChangeSets();
      const find = (side: { actor: ActorRef; symbol: string }) => sets.find((set) => actorKey(set.actor) === actorKey(side.actor))?.files && [...(sets.find((set) => actorKey(set.actor) === actorKey(side.actor))?.files.values() ?? [])].flatMap((file) => file.symbols ?? []).find((symbol) => symbol.key === side.symbol);
      const left = find(pair.left);
      const right = find(pair.right);
      if (!left || !right) return { zone: "grey", decision: "warn", ruleId: "semantic-interaction-uncertain", summary: "修改可能互相影响，需要进一步判断。", evidence: [], contractChanged: { left: false, right: false } };
      return classify({ left: { actor: pair.left.actor, symbol: left }, right: { actor: pair.right.actor, symbol: right }, path: pair.path, nested: pair.distance === 0 && pair.left.symbol !== pair.right.symbol, typeOnly: Boolean(pair.path?.typeOnly), project: semanticIndex });
    } catch (error) {
      console.error("Conflict guard pair classification failed", error);
      return { zone: "grey", decision: "warn", ruleId: "semantic-interaction-uncertain", summary: "规则判定失败，暂按灰区处理。", evidence: [], contractChanged: { left: false, right: false }, typecheck: { ran: false, skipped: "规则判定异常" } };
    }
  } });
  const t0Events = new Set<string>();

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
      const record = { schema: 3, seq, at: clock.now(), ...clean };
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
  const removePairListener = pairCoordinator.onEvent((event) => {
    try { void appendTrace({ type: event.type, pairId: event.record.pair.id, revision: event.record.revision, status: event.record.status, verdict: event.record.verdict, resolution: event.record.resolution, pair: event.record.pair }); } catch (error) { markDegraded(error); }
  });

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
    pairCoordinator.update(semantic.getCandidatePairs());
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
    if (event.type === "batch_opened" && event.batch.actor.kind === "human") {
      const key = `${event.batch.actor.memberId}:${event.batch.file}`;
      const manager = undoManagers.get(key);
      if (manager) {
        manager.stopCapturing();
        undoBaselines.set(key, manager.undoStack.length);
      }
      for (const record of pairCoordinator.records()) {
        if (record.status !== "judged" || !record.verdict) continue;
        const side = actorKey(record.pair.left.actor) === actorKey(event.batch.actor) ? record.verdict.contractChanged.right : actorKey(record.pair.right.actor) === actorKey(event.batch.actor) ? record.verdict.contractChanged.left : false;
        if (!side) continue;
        const key = `${event.batch.id}:${record.pair.id}`;
        if (t0Events.has(key)) continue;
        t0Events.add(key);
        const dependency = actorKey(record.pair.left.actor) === actorKey(event.batch.actor) ? record.pair.right.symbol : record.pair.left.symbol;
        const warning = { id: key, batchId: event.batch.id, memberId: event.batch.actor.memberId, pairId: record.pair.id, summary: `正在修改你依赖的 ${displaySymbol(dependency)}：${record.verdict.summary}`, at: clock.now() };
        t0Warnings.push({ id: warning.id, memberId: warning.memberId, pairId: warning.pairId, summary: warning.summary, at: warning.at });
        if (t0Warnings.length > 100) t0Warnings.shift();
        void appendTrace({ type: "t0_warning", ...warning });
      }
    }
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
      if (origin.kind === "human") recordFreezeViolations(file, ops);
      mirror.text = after;
      mirror.version = ++mirrorVersion;
      changedFiles.add(file);
      if (origin.kind === "filesystem") scheduleSemanticUpdate(file);
      } catch (error) {
        markDegraded(error);
      }
    };
    text.observe(observer);
    mirrors.set(file, { text: initial, version: ++mirrorVersion, stop: () => text.unobserve(observer), document });
    for (const identity of connections.values()) attachUndoManager(identity.memberId, file, text);
    scheduleSemanticUpdate(file);
    void name;
    } catch (error) {
      markDegraded(error);
    }
  }

  function actorForOrigin(origin: unknown): ActorRef {
    if (origin === FILESYSTEM_ORIGIN) return { kind: "filesystem" };
    if (origin instanceof YRuntime.UndoManager) {
      const memberId = revertOrigins.get(origin);
      if (memberId) return { kind: "guard-revert", memberId };
    }
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

  function attachUndoManager(memberId: string, file: string, text: Y.Text, socket?: object) {
    const key = `${memberId}:${file}`;
    const existing = undoManagers.get(key);
    if (existing) { if (socket) existing.trackedOrigins.add(socket); return; }
    const origins = new Set<object>();
    for (const [socket, identity] of connections) if (identity.memberId === memberId) origins.add(socket);
    if (socket) origins.add(socket);
    const manager = new YRuntime.UndoManager(text, { trackedOrigins: origins });
    undoManagers.set(key, manager);
    revertOrigins.set(manager, memberId);
  }
  function registerConnection(socket: object, identity: ConnectionIdentity) { connections.set(socket, identity); for (const [file, mirror] of mirrors) attachUndoManager(identity.memberId, file, mirror.document.getText("content"), socket); }
  function unregisterConnection(socket: object) { connections.delete(socket); for (const manager of undoManagers.values()) manager.trackedOrigins.delete(socket); }

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

  function state(memberId?: string) {
    const sets = semantic.getActiveChangeSets();
    const decisions = pairCoordinator.records().filter((record) => record.status !== "closed" && record.verdict);
    const frozenDurationMs = pairCoordinator.records().reduce((total, record) => total + record.totalLockMs + (record.firstLockedAt === undefined ? 0 : Math.max(0, clock.now() - record.firstLockedAt)), 0);
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
      pairDecisions: pairCoordinator.records().filter((record) => record.status !== "closed").map((record) => ({ ...record, verdict: record.verdict })),
      frozenFiles: frozenFiles(),
      blockedPersists: [...blockedPersists.entries()].map(([file, reason]) => ({ file, reason })),
      persistConflicts,
      persistBlockedCount,
      uiActionCount,
      intervention: {
        decisions: decisions.length,
        localDecisionRatio: decisions.length === 0 ? 0 : 1,
        white: decisions.filter((record) => record.verdict?.zone === "white").length,
        black: decisions.filter((record) => record.verdict?.zone === "black").length,
        grey: decisions.filter((record) => record.verdict?.zone === "grey").length,
        frozenDurationMs,
        persistBlockedCount,
        uiActionCount
      },
      t0Warnings: memberId ? t0Warnings.filter((warning) => warning.memberId === memberId) : [],
      statistics: semantic.statistics(),
      cursors: tracker.getLatestCursors().map((cursor) => {
        const text = mirrors.get(cursor.file)?.text;
        const lines = text?.split("\n");
        const start = lines ? lines.slice(0, cursor.lineNumber - 1).reduce((count, line) => count + line.length + 1, 0) + cursor.column - 1 : undefined;
        return { ...cursor, symbol: start === undefined ? null : semanticIndex.symbolsInRange(cursor.file, start, start)[0]?.key ?? null };
      })
    };
  }

  function frozenFiles() {
    if (options.config.mode === "off" || options.config.mode === "observe") return [];
    const files = new Map<string, Array<{ pairId: string; actor: ActorRef; startLine: number; endLine: number; summary: string }>>();
    for (const record of pairCoordinator.records()) {
      if (record.status !== "judged" || record.verdict?.decision !== "lock") continue;
      for (const side of [record.pair.left, record.pair.right]) {
        const set = semantic.getActiveChangeSets().find((candidate) => actorKey(candidate.actor) === actorKey(side.actor));
        const symbol = [...(set?.files.values() ?? [])].flatMap((file) => file.symbols ?? []).find((candidate) => candidate.key === side.symbol);
        if (!symbol) continue;
        const entries = files.get(symbol.file) ?? [];
        entries.push({ pairId: record.pair.id, actor: side.actor, startLine: symbol.startLine, endLine: symbol.endLine, summary: record.verdict.summary });
        files.set(symbol.file, entries);
      }
    }
    return [...files.entries()].map(([file, regions]) => ({ file, regions }));
  }

  function persistGate(file: string) {
    if (options.config.mode === "off" || options.config.mode === "observe") { blockedPersists.delete(file); return { allowed: true as const, reason: undefined }; }
    const frozen = frozenFiles().find((entry) => entry.file === file);
    if (frozen) return { allowed: false as const, reason: "lock" };
    const activePairs = semantic.getCandidatePairs();
    const active = semantic.getActiveChangeSets().some((set) => set.status === "editing" && [...set.files.values()].some((change) => change.file === file && (change.symbols ?? []).some((symbol) => activePairs.some((pair) => ((actorKey(pair.left.actor) === actorKey(set.actor) && pair.left.symbol === symbol.key) || (actorKey(pair.right.actor) === actorKey(set.actor) && pair.right.symbol === symbol.key))))));
    if (active) return { allowed: false as const, reason: "pending-judgement" };
    blockedPersists.delete(file);
    return { allowed: true as const, reason: undefined };
  }
  function persistBlocked(file: string, reason?: string) { blockedPersists.set(file, reason ?? "guard"); persistBlockedCount += 1; stateVersion += 1; }
  function persistConflict(file: string) { persistConflicts += 1; void appendTrace({ type: "persist_conflict", file }); stateVersion += 1; }
  function persistError(file: string, error: unknown) { markDegraded(error); void appendTrace({ type: "persist_error", file, reason: error instanceof Error ? error.message : String(error) }); }
  function recordFreezeViolations(file: string, ops: TextEditOp[]) {
    const frozen = frozenFiles().find((entry) => entry.file === file);
    if (!frozen) return;
    const lines = beforeLineOffsets(mirrors.get(file)?.text ?? "");
    for (const op of ops) {
      const line = lines.reduce((current, offset, index) => offset <= op.from ? index + 1 : current, 1);
      if (frozen.regions.some((region) => line >= region.startLine && line <= region.endLine)) void appendTrace({ type: "freeze_violation", file, from: op.from, pairIds: frozen.regions.map((region) => region.pairId) });
    }
  }

  function confirmPair(pairId: string, memberId: string) {
    const record = pairCoordinator.get(pairId);
    if (!record) return false;
    const side = actorKey(record.pair.left.actor) === `human:${memberId}` ? "left" : actorKey(record.pair.right.actor) === `human:${memberId}` ? "right" : undefined;
    if (!side) return false;
    const result = pairCoordinator.confirm(pairId, side);
    if (result) uiActionCount += 1;
    void appendTrace({ type: "ui_action", action: "confirm_pair", pairId, memberId });
    return result;
  }
  function chatPair(pairId: string, memberId: string, text: string) {
    const record = pairCoordinator.get(pairId);
    if (!record || !text.trim()) return false;
    const actor = `human:${memberId}`;
    if (actorKey(record.pair.left.actor) !== actor && actorKey(record.pair.right.actor) !== actor) return false;
    uiActionCount += 1;
    void appendTrace({ type: "ui_action", action: "chat_pair", pairId, memberId });
    return true;
  }
  function revertPair(pairId: string, memberId: string) {
    const record = pairCoordinator.get(pairId);
    if (!record) return false;
    const actor = `human:${memberId}`;
    const symbols = [record.pair.left, record.pair.right].filter((side) => actorKey(side.actor) === actor).map((side) => side.symbol);
    if (symbols.length === 0) return false;
    const files = new Set(symbols.map((symbol) => symbol.slice(0, symbol.indexOf("#"))));
    for (const file of files) {
      const key = `${memberId}:${file}`;
      const manager = undoManagers.get(key);
      const baseline = undoBaselines.get(key) ?? Math.max(0, manager?.undoStack.length ?? 0) - 1;
      while (manager && manager.undoStack.length > baseline) manager.undo();
      undoBaselines.delete(key);
      scheduleSemanticUpdate(file);
    }
    pairCoordinator.resolve(pairId, "reverted");
    uiActionCount += 1;
    void appendTrace({ type: "ui_action", action: "revert_pair", pairId, memberId });
    return true;
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
    persistGate,
    persistBlocked,
    persistConflict,
    persistError,
    confirmPair,
    chatPair,
    revertPair,
    pairCoordinator,
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
        removePairListener();
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
function actorKey(actor: ActorRef) { return actor.kind === "human" ? `human:${actor.memberId}` : actor.kind === "agent" ? `agent:${actor.runId}` : actor.kind; }
function beforeLineOffsets(text: string) { const offsets = [0]; for (let index = 0; index < text.length; index += 1) if (text[index] === "\n") offsets.push(index + 1); return offsets; }
function displaySymbol(key: string) { const name = key.slice(key.indexOf("#") + 1); return /\.(?:apply|add|total|checkout|formatMoney|applyDiscount)(?:@\d+)?$/.test(name) ? `${name}()` : name; }

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
