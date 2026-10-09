import path from "node:path";
import { nanoid } from "nanoid";
import type { AgentRun, AgentSettingsResponse, AgentSession, AgentTraceEvent, AgentPromptContext, AgentQuestion, EventRecord } from "@simplercp/shared";
import type { AgentRuntime } from "./agentRuntime.js";
import { createAgentRunStore, type AgentRunStore } from "./agentRunStore.js";
import { createAgentSessionStore, type AgentSessionStore } from "./agentSessionStore.js";
import { createTraceStore, redactSensitive, type TraceStore } from "./traceStore.js";
import { getProjectMetadataPath, type ProjectRegistry } from "../projects.js";
import type { ProjectRuntimeManager } from "../projectRuntimeManager.js";
import { compareAgentWorkspaceSnapshots, createAgentWorkspaceSnapshot } from "./agentWorkspaceSnapshot.js";
import { buildRuntimePrompt, createApprovalBudget, normalizeAgentContexts, previewPrompt, runWithTimeout } from "./agentRunSupport.js";
import { migrateLegacyAgentSessions } from "./agentSessionAccess.js";
import type { MemberStore } from "../auth/identity.js";
import { normalizeHandle, validateHandle } from "./teamAgentSupport.js";
import { createAgentProgress } from "./agentProgress.js";
import { createAgentQuestions } from "./agentQuestions.js";
import { diagnoseAgentFailure } from "./agentRunFailure.js";
import { canReadAgentRun } from "./agentVisibility.js";
import { createAgentScheduler, getCompletedOverlapGroup, type AgentSchedulerQueue } from "./agentScheduler.js";
import { selectRunnableAgentRun } from "./agentRunSelection.js";
import { createAgentWriteLedger } from "./agentWriteLedger.js";
import { createAgentUsageCollector, estimateAgentUsageCost } from "./agentUsage.js";
import { createAgentSessionOperations } from "./agentSessionOperations.js";
import { agentInsertedRanges, createAgentKnowledgeHooks, extractAgentToolEvent, withSnapshotContents } from "./agentKnowledgeHooks.js";

interface AgentRunManagerOptions {
  members: MemberStore;
  runtime: AgentRuntime;
  registry: ProjectRegistry;
  runtimeManager: ProjectRuntimeManager;
  getSettings(): AgentSettingsResponse;
  apiKey?: string;
  sensitiveValues?: string[];
  runTimeoutMs: number;
  maxConcurrentRuns?: number;
  activityConfig?: { waitingMs: number; stalledMs: number };
  appendActivity?: (projectId: string, input: Omit<EventRecord, "id" | "timestamp">) => EventRecord;
}
export type AgentRunManagerEvent =
  | { type: "run_updated"; projectId: string; run: AgentRun }
  | { type: "activity_appended"; projectId: string; event: EventRecord }
  | { type: "trace_appended"; projectId: string; runId: string; memberId: string; shared: boolean; event: AgentTraceEvent }
  | { type: "team_agents_changed"; projectId: string; agents: AgentSession[] };

export function createAgentRunManager(options: AgentRunManagerOptions) {
  const stores = new Map<string, AgentRunStore>();
  const sessionStores = new Map<string, AgentSessionStore>();
  const traces = new Map<string, TraceStore>();
  const queues = new Map<string, AgentSchedulerQueue>();
  const activeRuns = new Map<string, { workspacePath: string; runtimeSessionId: string }>();
  const questions = new Map<string, ReturnType<typeof createAgentQuestions>>();
  const sessionOperations = new Map<string, Promise<unknown>>();
  const runtimeOperations = createAgentSessionOperations();
  const cancellations = new Map<string, Promise<AgentRun>>();
  const teamOperations = new Map<string, Promise<unknown>>();
  const overlaps = new Map<string, Set<string>>();
  const listeners = new Set<(event: AgentRunManagerEvent) => void>();
  const ledger = createAgentWriteLedger();
  let disposing = false;

  function projectRoot(projectId: string) {
    const project = options.registry.getProject(projectId);
    if (!project) throw new Error("Project not found");
    return getProjectMetadataPath(project);
  }
  function getStore(projectId: string) {
    if (!stores.has(projectId)) stores.set(projectId, createAgentRunStore(projectId, projectRoot(projectId)));
    return stores.get(projectId)!;
  }
  function getSessionStore(projectId: string) {
    if (!sessionStores.has(projectId)) sessionStores.set(projectId, createAgentSessionStore(projectId, projectRoot(projectId)));
    return sessionStores.get(projectId)!;
  }
  function getTrace(projectId: string, runId: string) {
    const key = `${projectId}:${runId}`;
    if (!traces.has(key)) traces.set(key, createTraceStore(path.join(getStore(projectId).runsRoot, runId, "trace.jsonl"), options.sensitiveValues ?? (options.apiKey ? [options.apiKey] : [])));
    return traces.get(key)!;
  }
  function getQueue(projectId: string) {
    if (!queues.has(projectId)) queues.set(projectId, { runIds: [], processing: false, activeRunIds: new Set(), activeSessionIds: new Set(), runningPromises: new Set(), workspacePreparing: false, rescanRequested: false, closing: false });
    return queues.get(projectId)!;
  }
  function emit(event: AgentRunManagerEvent) { for (const listener of listeners) listener(event); }
  async function updateRun(projectId: string, runId: string, input: Partial<AgentRun>) {
    const run = await getStore(projectId).update(runId, redactSensitive(input, options.sensitiveValues) as Partial<AgentRun>);
    emit({ type: "run_updated", projectId, run });
    return run;
  }
  async function updateRunIfStatus(projectId: string, runId: string, status: AgentRun["status"], input: Partial<AgentRun>) {
    const run = await getStore(projectId).updateIfStatus(runId, status, redactSensitive(input, options.sensitiveValues) as Partial<AgentRun>);
    if (run) emit({ type: "run_updated", projectId, run });
    return run;
  }
  async function appendTrace(projectId: string, runId: string, input: Omit<AgentTraceEvent, "sequence" | "timestamp">) {
    const event = await getTrace(projectId, runId).append(input);
    const run = await getStore(projectId).get(runId);
    if (run) emit({ type: "trace_appended", projectId, runId, memberId: run.memberId, shared: run.sessionScope === "team" || run.source === "chat", event });
    return event;
  }
  function appendActivity(projectId: string, input: Omit<EventRecord, "id" | "timestamp">) {
    if (options.appendActivity) emit({ type: "activity_appended", projectId, event: options.appendActivity(projectId, input) });
  }
  function withLock<T>(operations: Map<string, Promise<unknown>>, key: string, operation: () => Promise<T>): Promise<T> {
    const result = (operations.get(key) ?? Promise.resolve()).then(operation);
    const settled = result.then(() => undefined, () => undefined);
    operations.set(key, settled);
    void settled.then(() => { if (operations.get(key) === settled) operations.delete(key); });
    return result;
  }
  function requireMember(projectId: string, memberId: string) {
    const runtime = options.runtimeManager.get(projectId);
    const member = runtime.rooms.getMember(runtime.room.id, memberId);
    if (!member) throw new Error("Project membership is required");
    return member;
  }
  const knowledge = createAgentKnowledgeHooks({ runtime: options.runtime, runtimeManager: options.runtimeManager, getStore, getSessionStore, listTrace: (id, runId) => getTrace(id, runId).list(), appendTrace, appendActivity, runTimeoutMs: options.runTimeoutMs, operations: runtimeOperations, isClosing: (id) => disposing || getQueue(id).closing });
  async function ensureDefaultTeamAgent(projectId: string) {
    await withLock(teamOperations, projectId, async () => {
      const store = getSessionStore(projectId);
      if (await store.findByHandle("agent")) return;
      await store.create({ projectId, memberId: "", scope: "team", handle: "agent", description: "Shared agent for the whole team", title: "agent", runtime: "opencode" });
      emit({ type: "team_agents_changed", projectId, agents: await store.list(undefined, "team") });
    });
  }
  const scheduler = createAgentScheduler({
    maxConcurrentRuns: options.maxConcurrentRuns ?? 3,
    isClosing: () => disposing,
    getQueue,
    findRunnableRun(projectId, queue) { return selectRunnableAgentRun({ queue, runs: getStore(projectId), sessions: getSessionStore(projectId), workspacePath: options.runtimeManager.get(projectId).project.workspacePath }); },
    onRunStart({ projectId, runId, overlappingRunIds }) {
      overlaps.set(runId, overlappingRunIds);
      for (const other of overlappingRunIds) overlaps.get(other)?.add(runId);
      const release = options.runtime.acquireRun?.();
      return () => {
        release?.();
        for (const id of getCompletedOverlapGroup(runId, overlaps, getQueue(projectId).activeRunIds)) { ledger.clear(projectId, id); overlaps.delete(id); }
      };
    },
    async executeRun(projectId, runId) {
      const run = await getStore(projectId).get(runId);
      await runtimeOperations.run(`${projectId}:${run?.sessionId ?? runId}`, () => executeRun(projectId, runId));
    },
    async onSchedulerError(projectId, error, runId) {
      if (!runId) throw error;
      const run = await getStore(projectId).get(runId);
      if (!run || ["completed", "failed", "cancelled"].includes(run.status)) return;
      const failure = diagnoseAgentFailure(error, "creating-session", 0, options.sensitiveValues);
      if (!await updateRunIfStatus(projectId, runId, run.status, { status: "failed", failure, error: failure.message, finishedAt: new Date().toISOString() })) return;
      await appendTrace(projectId, runId, { type: "run_failed", summary: failure.message, data: failure as unknown as Record<string, unknown> });
    }
  });

  async function captureFinished(projectId: string, run: AgentRun) {
    const interruptedBy = run.interruptedByRunId ? await getStore(projectId).get(run.interruptedByRunId) : undefined;
    await options.runtimeManager.find(projectId)?.capture?.agentRun({ runId: run.id, memberId: run.initiatorMemberId ?? run.memberId, action: run.status === "completed" ? "end" : run.status === "cancelled" ? "cancelled" : "failed", status: run.status, source: run.source, sessionId: run.sessionId, prompt: run.prompt, extraPrompt: run.extraPrompt, interruptsRunId: run.interruptsRunId, interruptedByMemberId: run.interruptedByMemberId, interruptedByPrompt: interruptedBy?.prompt, fileChanges: run.fileChanges, agentRanges: agentInsertedRanges(run.fileChanges ?? [], run.initiatorMemberId ?? run.memberId), error: run.error });
    await knowledge.postCheck(projectId, run);
  }

  async function executeRun(projectId: string, runId: string) {
    const store = getStore(projectId);
    const current = await store.get(runId);
    if (!current || current.status !== "queued") return;
    const progress = createAgentProgress(new Date().toISOString(), options.activityConfig);
    const observedUsage = createAgentUsageCollector();
    let phase: import("@simplercp/shared").AgentRunPhase = "creating-session";
    let sequence = 0;
    let snapshot: Awaited<ReturnType<typeof createAgentWorkspaceSnapshot>> | undefined;
    let runtimeSessionId: string | undefined;
    let stopEvents: (() => Promise<void>) | undefined;
    let questionManager: ReturnType<typeof createAgentQuestions> | undefined;
    let lastPublished = 0;
    let usageRecorded = false;
    let captureRecorded = false;
    const runtime = options.runtimeManager.get(projectId);
    const revisions = runtime.documents.getRevisions();
    const recordedConcurrentFiles = new Set<string>();
    async function recordUsage(run: AgentRun) {
      if (usageRecorded) return;
      const usage = estimateAgentUsageCost(observedUsage.total(), run.provider, run.model);
      if (usage) {
        await updateRun(projectId, runId, { usage });
        await appendTrace(projectId, runId, { type: "usage_summary", data: { ...usage } });
      }
      usageRecorded = true;
    }
    async function collectChanges(messageId?: string) {
      if (!snapshot) return [];
      const after = await createAgentWorkspaceSnapshot(runtime.project.workspacePath);
      const changes = compareAgentWorkspaceSnapshots(snapshot, after);
      const memberFiles = new Set(changes.filter((change) => runtime.documents.getRevision(change.file) > (revisions.get(change.file) ?? 0)).map((change) => change.file));
      if (runtimeSessionId) {
        try {
          const sessionChanges = await options.runtime.getDiff({ workspacePath: runtime.project.workspacePath, sessionId: runtimeSessionId, messageId });
          await appendTrace(projectId, runId, { type: "session_diff_observed", data: { files: sessionChanges } });
        } catch (error) { await appendTrace(projectId, runId, { type: "file_changes_unavailable", summary: String(redactSensitive(error instanceof Error ? error.message : String(error), options.sensitiveValues)) }); }
      }
      for (const file of memberFiles) if (!recordedConcurrentFiles.has(file)) {
        recordedConcurrentFiles.add(file);
        await appendTrace(projectId, runId, { type: "concurrent_change", data: { path: file } });
      }
      const overlapping = overlaps.get(runId) ?? new Set<string>();
      const otherFiles = new Set([...overlapping].flatMap((id) => ledger.list(projectId, id).map((entry) => entry.file)));
      const attributed = ledger.attribute(projectId, runId, changes, overlapping, memberFiles).map((change) => memberFiles.has(change.file) || otherFiles.has(change.file) ? { ...change, attribution: "ambiguous" as const } : change);
      return withSnapshotContents(attributed, snapshot, after);
    }
    try {
      knowledge.bind(projectId);
      await runtime.documents.awaitIdle();
      const session = current.sessionId ? await getSessionStore(projectId).get(current.sessionId) : undefined;
      if (!session || session.deletedAt) throw new Error("Agent session not found");
      if ((await store.get(runId))?.status === "cancelled") return;
      if (!await updateRunIfStatus(projectId, runId, "queued", { status: "running", startedAt: new Date().toISOString(), sessionScope: session.scope ?? "personal", activity: { ...progress.snapshot(), phase }, overlappingRunIds: [...(overlaps.get(runId) ?? [])] })) return;
      await runtime.capture?.agentRun({ runId, memberId: current.initiatorMemberId ?? current.memberId, action: "start", status: "running", source: current.source, sessionId: current.sessionId, prompt: current.prompt, extraPrompt: current.extraPrompt, interruptsRunId: current.interruptsRunId });
      await appendTrace(projectId, runId, { type: "run_started", summary: "Agent run started" });
      const prepared = await options.runtime.prepareWorkspace?.(runtime.project.workspacePath);
      scheduler.workspacePrepared(projectId, runId);
      snapshot = await createAgentWorkspaceSnapshot(runtime.project.workspacePath);
      if ((await store.get(runId))?.status === "cancelled") return;
      runtimeSessionId = prepared ? undefined : session.runtimeSessionId;
      if (!runtimeSessionId) runtimeSessionId = (await options.runtime.createSession({ workspacePath: runtime.project.workspacePath, title: current.prompt.slice(0, 80) })).id;
      await getSessionStore(projectId).update(session.id, { runtimeSessionId, lastRunId: runId });
      await updateRun(projectId, runId, { runtimeSessionId });
      activeRuns.set(runId, { workspacePath: runtime.project.workspacePath, runtimeSessionId });
      if ((await store.get(runId))?.status === "cancelled" || disposing) { await options.runtime.cancel({ workspacePath: runtime.project.workspacePath, sessionId: runtimeSessionId }); return; }
      await appendTrace(projectId, runId, { type: "session_created", summary: "OpenCode session ready", data: { sessionId: runtimeSessionId } });
      appendActivity(projectId, { type: "agent_task_started", memberId: current.memberId, participantId: current.participantId, payload: { runId, sessionId: session.id, sessionTitle: session.title, name: current.memberName, promptPreview: previewPrompt(current.prompt) } });
      const approval = createApprovalBudget();
      questionManager = createAgentQuestions({
        pause: () => approval.pause(),
        async reply(id, answers, signal) {
          if (!options.runtime.replyQuestion) throw new Error("当前 Agent runtime 不支持问题回答");
          await options.runtime.replyQuestion({ workspacePath: runtime.project.workspacePath, requestId: id, answers, signal });
        },
        async reject(id, signal) {
          if (!options.runtime.rejectQuestion) throw new Error("当前 Agent runtime 不支持跳过问题");
          await options.runtime.rejectQuestion({ workspacePath: runtime.project.workspacePath, requestId: id, signal });
        },
        abort: (signal) => options.runtime.cancel({ workspacePath: runtime.project.workspacePath, sessionId: runtimeSessionId!, signal }),
        async changed(pending) { progress.syncQuestions(pending.map((question) => question.id)); await updateRun(projectId, runId, { questions: pending, activity: progress.snapshot() }); },
        report: (error) => console.error("Agent question cleanup failed", redactSensitive(error instanceof Error ? error.message : String(error), options.sensitiveValues))
      });
      questions.set(runId, questionManager);
      const run = await updateRun(projectId, runId, { model: options.runtime.getCurrentModel?.() ?? options.getSettings().model });
      const previous = current.interruptsRunId ? await store.get(current.interruptsRunId) : undefined;
      const interruption = previous ? `The previous task was interrupted. Continue from the current workspace files. Follow the latest user request. Files already changed: ${(previous.fileChanges ?? []).map((change) => change.file).join(", ") || "none"}.` : undefined;
      const initiator = requireMember(projectId, current.initiatorMemberId ?? current.memberId);
      const context = await runtime.knowledgeProvider?.buildContext({ project: runtime.project, run, initiator });
      if (context && (context.mode === "inject" || context.mode === "full")) {
        await appendTrace(projectId, runId, { type: "knowledge_injected", data: { mode: context.mode, config: context.config, query: context.query, candidates: context.candidates, ranking: context.config.ranking, lexicalScoring: context.config.lexicalScoring, topK: context.config.topK, toolSection: context.toolSection, toolInstructionPlacement: context.config.toolInstructionPlacement, activeFiles: context.activeFiles, excludedByUser: context.excludedByUser, cards: context.records, totalChars: context.totalChars, estimatedInjectionTokens: context.estimatedInjectionTokens } });
        appendActivity(projectId, { type: "knowledge_injected", memberId: initiator.id, participantId: initiator.participantId, payload: { runId, cardIds: context.records.map((record) => record.id) } });
      }
      const prompt = await buildRuntimePrompt(runtime.project.workspacePath, current.prompt, current.contexts, runtime.project.name, [interruption, current.extraPrompt].filter(Boolean).join("\n\n"), context?.section, context?.toolSystem ? undefined : context?.toolSection);
      await options.runtime.prepareRun?.({ workspacePath: runtime.project.workspacePath, sessionId: runtimeSessionId, runPrompt: current.prompt });
      if ((await store.get(runId))?.status === "cancelled") return;
      stopEvents = await options.runtime.subscribe({ workspacePath: runtime.project.workspacePath, sessionId: runtimeSessionId }, async (event) => {
        observedUsage.observe(event);
        const stored = await appendTrace(projectId, runId, { type: `opencode.${event.type}`, data: event.data });
        sequence = stored.sequence; progress.event(event, stored.timestamp); phase = progress.phase();
        const tool = extractAgentToolEvent(event.type, stored.data ?? {}, current);
        if (tool) await runtime.capture?.agentTool({ ...tool, traceSeq: stored.sequence });
        if (event.type === "question.asked") await questionManager!.asked(event.data as unknown as AgentQuestion);
        if (["question.replied", "question.rejected"].includes(event.type)) await questionManager!.closed(String(event.data.requestID));
        const writes = await ledger.record(projectId, runId, runtime.project.workspacePath, event.data);
        if (writes?.length) {
          await appendTrace(projectId, runId, { type: "agent_write", data: { files: writes } });
          await updateRun(projectId, runId, { fileChanges: await collectChanges() });
        }
        if (event.type !== "message.part.delta" || Date.now() - lastPublished >= 150) { lastPublished = Date.now(); await updateRun(projectId, runId, { activity: progress.snapshot() }); }
      });
      phase = "first-request";
      const result = await runWithTimeout(options.runtime.run({ workspacePath: runtime.project.workspacePath, sessionId: runtimeSessionId, prompt, system: context?.toolSystem, model: run.model }), options.runTimeoutMs, () => options.runtime.cancel({ workspacePath: runtime.project.workspacePath, sessionId: runtimeSessionId! }), approval);
      observedUsage.addResult(result.usage, result.messageId);
      await stopEvents(); stopEvents = undefined;
      if ((await store.get(runId))?.status === "cancelled") return;
      const fileChanges = await collectChanges(result.messageId);
      await appendTrace(projectId, runId, { type: "file_changes", summary: `${fileChanges.length} files changed`, data: { files: fileChanges } });
      await appendTrace(projectId, runId, { type: "assistant_message", summary: result.text, data: { text: result.text } });
      await recordUsage(run);
      const finishedAt = new Date().toISOString();
      await captureFinished(projectId, { ...run, status: "completed", output: result.text, fileChanges, finishedAt });
      captureRecorded = true;
      if (!await updateRunIfStatus(projectId, runId, "running", { status: "completed", output: result.text, fileChanges, activity: progress.snapshot(), finishedAt })) return;
      if (current.source === "chat" && session.scope === "team") await runtime.chat.createMessage({ roomId: runtime.room.id, authorId: "agent", authorName: session.handle ?? session.title, kind: "agent", agentSessionId: session.id, runId, text: result.text });
      appendActivity(projectId, { type: "agent_task_completed", memberId: current.memberId, participantId: current.participantId, payload: { runId, sessionId: session.id, name: current.memberName, files: fileChanges } });
      await appendTrace(projectId, runId, { type: "run_completed", summary: "Agent run completed", data: { overlappingRunIds: [...(overlaps.get(runId) ?? [])] } });
    } catch (error) {
      const failedRun = await store.get(runId);
      if (failedRun && ["queued", "running"].includes(failedRun.status)) {
        const failure = diagnoseAgentFailure(error, phase, sequence, options.sensitiveValues);
        if (!await updateRunIfStatus(projectId, runId, failedRun.status, { status: "failed", error: failure.message, failure, activity: progress.snapshot(), finishedAt: new Date().toISOString() })) return;
        await appendTrace(projectId, runId, { type: "run_failed", summary: failure.message, data: failure as unknown as Record<string, unknown> });
        appendActivity(projectId, { type: "agent_task_failed", memberId: current.memberId, participantId: current.participantId, payload: { runId, sessionId: current.sessionId, name: current.memberName, error: failure.message } });
        if (current.source === "chat" && current.sessionId) {
          const session = await getSessionStore(projectId).get(current.sessionId);
          if (session?.scope === "team") await runtime.chat.createMessage({ roomId: runtime.room.id, authorId: "agent", authorName: "System", kind: "system", agentSessionId: session.id, runId, text: `Team Agent task failed: ${failure.message}` });
        }
      }
    } finally {
      try {
        const final = await store.get(runId);
        const cancellation = cancellations.get(runId);
        if (cancellation) await cancellation;
        else if (runtimeSessionId && final?.status === "failed") await options.runtime.cancel({ workspacePath: runtime.project.workspacePath, sessionId: runtimeSessionId });
      } finally {
        try { await stopEvents?.(); } finally {
          try {
            await questionManager?.dispose();
            if (snapshot && (await store.get(runId))?.status !== "completed") await updateRun(projectId, runId, { fileChanges: await collectChanges(), activity: progress.snapshot() });
            const finished = await store.get(runId);
            if (finished) await recordUsage(finished);
            if (finished && !captureRecorded && ["completed", "failed", "cancelled"].includes(finished.status)) await captureFinished(projectId, finished);
          } finally { questions.delete(runId); activeRuns.delete(runId); }
        }
      }
    }
  }

  const manager = {
    requestAgentSelfRecap: knowledge.requestAgentSelfRecap,
    async awaitRunIdle(projectId: string, runId: string) {
      const run = await getStore(projectId).get(runId);
      if (!run) throw new Error("Agent run not found");
      if (!["completed", "failed", "cancelled"].includes(run.status)) throw new Error("Agent run must finish before awaiting idle");
      await runtimeOperations.run(`${projectId}:${run.sessionId ?? run.id}`, async () => {});
      return getStore(projectId).get(runId);
    },
    async initialize() {
      for (const project of await options.registry.listProjects()) {
        knowledge.bind(project.id);
        await migrateLegacyAgentSessions(project.id, getStore(project.id), getSessionStore(project.id), new Set((await options.members.listMembers(project.id)).map((member) => member.memberId)));
        for (const run of await getStore(project.id).list()) {
          if (!["queued", "running"].includes(run.status)) continue;
          const failure = diagnoseAgentFailure(new Error("服务端重启中断了任务。"), run.activity?.phase ?? "creating-session", (await getTrace(project.id, run.id).list()).at(-1)?.sequence ?? 0, options.sensitiveValues);
          failure.retryable = true; failure.guidance = "服务重启中断了任务，已完成的文件修改继续保留，可以重试。";
          const failed = await updateRun(project.id, run.id, { status: "failed", error: failure.message, failure, questions: [], finishedAt: new Date().toISOString() });
          await appendTrace(project.id, run.id, { type: "run_failed", summary: failure.message, data: failure as unknown as Record<string, unknown> });
          await knowledge.postCheck(project.id, failed);
        }
        await ensureDefaultTeamAgent(project.id);
      }
    },
    async createRun(input: { projectId: string; memberId: string; prompt: string; contexts?: AgentPromptContext[]; sessionId?: string; source?: AgentRun["source"]; chatMessageId?: string; extraPrompt?: string; interruptsRunId?: string; runId?: string; initiatorRole?: string; interrupt?: boolean; knowledge?: AgentRun["knowledge"] }) {
      if (disposing || getQueue(input.projectId).closing) throw new Error("Agent manager is closing");
      const settings = options.getSettings();
      if (!settings.enabled) throw new Error("Agent is disabled");
      if (!settings.apiKeyConfigured) throw new Error(`${settings.provider === "minimax" ? "MINIMAX_API_KEY" : "DEEPSEEK_API_KEY"} is required`);
      const prompt = input.prompt.trim(); if (!prompt) throw new Error("Agent prompt is required");
      const member = requireMember(input.projectId, input.memberId);
      knowledge.bind(input.projectId);
      const session = input.sessionId ? await manager.getSessionForMember(input.projectId, input.sessionId, input.memberId) : await manager.createSession({ projectId: input.projectId, memberId: input.memberId, title: prompt.slice(0, 80) });
      return withLock(sessionOperations, `${input.projectId}:${session.id}`, async () => {
        if ((await getSessionStore(input.projectId).get(session.id))?.deletedAt) throw new Error("Agent session has been deleted");
        const runId = input.runId ?? nanoid(12);
        const active = (await getStore(input.projectId).list()).filter((run) => run.sessionId === session.id && ["queued", "running"].includes(run.status));
        for (const previous of active) await manager.cancelRun(input.projectId, previous.id, input.memberId, { runId, memberId: input.memberId });
        const run = await getStore(input.projectId).create({ projectId: input.projectId, memberId: input.memberId, initiatorMemberId: input.memberId, initiatorRole: input.initiatorRole, participantId: member.participantId, memberName: member.displayName, prompt, contexts: normalizeAgentContexts(input.contexts), sessionId: session.id, sessionScope: session.scope ?? "personal", runtimeSessionId: session.runtimeSessionId, status: "queued", runtime: "opencode", provider: settings.provider, model: settings.model, source: input.source ?? "agent-panel", chatMessageId: input.chatMessageId, extraPrompt: input.extraPrompt, interruptsRunId: active.at(-1)?.id ?? input.interruptsRunId, knowledge: input.knowledge }, runId);
        emit({ type: "run_updated", projectId: input.projectId, run });
        await appendTrace(input.projectId, run.id, { type: "run_queued", summary: "Agent run queued" });
        getQueue(input.projectId).runIds.push(run.id); void scheduler.processQueue(input.projectId);
        return run;
      });
    },
    async createSession(input: { projectId: string; memberId: string; title?: string }) {
      const member = requireMember(input.projectId, input.memberId);
      return getSessionStore(input.projectId).create({ projectId: input.projectId, memberId: input.memberId, participantId: member.participantId, memberName: member.displayName, title: input.title?.trim() || "New Agent session", runtime: "opencode" });
    },
    async listTeamAgents(projectId: string) { await ensureDefaultTeamAgent(projectId); return getSessionStore(projectId).list(undefined, "team"); },
    async createTeamAgent(input: { projectId: string; memberId: string; name: string; description?: string }) {
      requireMember(input.projectId, input.memberId);
      const handle = normalizeHandle(input.name); validateHandle(handle); await ensureDefaultTeamAgent(input.projectId);
      return withLock(teamOperations, input.projectId, async () => {
        const store = getSessionStore(input.projectId);
        if (await store.findByHandle(handle)) throw new Error(`Team Agent handle already exists: ${handle}`);
        const session = await store.create({ projectId: input.projectId, memberId: "", scope: "team", handle, title: handle, description: input.description?.trim(), createdByMemberId: input.memberId, runtime: "opencode" });
        emit({ type: "team_agents_changed", projectId: input.projectId, agents: await store.list(undefined, "team") }); return session;
      });
    },
    async getSession(projectId: string, sessionId: string) {
      const session = await getSessionStore(projectId).get(sessionId);
      if (!session || session.deletedAt) throw new Error("Agent session not found"); return session;
    },
    async getSessionForMember(projectId: string, sessionId: string, memberId: string) {
      requireMember(projectId, memberId); const session = await manager.getSession(projectId, sessionId);
      if (session.scope !== "team" && session.memberId !== memberId) throw new Error("Agent session belongs to another participant"); return session;
    },
    async listSessions(projectId: string, memberId: string) { requireMember(projectId, memberId); return getSessionStore(projectId).list(memberId, "personal"); },
    async deleteSession(projectId: string, sessionId: string, memberId: string) {
      return withLock(sessionOperations, `${projectId}:${sessionId}`, async () => {
        const session = await manager.getSessionForMember(projectId, sessionId, memberId);
        if (session.scope === "team") throw new Error("Only personal sessions can be deleted here");
        for (const run of await getStore(projectId).list()) if (run.sessionId === sessionId && ["queued", "running"].includes(run.status)) await manager.cancelRun(projectId, run.id, memberId);
        await runtimeOperations.run(`${projectId}:${sessionId}`, async () => { await getSessionStore(projectId).update(sessionId, { deletedAt: new Date().toISOString() }); });
      });
    },
    async getRun(projectId: string, runId: string) { const run = await getStore(projectId).get(runId); if (!run) throw new Error("Agent run not found"); return run; },
    async listRuns(projectId: string, memberId?: string) { return (await getStore(projectId).list()).filter((run) => !memberId || canReadAgentRun(run, memberId)); },
    async listVisibleRuns(projectId: string, memberId: string) {
      requireMember(projectId, memberId);
      const visible = await manager.listRuns(projectId, memberId);
      const sessions = await Promise.all(visible.map((run) => run.sessionId ? getSessionStore(projectId).get(run.sessionId) : undefined));
      return visible.filter((_run, index) => !sessions[index]?.deletedAt);
    },
    async retryRun(projectId: string, runId: string, memberId: string) {
      const previous = await manager.getRun(projectId, runId);
      if (previous.memberId !== memberId) throw new Error("Only the task initiator can retry");
      if (previous.status !== "failed" || !previous.failure?.retryable) throw new Error("This task cannot be retried");
      const runtime = options.runtimeManager.get(projectId);
      const member = requireMember(projectId, memberId);
      const message = previous.source === "chat" ? await runtime.chat.createMessage({ roomId: runtime.room.id, authorId: memberId, authorName: member.displayName, authorRole: member.profileRole, text: previous.prompt }) : undefined;
      const run = await manager.createRun({ projectId, memberId, prompt: previous.prompt, contexts: previous.contexts, sessionId: previous.sessionId, source: previous.source, chatMessageId: message?.id, extraPrompt: previous.extraPrompt, knowledge: previous.knowledge });
      if (message) await runtime.chat.updateMessage(message.id, { runId: run.id, agentSessionId: run.sessionId });
      await appendTrace(projectId, run.id, { type: "run_retried", data: { previousRunId: previous.id } });
      return run;
    },
    async listTrace(projectId: string, runId: string) { await manager.getRun(projectId, runId); return getTrace(projectId, runId).list(); },
    async answerQuestion(projectId: string, runId: string, memberId: string, requestId: string, answers?: string[][]) {
      const run = await manager.getRun(projectId, runId);
      if (run.memberId !== memberId) throw new Error("Only the task initiator can answer");
      const pending = questions.get(runId); if (!pending || run.status !== "running") throw new Error("该问题已经处理");
      return pending.answer(requestId, answers);
    },
    cancelRun(projectId: string, runId: string, memberId: string, interruptedBy?: { runId: string; memberId: string }) {
      const existing = cancellations.get(runId);
      if (existing) return existing;
      const cancellation = cancelRun(projectId, runId, memberId, interruptedBy);
      cancellations.set(runId, cancellation);
      void cancellation.then(() => cancellations.delete(runId), () => cancellations.delete(runId));
      return cancellation;
    },
    onEvent(listener: (event: AgentRunManagerEvent) => void) { listeners.add(listener); return () => listeners.delete(listener); },
    hasActiveTasks() { return knowledge.hasActiveTasks() || [...queues.values()].some((queue) => queue.activeRunIds.size || queue.runIds.length); },
    getWriteLedger(projectId: string, runId: string) { return ledger.list(projectId, runId); },
    async disposeProject(projectId: string) {
      const queue = getQueue(projectId); queue.closing = true;
      for (const run of await getStore(projectId).list()) if (["queued", "running"].includes(run.status)) await manager.cancelRun(projectId, run.id, run.memberId);
      await knowledge.disposeProject(projectId);
      await queue.completion; await Promise.all(queue.runningPromises);
      ledger.clearProject(projectId); queues.delete(projectId); stores.delete(projectId); sessionStores.delete(projectId);
      for (const key of traces.keys()) if (key.startsWith(`${projectId}:`)) traces.delete(key);
    },
    async dispose() { disposing = true; for (const projectId of queues.keys()) await manager.disposeProject(projectId); listeners.clear(); }
  };
  async function cancelRun(projectId: string, runId: string, memberId: string, interruptedBy?: { runId: string; memberId: string }) {
    requireMember(projectId, memberId); const run = await manager.getRun(projectId, runId);
    if (!canReadAgentRun(run, memberId)) throw new Error("Agent run belongs to another participant");
    if (["completed", "failed", "cancelled"].includes(run.status)) return run;
    getQueue(projectId).runIds = getQueue(projectId).runIds.filter((id) => id !== runId);
    const cancelled = await updateRunIfStatus(projectId, runId, run.status, { status: "cancelled", finishedAt: new Date().toISOString(), interruptedByRunId: interruptedBy?.runId, interruptedByMemberId: interruptedBy?.memberId });
    if (!cancelled) return manager.getRun(projectId, runId);
    await appendTrace(projectId, runId, { type: interruptedBy ? "run_interrupted" : "run_cancelled", summary: interruptedBy ? "Agent run interrupted" : "Agent run cancelled", data: interruptedBy ? { interruptedByRunId: interruptedBy.runId, interruptedByMemberId: interruptedBy.memberId } : undefined });
    const active = activeRuns.get(runId);
    if (active) await options.runtime.cancel({ workspacePath: active.workspacePath, sessionId: active.runtimeSessionId });
    await questions.get(runId)?.dispose();
    appendActivity(projectId, { type: "agent_task_cancelled", memberId: run.memberId, participantId: run.participantId, payload: { runId, sessionId: run.sessionId, name: run.memberName, reason: interruptedBy ? "interrupted" : "cancelled" } });
    if (!getQueue(projectId).activeRunIds.has(runId)) await captureFinished(projectId, cancelled);
    return cancelled;
  }
  return manager;
}
export type AgentRunManager = ReturnType<typeof createAgentRunManager>;
