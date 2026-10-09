import path from "node:path";
import type {
  AgentRun,
  AgentSettingsResponse,
  AgentSession,
  AgentTraceEvent,
  AgentPromptContext,
  EventRecord
} from "@simplercp/shared";
import type { AgentQuestion } from "@simplercp/shared";
import { createAgentQuestions } from "./agentQuestions.js";
import { canReadAgentRun } from "./agentVisibility.js";
import type { AgentRuntime } from "./agentRuntime.js";
import { createAgentRunStore, type AgentRunStore } from "./agentRunStore.js";
import {
  createAgentSessionStore,
  type AgentSessionStore
} from "./agentSessionStore.js";
import { createTraceStore, redactSensitive, type TraceStore } from "./traceStore.js";
import { getProjectMetadataPath, type ProjectRegistry } from "../projects.js";
import type { ProjectRuntimeManager } from "../projectRuntimeManager.js";
import {
  compareAgentWorkspaceSnapshots,
  createAgentWorkspaceSnapshot
} from "./agentWorkspaceSnapshot.js";
import {
  buildRuntimePrompt,
  normalizeAgentContexts,
  previewPrompt,
  runWithTimeout,
  createApprovalBudget
} from "./agentRunSupport.js";
import { migrateLegacyAgentSessions } from "./agentSessionAccess.js";
import type { MemberStore } from "../auth/identity.js";
import { normalizeHandle, validateHandle } from "./teamAgentSupport.js";
import { createAgentWriteLedger, hasUnattributedPatch, type AgentWriteLedger } from "./agentWriteLedger.js";
import { selectRunnableAgentRun } from "./agentRunSelection.js";
import { createPermissionDispatcher, type AgentPermissionRequest } from "./permissionDispatcher.js";
import { conflictGuardEditHandler } from "./conflictGuardEditHandler.js";
import fs from "node:fs/promises";
import { agentPlanInstruction } from "@simplercp/conflict-guard";
import { canonicalWorkspacePath } from "../workspacePath.js";
import { createAgentProgress } from "./agentProgress.js";
import { AgentRuntimeRequestError, diagnoseAgentFailure } from "./agentRunFailure.js";
import type { AgentRunPhase } from "@simplercp/shared";
import {
  createAgentScheduler,
  getCompletedOverlapGroup,
  type AgentSchedulerQueue
} from "./agentScheduler.js";

interface AgentRunManagerOptions {
  members: MemberStore;
  runtime: AgentRuntime;
  registry: ProjectRegistry;
  runtimeManager: ProjectRuntimeManager;
  getSettings(): AgentSettingsResponse;
  apiKey?: string;
  sensitiveValues?: string[];
  runTimeoutMs: number;
  maxConcurrentRuns: number;
  activityConfig?: { waitingMs: number; stalledMs: number };
  appendActivity?: (
    projectId: string,
    input: Omit<EventRecord, "id" | "timestamp">
  ) => EventRecord;
}

interface ActiveRun {
  workspacePath: string;
  runtimeSessionId: string;
  cancelPermissions?: () => void;
  questions?: ReturnType<typeof createAgentQuestions>;
}

export type AgentRunManagerEvent =
  | { type: "run_updated"; projectId: string; run: AgentRun }
  | { type: "activity_appended"; projectId: string; event: EventRecord }
  | {
      type: "trace_appended";
      projectId: string;
      runId: string;
      event: AgentTraceEvent;
      memberId: string;
      shared: boolean;
    }
  | { type: "team_agents_changed"; projectId: string; agents: AgentSession[] };

function buildInterruptionPrompt(
  interruptedRun: AgentRun,
  nextRun: AgentRun,
  members: Array<{ id: string; displayName: string }>
) {
  const interruptedBy = members.find((member) => member.id === nextRun.memberId)?.displayName
    ?? nextRun.memberName
    ?? nextRun.memberId;
  const files = interruptedRun.fileChanges?.map((change) => change.file) ?? [];
  return [
    `The previous task from ${interruptedRun.memberName ?? interruptedRun.memberId} was interrupted by ${interruptedBy}. Continue from the current workspace state.`,
    `Files changed before interruption: ${files.length ? files.join(", ") : "none"}.`
  ].join(" ");
}

export function createAgentRunManager(options: AgentRunManagerOptions) {
  const stores = new Map<string, AgentRunStore>();
  const sessionStores = new Map<string, AgentSessionStore>();
  const traces = new Map<string, TraceStore>();
  const queues = new Map<string, AgentSchedulerQueue>();
  const activeRuns = new Map<string, ActiveRun>();
  const guardRuns = new Set<string>();
  const writeLedger: AgentWriteLedger = createAgentWriteLedger();
  const runConcurrentIds = new Map<string, Set<string>>();
  const runOverlapIds = new Map<string, Set<string>>();
  const cancelCompletionRecorded = new Set<string>();
  const cancelRequested = new Set<string>();
  const recordedOverlaps = new Set<string>();
  const teamAgentOperations = new Map<string, Promise<unknown>>();
  const sessionOperations = new Map<string, Promise<unknown>>();
  const listeners = new Set<(event: AgentRunManagerEvent) => void>();
  const failures = { trace: 0, attribution: 0, listener: 0 };
  let lastInternalError: { projectId: string; runId: string; phase: keyof typeof failures; reason: string } | undefined;
  let disposing = false;
  let scheduler: ReturnType<typeof createAgentScheduler>;

  function getStore(projectId: string) {
    const existing = stores.get(projectId);
    if (existing) return existing;
    const project = options.registry.getProject(projectId);
    if (!project) throw new Error("Project not found");
    const store = createAgentRunStore(projectId, getProjectMetadataPath(project));
    stores.set(projectId, store);
    return store;
  }

  function getTrace(projectId: string, runId: string) {
    const key = `${projectId}:${runId}`;
    const existing = traces.get(key);
    if (existing) return existing;
    const store = getStore(projectId);
    const trace = createTraceStore(
      path.join(store.runsRoot, runId, "trace.jsonl"),
      options.sensitiveValues ?? (options.apiKey ? [options.apiKey] : [])
    );
    traces.set(key, trace);
    return trace;
  }

  function getSessionStore(projectId: string) {
    const existing = sessionStores.get(projectId);
    if (existing) return existing;
    const project = options.registry.getProject(projectId);
    if (!project) throw new Error("Project not found");
    const store = createAgentSessionStore(projectId, getProjectMetadataPath(project));
    sessionStores.set(projectId, store);
    return store;
  }

  function getQueue(projectId: string) {
    const existing = queues.get(projectId);
    if (existing) return existing;
    const queue: AgentSchedulerQueue = {
      runIds: [],
      processing: false,
      activeRunIds: new Set(),
      activeSessionIds: new Set(),
      runningPromises: new Set(),
      workspacePreparing: false,
      rescanRequested: false,
      closing: false
    };
    queues.set(projectId, queue);
    return queue;
  }

  function emit(event: AgentRunManagerEvent) {
    for (const listener of listeners) {
      try {
        listener(event);
      } catch (error) {
        failures.listener += 1;
        console.error("Agent run event listener failed", error);
      }
    }
  }

  function recordInternalError(projectId: string, runId: string, phase: keyof typeof failures, error: unknown) {
    failures[phase] += 1;
    lastInternalError = { projectId, runId, phase, reason: error instanceof Error ? error.message : String(error) };
    console.error(`Agent ${phase} failed for run ${runId}`, error);
  }

  async function recordAttributionError(projectId: string, runId: string, stage: string, error: unknown) {
    recordInternalError(projectId, runId, "attribution", error);
    await appendTrace(projectId, runId, { type: "attribution_error", summary: "Agent file attribution could not be completed", data: { stage, error: error instanceof Error ? error.message : String(error) } });
  }

  async function updateRun(
    projectId: string,
    runId: string,
    update: Partial<AgentRun>
  ) {
    const run = await getStore(projectId).update(runId, update);
    emit({ type: "run_updated", projectId, run });
    return run;
  }

  async function updateQueuedRun(
    projectId: string,
    runId: string,
    update: Partial<AgentRun>
  ) {
    const run = await getStore(projectId).updateIfStatus(runId, "queued", update);
    if (run) emit({ type: "run_updated", projectId, run });
    return run;
  }

  async function finishRunningRun(projectId: string, runId: string, update: Partial<AgentRun>) {
    const run = await getStore(projectId).updateIfStatus(runId, "running", update);
    if (run) emit({ type: "run_updated", projectId, run });
    else if ((await getStore(projectId).get(runId))?.status === "cancelled") await recordCancellationCompletion(projectId, runId);
    return run;
  }

  async function appendTrace(
    projectId: string,
    runId: string,
    input: Omit<AgentTraceEvent, "sequence" | "timestamp">
  ) {
    try {
      const event = await getTrace(projectId, runId).append(input);
      const run = await getStore(projectId).get(runId);
      if (run) emit({ type: "trace_appended", projectId, runId, event, memberId: run.memberId, shared: run.sessionScope === "team" || run.sessionScope === undefined && run.source === "chat" });
      return event;
    } catch (error) {
      recordInternalError(projectId, runId, "trace", error);
      return undefined;
    }
  }

  function appendActivity(
    projectId: string,
    input: Omit<EventRecord, "id" | "timestamp">
  ) {
    if (!options.appendActivity) return;
    const event = options.appendActivity(projectId, input);
    emit({ type: "activity_appended", projectId, event });
  }

  async function withTeamAgentLock<T>(projectId: string, operation: () => Promise<T>) {
    const previous = teamAgentOperations.get(projectId) ?? Promise.resolve();
    const current = previous.then(operation);
    teamAgentOperations.set(projectId, current.then(() => undefined, () => undefined));
    return current;
  }

  async function withSessionLock<T>(key: string, operation: () => Promise<T>) {
    const previous = sessionOperations.get(key) ?? Promise.resolve();
    const current = previous.then(operation);
    const settled = current.then(() => undefined, () => undefined);
    sessionOperations.set(key, settled);
    void settled.then(() => { if (sessionOperations.get(key) === settled) sessionOperations.delete(key); });
    return current;
  }

  async function listTeamAgentsWithoutEnsuring(projectId: string) {
    return getSessionStore(projectId).list(undefined, "team");
  }

  async function ensureDefaultTeamAgent(projectId: string) {
    await withTeamAgentLock(projectId, async () => {
      const store = getSessionStore(projectId);
      const existing = await store.findByHandle("agent");
      if (existing) return;
      const agent = await store.create({
        projectId,
        memberId: "",
        scope: "team",
        handle: "agent",
        description: "Shared agent for the whole team",
        title: "agent",
        runtime: "opencode"
      });
      emit({
        type: "team_agents_changed",
        projectId,
        agents: await listTeamAgentsWithoutEnsuring(projectId)
      });
    });
  }

  async function migrateLegacySessions(projectId: string) {
    await migrateLegacyAgentSessions(
      projectId,
      getStore(projectId),
      getSessionStore(projectId),
      new Set((await options.members.listMembers(projectId)).map((member) => member.memberId))
    );
  }

  function processQueue(projectId: string) {
    return scheduler.processQueue(projectId);
  }

  async function findRunnableRun(projectId: string, queue: AgentSchedulerQueue) {
    return selectRunnableAgentRun({ queue, runs: getStore(projectId), sessions: getSessionStore(projectId), workspacePath: options.runtimeManager.get(projectId).project.workspacePath });
  }

  async function recordFinishedFileChanges(
    projectId: string,
    runId: string,
    workspacePath: string,
    runtimeSessionId: string,
    workspaceBefore: Awaited<ReturnType<typeof createAgentWorkspaceSnapshot>> | undefined,
    revisionsBefore: Map<string, number>,
    messageId?: string
  ) {
    try {
    let workspaceChanges: NonNullable<AgentRun["fileChanges"]> = [];
    let workspaceAfter: Awaited<ReturnType<typeof createAgentWorkspaceSnapshot>> | undefined;
    if (workspaceBefore) {
      try {
        workspaceAfter = await createAgentWorkspaceSnapshot(workspacePath);
        workspaceChanges = compareAgentWorkspaceSnapshots(workspaceBefore, workspaceAfter);
      } catch (error) {
        await recordAttributionError(projectId, runId, "workspace_after", error);
      }
    }
    const sessionFiles = new Set<string>();
    try {
      const runtimeChanges = await options.runtime.getDiff({ workspacePath, sessionId: runtimeSessionId, messageId });
      if (messageId) for (const change of runtimeChanges) sessionFiles.add(change.file);
      await appendTrace(projectId, runId, {
        type: "session_diff_observed",
        summary: "Runtime session diff observed",
        data: { files: runtimeChanges.map((change) => change.file), messageId: messageId ?? null }
      });
    } catch (error) {
      await appendTrace(projectId, runId, {
        type: "session_diff_observed",
        summary: "Runtime session diff could not be read",
        data: { files: [], messageId: messageId ?? null, error: error instanceof Error ? error.message : String(error) }
      });
    }
    const changes = workspaceChanges;
    const memberChangedFiles = new Set<string>();
    const documents = options.runtimeManager.get(projectId).documents;
    for (const change of changes) {
      const previousRevision = revisionsBefore.get(change.file) ?? 0;
      const currentRevision = documents.getRevision(change.file);
      if (currentRevision <= previousRevision) continue;
      memberChangedFiles.add(change.file);
      await appendTrace(projectId, runId, {
        type: "concurrent_change",
        summary: `${change.file} was edited by a member while the Agent was running`,
        data: { path: change.file, previousRevision, currentRevision }
      });
    }
    let fileChanges = await attributeFileChanges(
      projectId,
      runId,
      changes,
      runOverlapIds.get(runId) ?? new Set(),
      memberChangedFiles
    );
    await recordAgentOverlaps(projectId, runId);
    await updateRun(projectId, runId, { fileChanges });
    if (fileChanges.length > 0) {
      await appendTrace(projectId, runId, {
        type: "file_changes",
        summary: `${fileChanges.length} file${fileChanges.length === 1 ? "" : "s"} changed`,
        data: { files: fileChanges }
      });
    }
    if (guardRuns.delete(runId)) {
      try {
        const project = options.runtimeManager.get(projectId);
        const net = fileChanges.filter((change) => change.attribution !== "ambiguous" && !memberChangedFiles.has(change.file) && !(runOverlapIds.get(runId)?.size)).flatMap((change) => {
          const before = workspaceBefore?.get(change.file)?.content ?? "";
          const after = workspaceAfter?.get(change.file)?.content;
          return after === undefined && change.status !== "deleted" ? [] : [{ file: change.file, before, after: after ?? "", existedBefore: workspaceBefore?.has(change.file) ?? false, ...(change.status === "deleted" ? { deleted: true } : {}) }];
        });
        const checkedFiles = new Set(net.map((proposal) => proposal.file));
        const runFiles = new Set(writeLedger.list(projectId, runId).map((entry) => entry.file));
        const changedFiles = new Set([...runFiles, ...sessionFiles]);
        const unverified: Array<{ file?: string; reason: string }> = [...changedFiles].filter((file) => !checkedFiles.has(file)).map((file) => ({ file, reason: memberChangedFiles.has(file) ? "Member edits prevent exclusive snapshot attribution" : "Concurrent activity prevents exclusive snapshot attribution" }));
        if (!workspaceBefore || !workspaceAfter) unverified.push({ reason: "Run workspace snapshot could not be read" });
        const t3 = await project.conflictGuard?.agentGuard.finish(runId, net, (file, expected, text, owner, remove) => project.documents.applyGuardRevert(file, expected, text, owner, remove), unverified);
        const latest = await getStore(projectId).get(runId);
        await updateRun(projectId, runId, { conflictGuard: { rejectedEdits: 0, ...latest?.conflictGuard, t3, t3Executed: true } });
        await appendTrace(projectId, runId, { type: "t3_completed", data: { result: t3 } });
        if (workspaceBefore) {
          const finalSnapshot = await createAgentWorkspaceSnapshot(workspacePath);
          const runFiles = new Set([...fileChanges.map((change) => change.file), ...writeLedger.list(projectId, runId).map((entry) => entry.file)]);
          fileChanges = await attributeFileChanges(projectId, runId, compareAgentWorkspaceSnapshots(workspaceBefore, finalSnapshot).filter((change) => runFiles.has(change.file)), runOverlapIds.get(runId) ?? new Set(), memberChangedFiles);
          await updateRun(projectId, runId, { fileChanges });
        }
      } catch (error) {
        const latest = await getStore(projectId).get(runId);
        await updateRun(projectId, runId, { conflictGuard: { rejectedEdits: 0, ...latest?.conflictGuard, t3Executed: false, t3Error: error instanceof Error ? error.message : String(error) } });
        await appendTrace(projectId, runId, { type: "t3_error", summary: error instanceof Error ? error.message : String(error) });
      }
    }
    return fileChanges;
    } catch (error) {
      await recordAttributionError(projectId, runId, "file_changes", error);
      return [];
    }
  }

  async function attributeFileChanges(
    projectId: string,
    runId: string,
    changes: AgentRun["fileChanges"],
    concurrentRunIds: Set<string>,
    memberChangedFiles = new Set<string>()
  ) {
    const result = writeLedger.attribute(projectId, runId, changes ?? [], concurrentRunIds, memberChangedFiles);
    for (const change of result) {
      if (change.attribution !== "ambiguous") continue;
      await appendTrace(projectId, runId, {
        type: "unattributed_change",
        summary: `${change.file} changed while other activity was present`,
        data: { file: change.file, concurrentRunIds: [...concurrentRunIds] }
      });
    }
    return result;
  }

  async function recordAgentOverlaps(projectId: string, runId: string) {
    const ownEntries = writeLedger.list(projectId, runId);
    if (ownEntries.length === 0) return;
    const ownFiles = new Set(ownEntries.map((entry) => entry.file));
    for (const otherRunId of runOverlapIds.get(runId) ?? []) {
      const entries = writeLedger.list(projectId, otherRunId);
      for (const other of entries) {
        if (!ownFiles.has(other.file)) continue;
        const own = ownEntries.find((entry) => entry.file === other.file);
        if (!own) continue;
        const overlapKey = [runId, otherRunId].sort().join(":") + `:${other.file}`;
        if (recordedOverlaps.has(overlapKey)) continue;
        recordedOverlaps.add(overlapKey);
        await appendTrace(projectId, runId, {
          type: "agent_overlap",
          summary: `${other.file} was written by another Agent run`,
          data: {
            file: other.file,
            otherRunId,
            thisCompletedAt: own.completedAt,
            otherCompletedAt: other.completedAt
          }
        });
        await appendTrace(projectId, otherRunId, {
          type: "agent_overlap",
          summary: `${other.file} was written by another Agent run`,
          data: {
            file: other.file,
            otherRunId: runId,
            thisCompletedAt: other.completedAt,
            otherCompletedAt: own.completedAt
          }
        });
      }
    }
  }

  async function recordCancellationCompletion(projectId: string, runId: string) {
    if (cancelCompletionRecorded.has(runId)) return;
    cancelCompletionRecorded.add(runId);
    await appendTrace(projectId, runId, {
      type: "run_cancelled",
      summary: "Agent run cancellation completed",
      data: { overlappingRunIds: [...(runOverlapIds.get(runId) ?? [])] }
    });
  }

  function cleanupOverlapEntries(projectId: string, runId: string) {
    const connectedRunIds = getCompletedOverlapGroup(runId, runOverlapIds, getQueue(projectId).activeRunIds);
    for (const id of connectedRunIds) {
      writeLedger.clear(projectId, id);
      runOverlapIds.delete(id);
      cancelCompletionRecorded.delete(id);
      for (const key of recordedOverlaps) if (key.startsWith(`${id}:`) || key.includes(`:${id}:`)) recordedOverlaps.delete(key);
    }
  }

  async function executeRun(projectId: string, runId: string) {
    const store = getStore(projectId);
    const current = await store.get(runId);
    if (!current || current.status !== "queued") return;
    if (cancelRequested.delete(runId)) return;
    let workspacePathForRun: string | undefined;
    let runtimeSessionIdForRun: string | undefined;
    let workspaceBeforeForRun: Awaited<ReturnType<typeof createAgentWorkspaceSnapshot>> | undefined;
    let revisionsBeforeForRun: Map<string, number> | undefined;
    let stopGuardEvents: (() => void) | undefined;
    let stopRuntimeEvents: (() => Promise<void>) | undefined;
    let drainPermissions: (() => Promise<void>) | undefined;
    const continuationOutputs: string[] = [];
    let phase: AgentRunPhase = "creating-session";
    let lastSuccessfulSequence = 0;
    let progress: ReturnType<typeof createAgentProgress> | undefined;
    let progressTimer: ReturnType<typeof setTimeout> | undefined;
    let progressWrites = Promise.resolve();
    const saveProgress = () => {
      if (!progress) return;
      const activity = redactSensitive(progress.snapshot(), options.sensitiveValues) as AgentRun["activity"];
      progressWrites = progressWrites.then(async () => { await updateRun(projectId, runId, { activity, overlappingRunIds: [...(runOverlapIds.get(runId) ?? [])] }); }).catch((error) => recordInternalError(projectId, runId, "listener", error));
    };
    try {
      const projectRuntime = options.runtimeManager.get(projectId);
      workspacePathForRun = projectRuntime.project.workspacePath;
      await projectRuntime.documents.awaitIdle();
      const session = current.sessionId
        ? await getSessionStore(projectId).get(current.sessionId)
        : undefined;
      if (!session) throw new Error("Agent session not found");
      const workspacePrepared = session.scope === "team"
        ? await options.runtime.prepareWorkspace?.(projectRuntime.project.workspacePath)
        : false;
      if (workspacePrepared) {
        getQueue(projectId).workspacePreparing = false;
        void processQueue(projectId);
      }
      if (workspacePrepared) {
        const sessions = await getSessionStore(projectId).list();
        const affectedSessionIds = new Set(
          sessions
            .filter((candidate) => candidate.scope === "team" && candidate.runtimeSessionId)
            .map((candidate) => candidate.id)
        );
        await Promise.all(
          sessions
            .filter((candidate) => affectedSessionIds.has(candidate.id))
            .map((candidate) => getSessionStore(projectId).update(candidate.id, { runtimeSessionId: undefined }))
        );
        const existingRuns = await getStore(projectId).list();
        await Promise.all(
          existingRuns
            .filter((candidate) => candidate.sessionId && affectedSessionIds.has(candidate.sessionId) && candidate.runtimeSessionId)
            .map((candidate) => updateRun(projectId, candidate.id, { runtimeSessionId: undefined }))
        );
        if (affectedSessionIds.size > 0) {
          appendActivity(projectId, {
            type: "agent_workspace_isolated",
            memberId: current.memberId,
            participantId: current.participantId,
            payload: {
              sessionIds: [...affectedSessionIds],
              reason: "Team Agent workspace now has an isolated Git repository"
            }
          });
        }
      }
      let workspaceBefore: Awaited<ReturnType<typeof createAgentWorkspaceSnapshot>> | undefined;
      try {
        workspaceBefore = await createAgentWorkspaceSnapshot(projectRuntime.project.workspacePath);
      } catch (error) {
        await recordAttributionError(projectId, runId, "workspace_before", error);
      }
      workspaceBeforeForRun = workspaceBefore;
      const revisionsBefore = projectRuntime.documents.getRevisions();
      revisionsBeforeForRun = revisionsBefore;
      const startedAt = new Date().toISOString();
      progress = createAgentProgress(startedAt, options.activityConfig);
      const concurrentRunIds = [...(runConcurrentIds.get(runId) ?? [])];
      const beforeRunning = await store.get(runId);
      if (!beforeRunning || beforeRunning.status === "cancelled") return;
      const runStarted = await updateQueuedRun(projectId, runId, {
        status: "running",
        startedAt,
        activity: progress.snapshot(),
        overlappingRunIds: [...(runOverlapIds.get(runId) ?? [])],
        model: options.runtime.getCurrentModel?.() ?? current.model
      });
      if (!runStarted) {
        cancelRequested.delete(runId);
        return;
      }
      let run = runStarted;
      if (projectRuntime.conflictGuard) {
        stopGuardEvents = projectRuntime.conflictGuard.agentGuard.onEvent((event) => {
          const actor = event.actor as { runId?: string } | undefined;
          const pair = event.pair as { left?: { actor?: { runId?: string } }; right?: { actor?: { runId?: string } } } | undefined;
          if (actor?.runId === runId || pair?.left?.actor?.runId === runId || pair?.right?.actor?.runId === runId) void appendTrace(projectId, runId, { type: String(event.type), data: event });
        });
        projectRuntime.conflictGuard.beginAgentRun({ kind: "agent", runId, ownerId: run.memberId, ...(session.scope === "team" ? { teamAgent: session.handle ?? session.title } : {}) }, new Map([...(workspaceBefore ?? [])].flatMap(([file, snapshot]) => snapshot.content === undefined ? [] : [[file, snapshot.content] as const])));
        guardRuns.add(runId);
      }
      if (workspacePrepared && run.runtimeSessionId) run = await updateRun(projectId, runId, { runtimeSessionId: undefined });
      await appendTrace(projectId, runId, {
        type: "run_started",
        summary: "Agent run started",
        data: { concurrentRunIds }
      });

      let runtimeSessionId = workspacePrepared ? undefined : run.runtimeSessionId ?? session.runtimeSessionId;
      if (!runtimeSessionId) {
        const session = await options.runtime.createSession({
          workspacePath: projectRuntime.project.workspacePath,
          title: run.prompt.slice(0, 80)
        });
        runtimeSessionId = session.id;
        await getSessionStore(projectId).update(run.sessionId!, {
          runtimeSessionId,
          lastRunId: run.id
        });
        run = await updateRun(projectId, runId, { runtimeSessionId });
        await appendTrace(projectId, runId, {
          type: "session_created",
          summary: "OpenCode session created",
          data: { sessionId: runtimeSessionId }
        });
      } else {
        await getSessionStore(projectId).update(run.sessionId!, { lastRunId: run.id });
      }
      runtimeSessionIdForRun = runtimeSessionId;
      phase = "first-request";

      appendActivity(projectId, {
        type: "agent_task_started",
        memberId: run.memberId,
        participantId: run.participantId,
        payload: {
          runId: run.id,
          sessionId: run.sessionId,
          sessionTitle: session.title,
          name: run.memberName,
          promptPreview: previewPrompt(run.prompt)
        }
      });

      activeRuns.set(runId, {
        workspacePath: projectRuntime.project.workspacePath,
        runtimeSessionId
      });
      const cancellationAfterActivation = await store.get(runId);
      if (cancellationAfterActivation?.status === "cancelled" || cancelRequested.delete(runId)) {
        await options.runtime.cancel({ workspacePath: projectRuntime.project.workspacePath, sessionId: runtimeSessionId });
        await recordFinishedFileChanges(projectId, runId, projectRuntime.project.workspacePath, runtimeSessionId, workspaceBefore, revisionsBefore);
        await recordCancellationCompletion(projectId, runId);
        return;
      }

      const previousRun = run.interruptsRunId
        ? await store.get(run.interruptsRunId)
        : undefined;
      const interruptionPrompt = previousRun
        ? buildInterruptionPrompt(previousRun, run, projectRuntime.room.members)
        : undefined;
      let runtimePrompt = await buildRuntimePrompt(
        projectRuntime.project.workspacePath,
        [interruptionPrompt, run.extraPrompt, projectRuntime.conflictGuard ? agentPlanInstruction : undefined, projectRuntime.conflictGuard?.arbitration.injection(runId, run.contexts?.flatMap((context) => projectRuntime.conflictGuard?.semanticIndex.symbolsInFile(context.path).map((symbol) => symbol.key) ?? [])), run.prompt].filter(Boolean).join("\n\n"),
        run.contexts,
        projectRuntime.project.name
      );
      await options.runtime.prepareRun?.({
        workspacePath: projectRuntime.project.workspacePath,
        sessionId: runtimeSessionId,
        runPrompt: run.prompt
      });

      const approval = createApprovalBudget();
      const questions = createAgentQuestions({
        pause: approval.pause,
        async reply(requestId, answers, signal) {
          if (!options.runtime.replyQuestion) throw new Error("Runtime does not support question replies");
          await options.runtime.replyQuestion({ workspacePath: projectRuntime.project.workspacePath, requestId, answers, signal });
          await appendTrace(projectId, runId, { type: "question_answered", data: { requestId } });
        },
        async reject(requestId, signal) {
          if (!options.runtime.rejectQuestion) throw new Error("Runtime does not support question rejection");
          await options.runtime.rejectQuestion({ workspacePath: projectRuntime.project.workspacePath, requestId, signal });
        },
        async abort(signal) { await options.runtime.cancel({ workspacePath: projectRuntime.project.workspacePath, sessionId: runtimeSessionId!, signal }); },
        async changed(pending) { progress?.syncQuestions(pending.map((question) => question.id)); saveProgress(); await updateRun(projectId, runId, { questions: pending }); },
        report(error) { recordInternalError(projectId, runId, "listener", error); }
      });
      activeRuns.get(runId)!.questions = questions;
      const guard = projectRuntime.conflictGuard;
      const toolInputs = new Map<string, { tool: string; input: Record<string, unknown> }>();
      const handlers = guard && ["rules", "full"].includes(guard.mode) ? [{ handle: conflictGuardEditHandler({
        workspace: projectRuntime.project.workspacePath,
        judge: (proposals, signal, request) => guard.arbitration.judge(runId, request, proposals, signal),
        rejectionContext: () => guard.arbitration.injection(runId),
        approved: () => {},
        async toolInput(request) {
          if (!request.tool) return undefined;
          const observed = toolInputs.get(request.tool.callID);
          return observed ?? await options.runtime.getToolInput?.({ workspacePath: projectRuntime.project.workspacePath, sessionId: request.sessionID, messageId: request.tool.messageID, callId: request.tool.callID });
        }
      }), budgetMs: null }] : [];
      const dispatcher = createPermissionDispatcher({ handlers, fileKey: (request) => canonicalWorkspacePath(projectRuntime.project.workspacePath, String(request.metadata.filepath ?? request.metadata.filePath ?? request.patterns?.[0] ?? ".")).relative, pause: approval.pause, unavailable: (file) => guard?.agentGuard.unavailable(runId, file), reply: async (reply) => {
        if (!options.runtime.replyPermission) throw new Error("Runtime does not support permission replies");
        await options.runtime.replyPermission({ workspacePath: projectRuntime.project.workspacePath, ...reply });
      }, trace: async (type, data) => {
        await appendTrace(projectId, runId, { type, data });
        if (type === "permission_reply") {
          progress?.resumed();
          saveProgress();
          const latest = await getStore(projectId).get(runId);
          await updateRun(projectId, runId, { conflictGuard: { rejectedEdits: 0, ...latest?.conflictGuard, ...(data.reply === "reject" ? { rejectedEdits: (latest?.conflictGuard?.rejectedEdits ?? 0) + 1, lastRejection: String(redactSensitive(data.message ?? "Edit rejected", options.sensitiveValues)), needsAttention: String(data.message ?? "").includes("停止修改该文件") } : {}), approvalWaitMs: approval.waitMs(), warnings: guard?.agentGuard.warnings(runId) } });
        }
      } });
      const active = activeRuns.get(runId);
      const intentController = new AbortController();
      if (active) active.cancelPermissions = () => { intentController.abort(); dispatcher.dispose(); };
      drainPermissions = dispatcher.drain;
      guard?.arbitration.attach(runId, { resolve: dispatcher.resolve, cancel: async () => {
        const latest = await store.get(runId);
        if (latest && ["completed", "failed", "cancelled"].includes(latest.status) && !activeRuns.has(runId)) {
          const t3 = await guard.agentGuard.withdraw(runId);
          const finalSnapshot = await createAgentWorkspaceSnapshot(projectRuntime.project.workspacePath);
          const previousChanges = new Map(latest.fileChanges?.map((change) => [change.file, change]));
          const fileChanges = workspaceBefore ? compareAgentWorkspaceSnapshots(workspaceBefore, finalSnapshot).filter((change) => previousChanges.has(change.file)).map((change) => ({ ...previousChanges.get(change.file)!, ...change })) : latest.fileChanges;
          await updateRun(projectId, runId, { fileChanges, conflictGuard: { rejectedEdits: 0, ...latest.conflictGuard, t3 } });
          guard.arbitration.finish(runId, t3 === "reverted" || t3 === "partially-reverted");
          return;
        }
        await updateRun(projectId, runId, { status: "cancelled", finishedAt: new Date().toISOString() });
        intentController.abort();
        dispatcher.dispose();
        await options.runtime.cancel({ workspacePath: projectRuntime.project.workspacePath, sessionId: runtimeSessionId! });
      }, continue: async (instruction) => {
        if ((await store.get(runId))?.status === "cancelled" || disposing) throw new Error("Agent 追加执行已经取消");
        const continued = await runWithTimeout(options.runtime.run({ workspacePath: projectRuntime.project.workspacePath, sessionId: runtimeSessionId!, prompt: instruction }), options.runTimeoutMs, () => options.runtime.cancel({ workspacePath: projectRuntime.project.workspacePath, sessionId: runtimeSessionId! }), approval);
        continuationOutputs.push(continued.text);
        await appendTrace(projectId, runId, { type: "arbitration_continuation", summary: continued.text, data: { messageId: continued.messageId } });
        await projectRuntime.documents.awaitIdle();
      } });
      const stopEvents = await options.runtime.subscribe(
        {
          workspacePath: projectRuntime.project.workspacePath,
          sessionId: runtimeSessionId
        },
        async (event) => {
          progress?.event(event, new Date().toISOString());
          phase = progress?.phase() ?? phase;
          if (progressTimer === undefined) progressTimer = setTimeout(() => { progressTimer = undefined; saveProgress(); }, 500);
          const part = event.data.part as { callID?: string; tool?: string; state?: { input?: Record<string, unknown> } } | undefined;
          const textPart = event.data.part as { id?: string; type?: string; text?: string } | undefined;
          const textId = textPart?.type === "text" ? textPart.id : event.type === "message.part.delta" && event.data.field === "text" && typeof event.data.partID === "string" ? event.data.partID : undefined;
          const text = textId ? progress?.assistantText(textId, runtimeSessionId!) : undefined;
          if (text !== undefined && (textPart?.type === "text" || text.includes("END_PLAN"))) guard?.arbitration.plan(runId, text);
          if (part?.callID && part.tool && part.state?.input) toolInputs.set(part.callID, { tool: part.tool, input: part.state.input });
          if (event.type === "permission.asked") {
            void dispatcher.dispatch(event.data as unknown as AgentPermissionRequest).catch((error) => recordInternalError(projectId, runId, "listener", error));
          }
          if (event.type === "question.asked") { await questions.asked(event.data as unknown as AgentQuestion); saveProgress(); }
          if (["question.replied", "question.rejected"].includes(event.type)) { await questions.closed(String(event.data.requestID)); progress?.resumed(); saveProgress(); }
          const recorded = await appendTrace(projectId, runId, {
            type: `opencode.${event.type}`,
            data: event.data
          });
          if (recorded) lastSuccessfulSequence = recorded.sequence;
          if (event.type === "permission.asked") {
            return;
          }
          if (hasUnattributedPatch(event.data)) {
            await appendTrace(projectId, runId, {
              type: "unattributed_change",
              summary: "Completed apply_patch event did not identify any file",
              data: { reason: "missing_patch_file_metadata" }
            });
          }
          const entries = await writeLedger.record(
            projectId,
            runId,
            projectRuntime.project.workspacePath,
            event.data
          );
          if (entries) {
            const currentFiles = new Map((await store.get(runId))?.fileChanges?.map((change) => [change.file, change]) ?? []);
            for (const entry of entries) currentFiles.set(entry.file, { file: entry.file, additions: 0, deletions: 0, attribution: "tool" });
            await updateRun(projectId, runId, { fileChanges: [...currentFiles.values()] });
            for (const entry of entries) await appendTrace(projectId, runId, {
              type: "agent_write",
              summary: `${entry.file} written by Agent tool`,
              data: { ...entry }
            });
            for (const entry of entries) {
              try {
                if (guard?.mode === "observe") {
                  const before = guard.agentGuard.baseline(runId, entry.file) ?? "";
                  let after: string;
                  let deleted = false;
                  try { after = await fs.readFile(path.join(projectRuntime.project.workspacePath, entry.file), "utf8"); }
                  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; after = ""; deleted = true; }
                  await guard.agentGuard.shadow(runId, [{ file: entry.file, before, after, ...(deleted ? { deleted } : {}) }]);
                }
                try { await projectRuntime.documents.reloadPath(entry.file); }
                catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; projectRuntime.documents.dropPath(entry.file); }
                guard?.workspaceChanged(entry.file);
              } catch (error) { await appendTrace(projectId, runId, { type: "agent_guard_error", summary: error instanceof Error ? error.message : String(error) }); }
            }
          }
        },
        async (error) => {
          await appendTrace(projectId, runId, {
            type: "listener_error",
            summary: error instanceof Error ? error.message : String(error),
            data: { error: error instanceof Error ? error.stack ?? error.message : String(error) }
          });
        }
      );
      stopRuntimeEvents = stopEvents;

      if ((await store.get(runId))?.status === "cancelled") { await options.runtime.cancel({ workspacePath: projectRuntime.project.workspacePath, sessionId: runtimeSessionId }); return; }

      if (guard) {
        const resume = approval.pause();
        progress?.waitingForApproval();
        saveProgress();
        try {
          const instruction = await guard.arbitration.beforeRun(runId, intentController.signal);
          if (instruction) runtimePrompt += `\n\n${instruction}`;
        } finally { resume(); progress?.resumed(); saveProgress(); }
        if ((await store.get(runId))?.status === "cancelled" || intentController.signal.aborted) return;
      }

      const processModel = options.runtime.getCurrentModel?.();
      if (processModel && processModel !== run.model) run = await updateRun(projectId, runId, { model: processModel });

      let result: { text: string; messageId?: string };
      try {
        result = await runWithTimeout(options.runtime.run({
          workspacePath: projectRuntime.project.workspacePath,
          sessionId: runtimeSessionId,
          prompt: runtimePrompt
        }), options.runTimeoutMs, () => options.runtime.cancel({
          workspacePath: projectRuntime.project.workspacePath,
          sessionId: runtimeSessionId
        }), approval);
      } catch (error) {
        const latestAfterFailure = await store.get(runId);
        if (latestAfterFailure?.status === "cancelled") {
          await recordFinishedFileChanges(projectId, runId, projectRuntime.project.workspacePath, runtimeSessionId, workspaceBefore, revisionsBefore);
          await recordCancellationCompletion(projectId, runId);
          return;
        }
        throw error;
      }
      const latest = await store.get(runId);
      guard?.arbitration.plan(runId, result.text);
      if (latest?.status === "cancelled") {
        await recordFinishedFileChanges(projectId, runId, projectRuntime.project.workspacePath, runtimeSessionId, workspaceBefore, revisionsBefore, result.messageId);
        await recordCancellationCompletion(projectId, runId);
        return;
      }
      const fileChanges = await recordFinishedFileChanges(projectId, runId, projectRuntime.project.workspacePath, runtimeSessionId, workspaceBefore, revisionsBefore, result.messageId);
      if (continuationOutputs.length) result.text = [result.text, ...continuationOutputs].join("\n\n");
      const finishedAt = new Date().toISOString();
      const completed = await finishRunningRun(projectId, runId, {
        status: "completed",
        output: result.text,
        fileChanges,
        finishedAt
      });
      if (!completed) return;
      await appendTrace(projectId, runId, {
        type: "assistant_message",
        summary: result.text,
        data: { text: result.text }
      });
      if (run.source === "chat" && session.scope === "team") {
        await projectRuntime.chat.createMessage({
          roomId: projectRuntime.room.id,
          authorId: "agent",
          authorName: session.handle ?? session.title,
          kind: "agent",
          agentSessionId: session.id,
          runId: run.id,
          text: result.text
        });
      }
      appendActivity(projectId, {
        type: "agent_task_completed",
        memberId: run.memberId,
        participantId: run.participantId,
        payload: {
          runId: run.id,
          sessionId: run.sessionId,
          name: run.memberName,
          files: fileChanges
        }
      });
      await appendTrace(projectId, runId, {
        type: "run_completed",
        summary: "Agent run completed",
        data: { overlappingRunIds: [...(runOverlapIds.get(runId) ?? [])] }
      });
    } catch (error) {
      const latest = await store.get(runId);
      if (latest?.status === "cancelled") {
        if (workspacePathForRun && runtimeSessionIdForRun && revisionsBeforeForRun) await recordFinishedFileChanges(projectId, runId, workspacePathForRun, runtimeSessionIdForRun, workspaceBeforeForRun, revisionsBeforeForRun);
        await recordCancellationCompletion(projectId, runId);
        return;
      }
      const failure = diagnoseAgentFailure(error, phase, lastSuccessfulSequence, options.sensitiveValues);
      activeRuns.get(runId)?.cancelPermissions?.();
      if (workspacePathForRun && runtimeSessionIdForRun) {
        try { await Promise.all([options.runtime.cancel({ workspacePath: workspacePathForRun, sessionId: runtimeSessionIdForRun }), activeRuns.get(runId)?.questions?.dispose()]); }
        catch (cancelError) { await appendTrace(projectId, runId, { type: "runtime_cancel_error", summary: cancelError instanceof Error ? cancelError.message : String(cancelError) }); }
      }
      if (workspacePathForRun && runtimeSessionIdForRun && revisionsBeforeForRun) await recordFinishedFileChanges(projectId, runId, workspacePathForRun, runtimeSessionIdForRun, workspaceBeforeForRun, revisionsBeforeForRun);
      const message = failure.message;
      const failed = await finishRunningRun(projectId, runId, {
        status: "failed",
        error: message,
        failure,
        finishedAt: new Date().toISOString()
      });
      if (!failed) return;
      appendActivity(projectId, {
        type: "agent_task_failed",
        memberId: current.memberId,
        participantId: current.participantId,
        payload: {
          runId: current.id,
          sessionId: current.sessionId,
          name: current.memberName,
          error: message
        }
      });
      if (current.source === "chat" && current.sessionId) {
        const session = await getSessionStore(projectId).get(current.sessionId);
        if (session?.scope === "team") {
          await options.runtimeManager.get(projectId).chat.createMessage({
            roomId: options.runtimeManager.get(projectId).room.id,
            authorId: "agent",
            authorName: "System",
            kind: "system",
            agentSessionId: session.id,
            runId: current.id,
            text: `Team Agent task failed: ${message}`
          });
        }
      }
      await appendTrace(projectId, runId, {
        type: "run_failed",
        summary: message,
        data: { ...failure, overlappingRunIds: [...(runOverlapIds.get(runId) ?? [])] }
      });
    } finally {
      if (guardRuns.delete(runId)) {
        try {
          const project = options.runtimeManager.get(projectId);
          const t3 = await project.conflictGuard?.agentGuard.finish(runId, [], (file, expected, text, owner, remove) => project.documents.applyGuardRevert(file, expected, text, owner, remove));
          const latest = await getStore(projectId).get(runId);
          await updateRun(projectId, runId, { conflictGuard: { rejectedEdits: 0, ...latest?.conflictGuard, t3, t3Executed: true } });
          project.conflictGuard?.arbitration.finish(runId, t3 === "reverted" || t3 === "partially-reverted");
        } catch (error) {
          const latest = await getStore(projectId).get(runId);
          await updateRun(projectId, runId, { conflictGuard: { rejectedEdits: 0, ...latest?.conflictGuard, t3Executed: false, t3Error: String(redactSensitive(error instanceof Error ? error.message : String(error), options.sensitiveValues)) } });
          await appendTrace(projectId, runId, { type: "t3_error", summary: error instanceof Error ? error.message : String(error) });
        }
      }
      activeRuns.get(runId)?.cancelPermissions?.();
      await activeRuns.get(runId)?.questions?.dispose();
      await drainPermissions?.();
      try { await stopRuntimeEvents?.(); }
      catch (error) { recordInternalError(projectId, runId, "listener", error); await appendTrace(projectId, runId, { type: "listener_error", data: { phase: "stop", error: error instanceof Error ? error.message : String(error) } }); }
      stopGuardEvents?.();
      if (progressTimer !== undefined) clearTimeout(progressTimer);
      saveProgress();
      await progressWrites;
      const completedRun = await getStore(projectId).get(runId);
      options.runtimeManager.get(projectId).conflictGuard?.arbitration.finish(runId, completedRun?.conflictGuard?.t3 === "reverted" || completedRun?.conflictGuard?.t3 === "partially-reverted");
      activeRuns.delete(runId);
    }
  }

  scheduler = createAgentScheduler({
    maxConcurrentRuns: options.maxConcurrentRuns,
    isClosing: () => disposing,
    getQueue,
    findRunnableRun,
    executeRun,
    async onSchedulerError(projectId, error, runId) {
      if (!runId) {
        console.error("Agent scheduler failed to select a run", error);
        return;
      }
      const run = await getStore(projectId).get(runId);
      if (!run || run.status === "completed" || run.status === "failed" || run.status === "cancelled") return;
      const sequence = (await getTrace(projectId, runId).list()).at(-1)?.sequence ?? 0;
      const failure = diagnoseAgentFailure(error, "creating-session", sequence, options.sensitiveValues);
      await updateRun(projectId, runId, { status: "failed", error: failure.message, failure, finishedAt: new Date().toISOString() });
      await appendTrace(projectId, runId, { type: "run_failed", summary: failure.message, data: { ...failure, scheduler: true } });
      console.error("Agent scheduler failed to start run", error);
    },
    onRunStart({ projectId, runId, overlappingRunIds }) {
      runConcurrentIds.set(runId, new Set(overlappingRunIds));
      runOverlapIds.set(runId, new Set(overlappingRunIds));
      for (const otherRunId of overlappingRunIds) runOverlapIds.get(otherRunId)?.add(runId);
      const releaseRuntimeRun = options.runtime.acquireRun?.() ?? (() => {});
      return () => {
        runConcurrentIds.delete(runId);
        releaseRuntimeRun();
        cleanupOverlapEntries(projectId, runId);
      };
    }
  });

  return {
    diagnostics() { return { degraded: failures.trace + failures.attribution + failures.listener > 0, failures: { ...failures }, lastInternalError }; },
    async initialize() {
      const projects = await options.registry.listProjects();
      for (const project of projects) {
        await migrateLegacySessions(project.id);
        const store = getStore(project.id);
        const interrupted = (await store.list()).filter(
          (run) => run.status === "queued" || run.status === "running"
        );
        for (const run of interrupted) {
          const sequence = (await getTrace(project.id, run.id).list()).at(-1)?.sequence ?? 0;
          const failure = diagnoseAgentFailure(new AgentRuntimeRequestError({
            source: "server", errorType: "ServerRestart", retryable: true,
            message: "服务端重启中断了任务。", guidance: "已经记录的文件修改继续保留，可以重新发起任务。"
          }), run.activity?.phase ?? "creating-session", sequence, options.sensitiveValues);
          await updateRun(project.id, run.id, {
            status: "failed",
            error: failure.message,
            failure,
            finishedAt: new Date().toISOString()
          });
          await appendTrace(project.id, run.id, {
            type: "run_failed",
            summary: failure.message,
            data: { ...failure }
          });
          appendActivity(project.id, {
            type: "agent_task_failed",
            memberId: run.memberId,
            participantId: run.participantId,
            payload: {
              runId: run.id,
              sessionId: run.sessionId,
              name: run.memberName,
              error: failure.message
            }
          });
        }
      }
    },
    async createRun(input: {
      projectId: string;
      memberId: string;
      initiatorRole?: string;
      prompt: string;
      sessionId?: string;
      contexts?: AgentPromptContext[];
      source?: AgentRun["source"];
      chatMessageId?: string;
      extraPrompt?: string;
      interruptsRunId?: string;
      runId?: string;
      interrupt?: boolean;
    }) {
      if (disposing) throw new Error("Agent run manager is closing");
      const prompt = input.prompt.trim();
      if (!prompt) throw new Error("prompt is required");
      const settings = options.getSettings();
      if (!settings.enabled) throw new Error("Agent is disabled");
      if (!settings.apiKeyConfigured) throw new Error("DEEPSEEK_API_KEY is required");
      const projectRuntime = options.runtimeManager.get(input.projectId);
      const member = projectRuntime.rooms.getMember(
        projectRuntime.room.id,
        input.memberId
      );
      if (!member) {
        throw new Error("Project membership is required");
      }
      return withSessionLock(`${input.projectId}:${input.sessionId ?? input.runId ?? input.memberId}`, async () => {
      const store = getStore(input.projectId);
      const sessionStore = getSessionStore(input.projectId);
      let session = input.sessionId
        ? await sessionStore.get(input.sessionId)
        : undefined;
      if (session) {
        if (session.deletedAt) throw new Error("Agent session has been deleted");
        if ((session.scope ?? "personal") !== "team" && session.memberId !== input.memberId) {
          throw new Error("Agent session belongs to another participant");
        }
      }
      if (!session) {
        if (input.sessionId) throw new Error("Agent session not found");
        session = await sessionStore.create({
          projectId: input.projectId,
          memberId: input.memberId,
          participantId: input.memberId,
          memberName: member.displayName,
          title: prompt.slice(0, 80),
          runtime: "opencode"
        });
      }
      const contexts = normalizeAgentContexts(input.contexts);
      const nextRunId = input.runId ?? crypto.randomUUID();
      let interruptsRunId = input.interruptsRunId;
      if (input.interrupt) {
        const previous = (await store.list()).filter((candidate) => candidate.sessionId === session!.id && ["queued", "running"].includes(candidate.status));
        for (const candidate of previous) {
          await this.cancelRun(input.projectId, candidate.id, input.memberId, { runId: nextRunId, memberId: input.memberId });
          interruptsRunId = candidate.id;
        }
      }
      const run = await store.create({
        projectId: input.projectId,
        memberId: input.memberId,
        initiatorMemberId: input.memberId,
        initiatorRole: input.initiatorRole,
        participantId: input.memberId,
        memberName: member.displayName,
        prompt,
        contexts,
        sessionId: session.id,
        runtimeSessionId: session.runtimeSessionId,
        sessionScope: session.scope ?? "personal",
        status: "queued",
        runtime: "opencode",
        provider: "deepseek",
        model: settings.model,
        source: input.source ?? "agent-panel",
        chatMessageId: input.chatMessageId,
        extraPrompt: input.extraPrompt?.trim() || undefined,
        interruptsRunId
      }, nextRunId);
      projectRuntime.conflictGuard?.arbitration.board.create({ kind: "agent", runId: run.id, ownerId: run.memberId, ...(session.scope === "team" ? { teamAgent: session.handle ?? session.title } : {}) }, prompt, Object.fromEntries(projectRuntime.documents.getRevisions()));
      projectRuntime.conflictGuard?.arbitration.attach(run.id, { resolve: () => false, cancel: async () => { await this.cancelRun(input.projectId, run.id, input.memberId); } });
      emit({ type: "run_updated", projectId: input.projectId, run });
      await appendTrace(input.projectId, run.id, {
        type: "run_queued",
        summary: "Agent run queued"
      });
      getQueue(input.projectId).runIds.push(run.id);
      setImmediate(() => void processQueue(input.projectId));
      return run;
      });
    },
    async createSession(input: {
      projectId: string;
      memberId: string;
      title?: string;
    }) {
      const projectRuntime = options.runtimeManager.get(input.projectId);
      const member = projectRuntime.rooms.getMember(
        projectRuntime.room.id,
        input.memberId
      );
      if (!member) throw new Error("Project membership is required");
      const title = input.title?.trim() || "New Agent session";
      return getSessionStore(input.projectId).create({
        projectId: input.projectId,
        memberId: input.memberId,
        participantId: member.participantId,
        memberName: member.displayName,
        title,
        runtime: "opencode"
      });
    },
    async listTeamAgents(projectId: string) {
      await ensureDefaultTeamAgent(projectId);
      return listTeamAgentsWithoutEnsuring(projectId);
    },
    async createTeamAgent(input: {
      projectId: string;
      memberId: string;
      name: string;
      description?: string;
    }) {
      const projectRuntime = options.runtimeManager.get(input.projectId);
      const member = projectRuntime.rooms.getMember(
        projectRuntime.room.id,
        input.memberId
      );
      if (!member) throw new Error("Project membership is required");
      const handle = normalizeHandle(input.name);
      validateHandle(handle);
      await ensureDefaultTeamAgent(input.projectId);
      return withTeamAgentLock(input.projectId, async () => {
        const sessionStore = getSessionStore(input.projectId);
        const existing = await sessionStore.findByHandle(handle);
        if (existing) throw new Error(`Team Agent handle already exists: ${handle}`);
        const session = await sessionStore.create({
          projectId: input.projectId,
          memberId: "",
          scope: "team",
          handle,
          description: input.description?.trim() || undefined,
          createdByMemberId: member.id,
          title: handle,
          runtime: "opencode"
        });
        emit({
          type: "team_agents_changed",
          projectId: input.projectId,
          agents: await listTeamAgentsWithoutEnsuring(input.projectId)
        });
        return session;
      });
    },
    async getSession(projectId: string, sessionId: string) {
      const session = await getSessionStore(projectId).get(sessionId);
      if (!session) throw new Error("Agent session not found");
      return session;
    },
    async getSessionForMember(
      projectId: string,
      sessionId: string,
      memberId: string
    ) {
      const projectRuntime = options.runtimeManager.get(projectId);
      const member = projectRuntime.rooms.getMember(projectRuntime.room.id, memberId);
      if (!member) throw new Error("Project membership is required");
      const sessionStore = getSessionStore(projectId);
      const stored = await sessionStore.get(sessionId);
      if (!stored) throw new Error("Agent session not found");
      if (stored.deletedAt) throw new Error("Agent session has been deleted");
      if ((stored.scope ?? "personal") !== "team" && stored.memberId !== memberId) {
        throw new Error("Agent session belongs to another participant");
      }
      return stored;
    },
    async listSessions(projectId: string, memberId: string) {
      const projectRuntime = options.runtimeManager.get(projectId);
      const member = projectRuntime.rooms.getMember(projectRuntime.room.id, memberId);
      if (!member) {
        throw new Error("Project membership is required");
      }
      const sessionStore = getSessionStore(projectId);
      return sessionStore.list(memberId, "personal");
    },
    async getRun(projectId: string, runId: string) {
      const run = await getStore(projectId).get(runId);
      if (!run) throw new Error("Agent run not found");
      return run;
    },
    async listRuns(projectId: string) {
      return getStore(projectId).list();
    },
    async listVisibleRuns(projectId: string, memberId: string) {
      const sessions = await getSessionStore(projectId).list();
      return (await getStore(projectId).list()).filter((run) => sessions.some((session) => session.id === run.sessionId) && canReadAgentRun(run, memberId));
    },
    async deleteSession(projectId: string, sessionId: string, memberId: string) {
      return withSessionLock(`${projectId}:${sessionId}`, async () => {
        const session = await this.getSessionForMember(projectId, sessionId, memberId);
        if (session.scope === "team") throw new Error("Only personal sessions can be deleted here");
        for (const run of await getStore(projectId).list()) if (run.sessionId === sessionId && ["queued", "running"].includes(run.status)) await this.cancelRun(projectId, run.id, memberId);
        await getSessionStore(projectId).update(sessionId, { deletedAt: new Date().toISOString() });
      });
    },
    async answerQuestion(projectId: string, runId: string, memberId: string, requestId: string, answers?: string[][]) {
      const run = await this.getRun(projectId, runId);
      if (run.memberId !== memberId) throw new Error("Only the requesting member can answer this question");
      const active = activeRuns.get(runId);
      if (!active?.questions || run.status !== "running") throw new Error("This task is no longer waiting for an answer");
      await active.questions.answer(requestId, answers);
    },
    async listTrace(projectId: string, runId: string) {
      const run = await getStore(projectId).get(runId);
      if (!run) throw new Error("Agent run not found");
      return getTrace(projectId, runId).list();
    },
    async cancelRun(
      projectId: string,
      runId: string,
      memberId: string,
      interruptedBy?: { runId: string; memberId: string }
    ) {
      const projectRuntime = options.runtimeManager.get(projectId);
      const member = projectRuntime.rooms.getMember(projectRuntime.room.id, memberId);
      if (!member) {
        throw new Error("Project membership is required");
      }
      const store = getStore(projectId);
      const run = await store.get(runId);
      if (!run) throw new Error("Agent run not found");
      if (!canReadAgentRun(run, memberId)) throw new Error("Agent run belongs to another participant");
      if (["completed", "failed", "cancelled"].includes(run.status)) return run;

      const queue = getQueue(projectId);
      queue.runIds = queue.runIds.filter((queuedRunId) => queuedRunId !== runId);
      if (!activeRuns.has(runId)) cancelRequested.add(runId);
      const cancelled = await updateRun(projectId, runId, {
        status: "cancelled",
        finishedAt: new Date().toISOString(),
        interruptedByRunId: interruptedBy?.runId,
        interruptedByMemberId: interruptedBy?.memberId
      });
      await appendTrace(projectId, runId, {
        type: interruptedBy ? "run_interrupted" : "run_cancel_requested",
        summary: interruptedBy ? "Agent run interrupted" : "Agent run cancelled",
        data: {
          ...(interruptedBy ? { interruptedByRunId: interruptedBy.runId, interruptedByMemberId: interruptedBy.memberId } : {}),
        }
      });
      appendActivity(projectId, {
        type: "agent_task_cancelled",
        memberId: run.memberId,
        participantId: run.participantId,
        payload: {
          runId: run.id,
          sessionId: run.sessionId,
          name: run.memberName,
          reason: interruptedBy ? "interrupted" : "cancelled"
        }
      });

      const active = activeRuns.get(runId);
      if (active) {
        projectRuntime.conflictGuard?.arbitration.cancel(runId);
        active.cancelPermissions?.();
        await Promise.all([options.runtime.cancel({
          workspacePath: active.workspacePath,
          sessionId: active.runtimeSessionId
        }), active.questions?.dispose()]);
      } else {
        await recordCancellationCompletion(projectId, runId);
        projectRuntime.conflictGuard?.arbitration.finish(runId, false);
      }
      return cancelled;
    },
    onEvent(listener: (event: AgentRunManagerEvent) => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    hasActiveTasks() {
      return (
        activeRuns.size > 0 ||
        [...queues.values()].some(
          (queue) => queue.processing || queue.activeRunIds.size > 0 || queue.runIds.length > 0
        )
      );
    },
    async disposeProject(projectId: string) {
      const store = getStore(projectId);
      const active = (await store.list()).filter(
        (run) => run.status === "queued" || run.status === "running"
      );
      const activeIds = new Set(active.map((run) => run.id));
      const queue = getQueue(projectId);
      queue.closing = true;
      queue.runIds = queue.runIds.filter((runId) => !activeIds.has(runId));

      for (const run of active) {
        options.runtimeManager.get(projectId).conflictGuard?.arbitration.cancel(run.id);
        if (!activeRuns.has(run.id)) options.runtimeManager.get(projectId).conflictGuard?.arbitration.finish(run.id, false);
        await updateRun(projectId, run.id, {
          status: "cancelled",
          finishedAt: new Date().toISOString()
        });
        await appendTrace(projectId, run.id, {
          type: "run_cancel_requested",
          summary: "Agent run cancelled because the project was deleted",
          data: { reason: "project_deleted" }
        });
        appendActivity(projectId, {
          type: "agent_task_cancelled",
          memberId: run.memberId,
          participantId: run.participantId,
          payload: {
            runId: run.id,
            sessionId: run.sessionId,
            name: run.memberName,
            reason: "Project deleted"
          }
        });
      }

      await Promise.all(
        active.flatMap((run) => {
          const running = activeRuns.get(run.id);
          running?.cancelPermissions?.();
          return running
            ? [
                options.runtime.cancel({
                  workspacePath: running.workspacePath,
                  sessionId: running.runtimeSessionId
                }),
                running.questions?.dispose()
              ]
            : [];
        })
      );
      if (queue.completion) await queue.completion;
      while (queue.runningPromises.size > 0) {
        await Promise.all([...queue.runningPromises]);
      }
      for (const run of active) if (!activeRuns.has(run.id)) await recordCancellationCompletion(projectId, run.id);
      const projectRunIds = (await store.list()).map((run) => run.id);
      for (const id of projectRunIds) {
        runConcurrentIds.delete(id);
        runOverlapIds.delete(id);
        cancelCompletionRecorded.delete(id);
        cancelRequested.delete(id);
        for (const key of recordedOverlaps) if (key.startsWith(`${id}:`) || key.includes(`:${id}:`)) recordedOverlaps.delete(key);
      }
      writeLedger.clearProject(projectId);
      queues.delete(projectId);
      stores.delete(projectId);
      for (const key of traces.keys()) {
        if (key.startsWith(`${projectId}:`)) traces.delete(key);
      }
      sessionStores.delete(projectId);
    },
    async dispose() {
      disposing = true;
      for (const queue of queues.values()) queue.closing = true;
      for (const active of activeRuns.values()) active.cancelPermissions?.();
      for (const [runId] of activeRuns) for (const projectId of queues.keys()) options.runtimeManager.get(projectId).conflictGuard?.arbitration.cancel(runId);
      await Promise.all(
        [...activeRuns.values()].flatMap((active) => [
          options.runtime.cancel({
            workspacePath: active.workspacePath,
            sessionId: active.runtimeSessionId
          }), active.questions?.dispose()
        ])
      );
      await Promise.all(
        [...queues.values()]
          .map((queue) => queue.completion)
          .filter((completion): completion is Promise<void> => Boolean(completion))
      );
      while ([...queues.values()].some((queue) => queue.runningPromises.size > 0)) {
        await Promise.all(
          [...queues.values()].flatMap((queue) => [...queue.runningPromises])
        );
      }
      for (const projectId of queues.keys()) writeLedger.clearProject(projectId);
      runConcurrentIds.clear();
      runOverlapIds.clear();
      cancelCompletionRecorded.clear();
      recordedOverlaps.clear();
      cancelRequested.clear();
      listeners.clear();
    }
  };
}

export type AgentRunManager = ReturnType<typeof createAgentRunManager>;
