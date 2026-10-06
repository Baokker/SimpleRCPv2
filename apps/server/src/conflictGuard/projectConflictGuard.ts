import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import type * as Y from "yjs";
import {
  ConflictGuardTracker,
  textDiffOps,
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
  mapSymbolChanges,
  isSourceParsable,
  classify,
  buildAdjudicationInput,
  defaultAdjudicationConfig,
  createSessionCoordinator,
  createGuardConflict,
  type PairCoordinator
} from "@simplercp/conflict-guard";
import { FILESYSTEM_ORIGIN } from "../textDelta.js";
import { createWorkspaceSemanticFiles } from "./semanticFiles.js";
import { createServerAdjudication, type ServerAdjudicationConfig } from "./adjudicationRuntime.js";
import { createProjectAgentGuard } from "./projectAgentGuard.js";
import { resolveWorkspacePath } from "../workspace.js";

const require = createRequire(import.meta.url);
const YRuntime = require("yjs") as typeof import("yjs");

export interface ProjectConflictGuardConfig {
  mode: "off" | "observe" | "rules" | "full";
  idleMs: number;
  cursorLeaveLines: number;
  maxBatchDurationMs: number;
  activeIdleMs: number;
  cursorDebounceMs: number;
  adjudication?: ServerAdjudicationConfig;
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
  onPersistenceStateChanged?(): void;
  onStateChanged?(version: number): void;
  reconcileAgentFile?(file: string): Promise<void>;
  displayActor?(actor: ActorRef): string;
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
  let revertFailure = "当前状态不允许撤回";
  const revertOrigins = new Map<Y.UndoManager, string>();
  const originMembers = new Map<object, string>();
  const memberOrigins = new Map<string, object>();
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
  const externalTexts = new Map<string, string>();
  const trackedFiles = new Set<string>();
  const externalOrigins = new Map<string, { actor: Extract<ActorRef, { kind: "agent" }>; text: string; before: string }>();
  const adjudicationSettings = options.config.adjudication?.settings ?? defaultAdjudicationConfig;
  const adjudication = options.config.mode === "full" && options.config.adjudication && adjudicationSettings.strategy !== "G0" ? createServerAdjudication(options.config.adjudication, clock, options.sensitiveValues ?? [], (call) => {
    void appendTrace({ type: "provider_call", ...call });
    stateVersion += 1;
    options.onStateChanged?.(stateVersion);
  }, (subscription) => { void appendTrace({ type: "provider_subscription", ...subscription }); }) : undefined;
  const session = createSessionCoordinator({ tracker, semantic, index: semanticIndex, now: clock.now, clock, softDeadlineMs: adjudicationSettings.softDeadlineMs, ...(adjudication ? { adjudicate(pair, local, signal, complete) {
    if (pair.left.actor.kind !== "human" || pair.right.actor.kind !== "human") { complete(local); return; }
    try {
      const left = session.symbolFor(pair.left.actor, pair.left.symbol);
      const right = session.symbolFor(pair.right.actor, pair.right.symbol);
      if (!left || !right) throw new Error("研判输入缺少符号");
      const input = buildAdjudicationInput({ left: { actor: pair.left.actor, symbol: left }, right: { actor: pair.right.actor, symbol: right }, path: pair.path, nested: false, typeOnly: Boolean(pair.path?.typeOnly), project: { ...semanticIndex, readFile: semanticFiles.readFile } }, local, adjudicationSettings, semanticFiles.contextFiles());
      void adjudication.judge(input, local, signal).then(complete).catch(() => { if (!signal.aborted) complete({ ...local, decision: "warn", ruleId: "model-unavailable", summary: "研判失败，已降级为警告。" }); });
    } catch { complete({ ...local, decision: "warn", ruleId: "model-unavailable", summary: "研判失败，已降级为警告。" }); }
  } } : {}), intervene: options.config.mode === "rules" || options.config.mode === "full", onError(error) { console.error("Conflict guard pair classification failed", error); }, onEvent(event) {
    if (event.type === "t0_warning") {
      t0Warnings.push({ id: String(event.id), memberId: String(event.memberId), pairId: String(event.pairId), summary: String(event.summary), at: clock.now() });
      if (t0Warnings.length > 100) t0Warnings.shift();
    }
    if (event.type === "persist_gate") {
      if (event.allowed) blockedPersists.delete(String(event.file));
      else {
        if (!blockedPersists.has(String(event.file))) persistBlockedCount += 1;
        blockedPersists.set(String(event.file), String(event.reason));
      }
    }
    void appendTrace(event);
    stateVersion += 1;
    options.onStateChanged?.(stateVersion);
    options.onPersistenceStateChanged?.();
  }, classify: (pair) => {
      const sets = semantic.getActiveChangeSets();
      const find = (side: { actor: ActorRef; symbol: string }) => sets.find((set) => actorKey(set.actor) === actorKey(side.actor))?.files && [...(sets.find((set) => actorKey(set.actor) === actorKey(side.actor))?.files.values() ?? [])].flatMap((file) => file.symbols ?? []).find((symbol) => symbol.key === side.symbol);
      const left = find(pair.left);
      const right = find(pair.right);
      if (!left || !right) return { zone: "grey", decision: "warn", ruleId: "semantic-interaction-uncertain", summary: "修改可能互相影响，需要进一步判断。", evidence: [], contractChanged: { left: false, right: false } };
      return classify({ left: { actor: pair.left.actor, symbol: left }, right: { actor: pair.right.actor, symbol: right }, path: pair.path, nested: pair.distance === 0 && pair.left.symbol !== pair.right.symbol, typeOnly: Boolean(pair.path?.typeOnly), project: semanticIndex });
  } });
  const pairCoordinator: PairCoordinator = session.coordinator;

  function markDegraded(error: unknown) {
    degraded = true;
    degradedReason = error instanceof Error ? error.message : String(error);
    console.error("Conflict guard entered degraded state", error);
    stateVersion += 1;
    options.onStateChanged?.(stateVersion);
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
    const at = event.at ?? clock.now();
    traceOperations = traceOperations.catch(() => undefined).then(async () => {
      const clean = redact(event, options.sensitiveValues ?? []) as Record<string, unknown>;
      if (typeof clean.file === "string" && redactedFiles.has(clean.file)) clean.redacted = true;
      const seq = traceSequence + 1;
      const record = { schema: 3, seq, at, ...clean };
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

  const agentAdjudication = options.config.mode === "full" && options.config.adjudication ? Object.fromEntries((["T2", "T3"] as const).map((point) => [point, createServerAdjudication({ ...options.config.adjudication!, settings: { ...adjudicationSettings, strategy: "G4", point, reasoning: point === "T2" ? adjudicationSettings.t2Reasoning ?? false : adjudicationSettings.t3Reasoning ?? false, hardDeadlineMs: point === "T2" ? 30000 : 60000 } }, clock, options.sensitiveValues ?? [], (call) => { void appendTrace({ type: "provider_call", ...call }); }, (subscription) => { void appendTrace({ type: "provider_subscription", ...subscription }); })])) as Record<"T2" | "T3", ReturnType<typeof createServerAdjudication>> : undefined;
  const agentGuard = createProjectAgentGuard({
    mode: options.config.mode, tracker, clock, files: semanticFiles,
    active: () => semantic.getActiveChangeSets(), refresh: updateSemantic, gate: persistGate,
    current: (file) => { try { return semanticFiles.readFile(file); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return ""; throw error; } },
    readDisk: async (file) => { try { return await fs.readFile(resolveWorkspacePath(options.workspacePath, file), "utf8"); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; return ""; } },
    reconcile: options.reconcileAgentFile, displayActor: options.displayActor,
    notificationsPath: path.join(options.metadataPath, "conflict-guard", "notifications.json"), sensitiveValues: options.sensitiveValues,
    ...(agentAdjudication ? { adjudicate(point, input, local, signal) { return agentAdjudication[point].judge(buildAdjudicationInput(input, local, { ...adjudicationSettings, point }, semanticFiles.contextFiles()), local, signal); } } : {}),
    emit: (event) => { void appendTrace(event); },
    changed: () => { stateVersion += 1; options.onStateChanged?.(stateVersion); options.onPersistenceStateChanged?.(); }
  });

  traceOperations = initializeTraceSequence().then(() => undefined).catch((error) => {
    traceWriteFailures += 1;
    console.error("Conflict guard trace initialization failed", error);
    markDegraded(error);
  });

  void appendTrace({
    type: "session_start",
    mode: options.config.mode,
    pairRevisionMode: "judged-input",
    config: {
      idleMs: options.config.idleMs,
      cursorLeaveLines: options.config.cursorLeaveLines,
      maxBatchDurationMs: options.config.maxBatchDurationMs,
      activeIdleMs: options.config.activeIdleMs,
      cursorDebounceMs: options.config.cursorDebounceMs
    },
    ...(adjudication ? { adjudication: adjudicationSettings } : {}),
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
    const batches = closedBatches.splice(0).filter(({ batch }) => existingFiles.has(batch.file));
    session.refresh(batches);
    for (const { batch, change } of batches) {
      const set = semantic.getActiveChangeSets().find((set) => actorKey(set.actor) === actorKey(batch.actor));
      if (set) agentGuard.remember(set, batch.endedAt);
      else if (change) agentGuard.remember({ actor: batch.actor, status: "settled", files: new Map([[batch.file, { ...change, symbols: mapSymbolChanges(change, batch.textAfter, semanticIndex) }]]) }, batch.endedAt);
    }
    options.onPersistenceStateChanged?.();
    stateVersion += 1;
    options.onStateChanged?.(stateVersion);
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
        if (!undoBaselines.has(key)) undoBaselines.set(key, manager.undoStack.length);
      }
      session.batchOpened(event.batch);
    }
    if (event.type === "batch_closed") {
      session.batchClosed(event.batch);
      const change = tracker.getActiveChangeSets().find((set) => actorKey(set.actor) === actorKey(event.batch.actor))?.files.get(event.batch.file);
      closedBatches.push({ batch: event.batch, change });
      scheduleSemanticUpdate(event.batch.file);
    }
    if (event.type === "change_set_closed" || event.type === "change_set_file_closed") {
      const actor = event.type === "change_set_closed" ? event.changeSet.actor : event.actor;
      if (actor.kind === "human") {
        const files = event.type === "change_set_closed" ? [...event.changeSet.files.keys()] : [event.file];
        for (const file of files) {
          const key = `${actor.memberId}:${file}`;
          undoManagers.get(key)?.stopCapturing();
          undoBaselines.delete(key);
        }
      }
      scheduleSemanticUpdate();
    }
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
    const beforeTransaction = (transaction: Y.Transaction) => {
      if (transaction.origin && typeof transaction.origin === "object") {
        const memberId = connections.get(transaction.origin)?.memberId;
        if (memberId) transaction.origin = stableOrigin(memberId);
      }
    };
    document.on("beforeTransaction", beforeTransaction);
    const initial = text.toString();
    trackedFiles.add(file);
    externalTexts.set(file, initial);
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
        session.edit(file, resyncOps, false);
        void appendTrace({ type: "mirror_resync", file, previousTextHash: hashText(safeAfter.value), textHash: hashText(safeAfter.value), text: safeAfter.value, ...(redactedFiles.has(file) ? { redacted: true } : {}) });
        return;
      }
      const origin = actorForOrigin(event.transaction.origin);
      const revisionAfter = options.getRevision(file);
      tracker.edit({ file, origin, at: clock.now(), ops, revisionAfter, textBefore: before, textAfter: after });
      mirror.text = after;
      externalTexts.set(file, after);
      mirror.version = ++mirrorVersion;
      session.edit(file, ops, origin.kind === "human");
      changedFiles.add(file);
      scheduleSemanticUpdate(file);
      } catch (error) {
        markDegraded(error);
      }
    };
    text.observe(observer);
    mirrors.set(file, { text: initial, version: ++mirrorVersion, stop: () => { text.unobserve(observer); document.off("beforeTransaction", beforeTransaction); }, document });
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
      const actor = origin as ActorRef;
      if (actor.kind === "agent" && agentGuard.actor(actor.runId) === actor) return actor;
      if (actor.kind === "guard-revert") return actor;
      const identity = connections.get(origin);
      if (identity) return { kind: "human", memberId: identity.memberId };
      const memberId = originMembers.get(origin);
      if (memberId) return { kind: "human", memberId };
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
    if (existing) return;
    const manager = new YRuntime.UndoManager(text, { trackedOrigins: new Set([stableOrigin(memberId)]) });
    undoManagers.set(key, manager);
    revertOrigins.set(manager, memberId);
  }
  function stableOrigin(memberId: string) {
    let origin = memberOrigins.get(memberId);
    if (!origin) { origin = { memberId }; memberOrigins.set(memberId, origin); originMembers.set(origin, memberId); }
    return origin;
  }
  function registerConnection(socket: object, identity: ConnectionIdentity) { connections.set(socket, identity); for (const [file, mirror] of mirrors) attachUndoManager(identity.memberId, file, mirror.document.getText("content")); }
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
          externalTexts.set(name, mirror.text);
          trackedFiles.delete(name);
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
      for (const [key, manager] of undoManagers) if (key.endsWith(`:${file}`)) {
        manager.destroy();
        undoManagers.delete(key);
        undoBaselines.delete(key);
        revertOrigins.delete(manager);
      }
      tracker.releaseDocument(file);
      trackedFiles.delete(file);
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
      activeSymbols: sets.map((set) => ({ actor: set.actor, symbols: [...set.files.values()].flatMap((file) => file.symbols ?? []).map(({ before: _before, after: _after, beforeComments: _comments, ...symbol }) => symbol) })),
      candidatePairs: semantic.getCandidatePairs(),
      pairDecisions: [...pairCoordinator.records().filter((record) => record.status !== "closed" && record.pair.left.actor.kind === "human" && record.pair.right.actor.kind === "human"), ...agentGuard.records()].map((record) => {
        const self = [record.pair.left, record.pair.right].find((side) => side.actor.kind === "human" && side.actor.memberId === memberId) ?? record.pair.left;
        const other = actorKey(self.actor) === actorKey(record.pair.left.actor) ? record.pair.right : record.pair.left;
        const otherChange = sets.find((set) => actorKey(set.actor) === actorKey(other.actor))?.files.get(other.symbol.split("#")[0]!)?.symbols?.find((symbol) => symbol.key === other.symbol);
        const conflict = createGuardConflict({ record, self: self.actor, otherDisplayName: options.displayActor?.(other.actor) ?? "协作成员", otherChange });
        return { ...record, conflict };
      }),
      agentNotices: agentGuard.notices(memberId),
      frozenFiles: frozenFiles(),
      analyzingFiles: analyzingFiles(),
      adjudication: adjudication?.stats(),
      blockedPersists: [...blockedPersists.entries()].map(([file, reason]) => ({ file, reason })),
      persistConflicts,
      persistBlockedCount,
      uiActionCount,
      intervention: {
        decisions: decisions.length,
        localDecisionRatio: decisions.length === 0 ? 0 : decisions.filter((record) => record.verdict?.zone !== "grey").length / decisions.length,
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
    for (const region of session.regions()) {
      const text = mirrors.get(region.file)?.text ?? semanticFiles.readFile(region.file);
      const lines = beforeLineOffsets(text);
      const lineAt = (position: number) => lines.reduce((current, offset, index) => offset <= position ? index + 1 : current, 1);
      const entries = files.get(region.file) ?? [];
      entries.push({ pairId: region.pairId, actor: region.actor, startLine: lineAt(region.start), endLine: lineAt(Math.max(region.start, region.end - 1)), summary: region.summary });
      files.set(region.file, entries);
    }
    return [...files.entries()].map(([file, regions]) => ({ file, regions }));
  }

  function analyzingFiles() {
    const files = new Map<string, Array<{ pairId: string; startLine: number; endLine: number; summary: string }>>();
    for (const region of session.analyzingRegions()) {
      const text = mirrors.get(region.file)?.text ?? semanticFiles.readFile(region.file);
      const lineAt = (position: number) => text.slice(0, position).split("\n").length;
      const entries = files.get(region.file) ?? [];
      entries.push({ pairId: region.pairId, startLine: lineAt(region.start), endLine: lineAt(Math.max(region.start, region.end - 1)), summary: region.summary });
      files.set(region.file, entries);
    }
    return [...files].map(([file, regions]) => ({ file, regions }));
  }

  function persistGate(file: string) {
    try { if (options.config.mode !== "observe" && agentGuard.pendingFile(file)) return { allowed: false, reason: "agent-write" }; return session.gate(file); }
    catch (error) { markDegraded(error); return { allowed: true, reason: undefined }; }
  }
  function shouldPinDocument(file: string) {
    if (options.config.mode === "off") return false;
    if (frozenFiles().some((entry) => entry.file === file)) return true;
    return tracker.getActiveChangeSets().some((set) => [...set.files.values()].some((change) => change.file === file))
      || pairCoordinator.records().some((record) => record.status !== "closed" && [record.pair.left.symbol, record.pair.right.symbol].some((key) => key.startsWith(`${file}#`)));
  }
  function persistenceGateChanged() { options.onPersistenceStateChanged?.(); }
  function persistBlocked(file: string, reason?: string) {
    const next = reason ?? "guard";
    if (blockedPersists.has(file)) { blockedPersists.set(file, next); return; }
    blockedPersists.set(file, next);
    persistBlockedCount += 1;
    stateVersion += 1;
    options.onStateChanged?.(stateVersion);
  }
  function persistConflict(file: string) { persistConflicts += 1; void appendTrace({ type: "persist_conflict", file }); stateVersion += 1; options.onStateChanged?.(stateVersion); }
  function persisted(file: string, content: string) { void appendTrace({ type: "persist", file, textHash: hashText(content) }); }
  function persistError(file: string, error: unknown) { markDegraded(error); void appendTrace({ type: "persist_error", file, reason: error instanceof Error ? error.message : String(error) }); }

  function confirmPair(pairId: string, actor: ActorRef | string) {
    const identity: ActorRef = typeof actor === "string" ? { kind: "human", memberId: actor } : actor;
    if (options.config.mode !== "rules" && options.config.mode !== "full") return false;
    const record = pairCoordinator.get(pairId);
    if (!record || record.status !== "judged" || record.verdict?.decision !== "lock") return false;
    if (record.pair.left.actor.kind !== "human" || record.pair.right.actor.kind !== "human") return false;
    const side = actorKey(record.pair.left.actor) === actorKey(identity) ? "left" : actorKey(record.pair.right.actor) === actorKey(identity) ? "right" : undefined;
    if (!side) return false;
    if (identity.kind !== "human") return false;
    const memberId = identity.memberId;
    const result = pairCoordinator.confirm(pairId, side);
    if (result) { stateVersion += 1; options.onStateChanged?.(stateVersion); options.onPersistenceStateChanged?.(); }
    if (result) uiActionCount += 1;
    if (result) void appendTrace({ type: "ui_action", action: "confirm_pair", pairId, memberId });
    return result;
  }
  function chatPair(pairId: string, identity: ActorRef | string, text: string) {
    const record = pairCoordinator.get(pairId);
    if (!record || !text.trim()) return false;
    const actorRef: ActorRef = typeof identity === "string" ? { kind: "human", memberId: identity } : identity;
    const actor = actorKey(actorRef);
    if (actorKey(record.pair.left.actor) !== actor && actorKey(record.pair.right.actor) !== actor) return false;
    uiActionCount += 1;
    void appendTrace({ type: "ui_action", action: "chat_pair", pairId, actor: actorRef });
    return true;
  }
  function revertPair(pairId: string, identity: ActorRef | string) {
    revertFailure = "当前状态不允许撤回";
    if (options.config.mode !== "rules" && options.config.mode !== "full") return false;
    const record = pairCoordinator.get(pairId);
    if (!record || record.status !== "judged" || record.verdict?.decision !== "lock") return false;
    if (record.pair.left.actor.kind !== "human" || record.pair.right.actor.kind !== "human") return false;
    const actorRef: ActorRef = typeof identity === "string" ? { kind: "human", memberId: identity } : identity;
    if (actorRef.kind !== "human") return false;
    const memberId = actorRef.memberId;
    const actor = actorKey(actorRef);
    const symbols = [record.pair.left, record.pair.right].filter((side) => actorKey(side.actor) === actor).map((side) => side.symbol);
    if (symbols.length === 0) return false;
    const files = new Set(symbols.map((symbol) => symbol.slice(0, symbol.indexOf("#"))));
    let reversible = false;
    for (const file of files) {
      const key = `${memberId}:${file}`;
      const manager = undoManagers.get(key);
      const mirror = mirrors.get(file);
      if (!manager || !mirror) continue;
      const baseline = undoBaselines.get(key) ?? manager.undoStack.length;
      if (manager.undoStack.length <= baseline) continue;
      const preview = new YRuntime.Doc({ gc: false });
      YRuntime.applyUpdate(preview, YRuntime.encodeStateAsUpdate(mirror.document));
      const undo = new YRuntime.UndoManager(preview.getText("content"));
      undo.undoStack = manager.undoStack.map((item) => ({ ...item, meta: new Map(item.meta) }));
      while (undo.undoStack.length > baseline) undo.undo();
      const after = preview.getText("content").toString();
      reversible ||= after !== mirror.text;
      const valid = isSourceParsable(file, after);
      undo.destroy(); preview.destroy();
      if (!valid) { revertFailure = "撤回会与他人的修改交叠，请在聊天中协商"; return false; }
    }
    if (!reversible) { revertFailure = "没有可撤回的修改"; return false; }
    let changed = false;
    for (const file of files) {
      const key = `${memberId}:${file}`;
      const manager = undoManagers.get(key);
      if (!manager) continue;
      const before = mirrors.get(file)?.text;
      if (before === undefined) continue;
      const baseline = undoBaselines.get(key) ?? manager.undoStack.length;
      while (manager && manager.undoStack.length > baseline) manager.undo();
      undoBaselines.delete(key);
      const after = mirrors.get(file)?.text;
      if (after === undefined) continue;
      changed ||= before !== after;
      if (before !== after) tracker.closeMemberFile({ kind: "human", memberId }, file);
      scheduleSemanticUpdate(file);
    }
    if (!changed) { revertFailure = "没有可撤回的修改"; return false; }
    pairCoordinator.requestResolution(pairId, "reverted");
    updateSemantic();
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

  function markDone(memberId: string) {
    try {
      void appendTrace({ type: "ui_action", action: "change_set_done", memberId });
      tracker.markDone({ kind: "human", memberId });
      updateSemantic();
    } catch (error) {
      markDegraded(error);
    }
  }

  function resolveFilesystemOrigin(file: string, content: string) {
    try {
      const entries = externalOrigins.get(file);
      if (entries?.text === content && agentGuard.actor(entries.actor.runId)) return entries.actor;
      const before = externalTexts.get(file) ?? "";
      const actor = agentGuard.resolveOrigin(file, content);
      if (actor) { externalOrigins.set(file, { actor, text: content, before }); return actor; }
      externalOrigins.delete(file);
    } catch (error) { markDegraded(error); }
    return FILESYSTEM_ORIGIN;
  }
  function trackUnopenedChange(file: string, before: string, after: string, origin: ActorRef) {
    if (!trackedFiles.has(file)) { tracker.openDocument(file, before); trackedFiles.add(file); void appendTrace({ type: "doc_open", file, text: before, textHash: hashText(before) }); }
    if (before !== after) {
      const ops = textDiffOps(before, after);
      tracker.edit({ file, origin, at: clock.now(), ops, revisionAfter: options.getRevision(file), textBefore: before, textAfter: after });
      session.edit(file, ops, false);
    }
    externalTexts.set(file, after);
    scheduleSemanticUpdate(file);
  }

  return {
    mode: options.config.mode,
    tracker,
    tracePath,
    semanticIndex,
    agentGuard,
    beginAgentRun(actor: Extract<ActorRef, { kind: "agent" }>, baseline: Map<string, string>) {
      try {
        for (const [file, mirror] of mirrors) baseline.set(file, mirror.text);
        for (const [file, text] of baseline) if (!externalTexts.has(file)) externalTexts.set(file, text);
        agentGuard.start(actor, baseline);
      } catch (error) { markDegraded(error); }
    },
    resolveFilesystemOrigin,
    workspaceReverted(file: string, before: string, after: string, ownerId: string) {
      try { trackUnopenedChange(file, before, after, { kind: "guard-revert", memberId: ownerId }); }
      catch (error) { markDegraded(error); }
    },
    symbol,
    workspaceChanged(file: string, directory = false) {
      if (directory) { scheduleSemanticUpdate(file); return; }
      if (mirrors.has(file)) return;
      try {
        const after = semanticFiles.readFile(file);
        const previous = externalTexts.get(file);
        const origin = resolveFilesystemOrigin(file, after);
        const actor = origin === FILESYSTEM_ORIGIN ? { kind: "filesystem" as const } : origin as ActorRef;
        const before = previous ?? externalOrigins.get(file)?.before;
        if (before !== undefined) trackUnopenedChange(file, before, after, actor);
        else scheduleSemanticUpdate(file);
        agentGuard.completeOrigin(file, after);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
          const before = externalTexts.get(file);
          const origin = resolveFilesystemOrigin(file, "");
          if (before !== undefined && before !== "") trackUnopenedChange(file, before, "", origin === FILESYSTEM_ORIGIN ? { kind: "filesystem" } : origin as ActorRef);
          agentGuard.completeOrigin(file, "");
        } else if ((error as NodeJS.ErrnoException).code !== "EISDIR") markDegraded(error);
        scheduleSemanticUpdate(file);
      }
    },
    documentPrepared,
    registerConnection,
    unregisterConnection,
    cursorChanged,
    retirePath,
    releaseDocument,
    markDone,
    state,
    waitForTrace,
    exportTrace,
    persistGate,
    shouldPinDocument,
    persistenceGateChanged,
    persistBlocked,
    persistConflict,
    persisted,
    persistError,
    confirmPair,
    chatPair,
    revertPair,
    revertError: () => revertFailure,
    pairCoordinator,
    async dispose() {
      session.dispose();
      adjudication?.dispose();
      for (const service of Object.values(agentAdjudication ?? {})) service.dispose();
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
        for (const manager of undoManagers.values()) manager.destroy();
        undoManagers.clear();
        memberOrigins.clear();
        originMembers.clear();
      } catch (error) {
        markDegraded(error);
      }
      await agentGuard.flushNotices();
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

function hashText(value: string) { return crypto.createHash("sha256").update(value).digest("hex"); }
function actorKey(actor: ActorRef) { return actor.kind === "human" ? `human:${actor.memberId}` : actor.kind === "agent" ? `agent:${actor.runId}` : actor.kind; }
function beforeLineOffsets(text: string) { const offsets = [0]; for (let index = 0; index < text.length; index += 1) if (text[index] === "\n") offsets.push(index + 1); return offsets; }

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
