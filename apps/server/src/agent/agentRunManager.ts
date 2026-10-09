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
import { OpenCodeEmptyResponseError } from "./openCodeRuntime.js";
import { normalizePermissionPaths } from "./permissionPaths.js";
import { createAgentProgress } from "./agentProgress.js";
import { createAgentQuestions } from "./agentQuestions.js";
import { diagnoseAgentFailure } from "./agentRunFailure.js";
import { canReadAgentRun } from "./agentVisibility.js";
import { createAgentScheduler, getCompletedOverlapGroup, type AgentSchedulerQueue } from "./agentScheduler.js";
import { selectRunnableAgentRun } from "./agentRunSelection.js";
import { createAgentWriteLedger } from "./agentWriteLedger.js";

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
  const activeRuns = new Map<string, { workspacePath: string; runtimeSessionId: string }>();
  const questions = new Map<string, ReturnType<typeof createAgentQuestions>>();
  const sessionOperations = new Map<string, Promise<unknown>>();
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
    if (!traces.has(key)) traces.set(key, createTraceStore(path.join(getStore(projectId).runsRoot, runId, "trace.jsonl"), options.sensitiveValues));
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
    executeRun,
    async onSchedulerError(projectId, error, runId) {
      if (!runId) throw error;
      const run = await getStore(projectId).get(runId);
      if (!run || ["completed", "failed", "cancelled"].includes(run.status)) return;
      const failure = diagnoseAgentFailure(error, "creating-session", 0, options.sensitiveValues);
      if (!await updateRunIfStatus(projectId, runId, run.status, { status: "failed", failure, error: failure.message, finishedAt: new Date().toISOString() })) return;
      await appendTrace(projectId, runId, { type: "run_failed", summary: failure.message, data: failure as unknown as Record<string, unknown> });
    }
  });

  async function executeRun(projectId: string, runId: string) {
    const store = getStore(projectId);
    const current = await store.get(runId);
    if (!current || current.status !== "queued") return;
    const progress = createAgentProgress(new Date().toISOString(), options.activityConfig);
    let phase: import("@simplercp/shared").AgentRunPhase = "creating-session";
    let sequence = 0;
    let snapshot: Awaited<ReturnType<typeof createAgentWorkspaceSnapshot>> | undefined;
    let runtimeSessionId: string | undefined;
    let stopEvents: (() => Promise<void>) | undefined;
    let questionManager: ReturnType<typeof createAgentQuestions> | undefined;
    let lastPublished = 0;
    const runtime = options.runtimeManager.get(projectId);
    const revisions = runtime.documents.getRevisions();
    const recordedConcurrentFiles = new Set<string>();
    async function collectChanges(messageId?: string) {
      if (!snapshot) return [];
      const changes = compareAgentWorkspaceSnapshots(snapshot, await createAgentWorkspaceSnapshot(runtime.project.workspacePath));
      const memberFiles = new Set(changes.filter((change) => runtime.documents.getRevision(change.file) > (revisions.get(change.file) ?? 0)).map((change) => change.file));
      let sessionChanges: AgentRun["fileChanges"] = [];
      if (runtimeSessionId) {
        try {
          sessionChanges = await options.runtime.getDiff({ workspacePath: runtime.project.workspacePath, sessionId: runtimeSessionId, messageId });
          await appendTrace(projectId, runId, { type: "session_diff_observed", data: { files: sessionChanges } });
        }
        catch (error) { await appendTrace(projectId, runId, { type: "file_changes_unavailable", summary: String(redactSensitive(error instanceof Error ? error.message : String(error), options.sensitiveValues)) }); }
      }
      for (const file of memberFiles) if (!recordedConcurrentFiles.has(file)) {
        recordedConcurrentFiles.add(file);
        await appendTrace(projectId, runId, { type: "concurrent_change", data: { path: file } });
      }
      return ledger.attribute(projectId, runId, changes, overlaps.get(runId) ?? new Set(), memberFiles);
    }
    try {
      const projectRuntime = options.runtimeManager.get(projectId);
      await projectRuntime.documents.awaitIdle();
      const session = current.sessionId
        ? await getSessionStore(projectId).get(current.sessionId)
        : undefined;
      if (!session) throw new Error("Agent session not found");
      const currentSession = session;
      const workspacePrepared = session.scope === "team"
        ? await options.runtime.prepareWorkspace?.(projectRuntime.project.workspacePath)
        : false;
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
      const workspaceBefore = await createAgentWorkspaceSnapshot(
        projectRuntime.project.workspacePath
      );
      snapshot = workspaceBefore;
      scheduler.workspacePrepared(projectId, runId);
      const revisionsBefore = projectRuntime.documents.getRevisions();
      const startedAt = new Date().toISOString();
      let run = await updateRunIfStatus(projectId, runId, "queued", {
        status: "running",
        startedAt,
        sessionScope: session.scope ?? "personal",
        activity: { ...progress.snapshot(), phase },
        overlappingRunIds: [...(overlaps.get(runId) ?? [])]
      });
      if (!run) return;
      const activeRun = run;
      if (workspacePrepared && run.runtimeSessionId) run = await updateRun(projectId, runId, { runtimeSessionId: undefined });
      await appendTrace(projectId, runId, {
        type: "run_started",
        summary: "Agent run started"
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
      const activeRuntimeSessionId: string = runtimeSessionId;

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

      const previousRun = run.interruptsRunId
        ? await store.get(run.interruptsRunId)
        : undefined;
      const interruptionPrompt = previousRun
        ? buildInterruptionPrompt(previousRun, run, projectRuntime.room.members)
        : undefined;
      const runtimePrompt = await buildRuntimePrompt(
        projectRuntime.project.workspacePath,
        [interruptionPrompt, run.extraPrompt, run.prompt].filter(Boolean).join("\n\n"),
        run.contexts,
        projectRuntime.project.name
      );
      await options.runtime.prepareRun?.({
        workspacePath: projectRuntime.project.workspacePath,
        sessionId: runtimeSessionId,
        runPrompt: run.prompt
      });

      const permissionWorktree = await options.runtime.getWorktree?.(projectRuntime.project.workspacePath) ?? projectRuntime.project.workspacePath;
      const permissionTasks = new Set<Promise<void>>();
      const handledPermissionIds = new Set<string>();
      const toolInputs = new Map<string, unknown>();
      const permissionBatches = new Map<string, { active: number; deferredRejects: Array<{ requestId: string; message: string }>; flushing: boolean }>();
      let guardRejected = false;
      const batchFor = (sessionId: string) => {
        const currentBatch = permissionBatches.get(sessionId);
        if (currentBatch) return currentBatch;
        const batch = { active: 0, deferredRejects: [], flushing: false };
        permissionBatches.set(sessionId, batch);
        return batch;
      };
      async function replyPermission(requestId: string, reply: "once" | "reject", message?: string) {
        try {
          await options.runtime.replyPermission({
            workspacePath: projectRuntime.project.workspacePath,
            requestId,
            reply,
            message
          });
        } catch (error) {
          const summary = error instanceof Error ? error.message : "Permission reply failed";
          if (reply === "reject" && /permission request not found/i.test(summary)) {
            await appendTrace(projectId, runId, { type: "permission_reply_ignored", summary });
            return;
          }
          await appendTrace(projectId, runId, { type: "permission_reply_failed", summary });
        }
      }
      async function flushRejectedPermissions(sessionId: string, batch: { active: number; deferredRejects: Array<{ requestId: string; message: string }>; flushing: boolean }) {
        if (batch.active !== 0 || batch.flushing || batch.deferredRejects.length === 0) return;
        batch.flushing = true;
        const rejected = batch.deferredRejects.splice(0);
        for (const item of rejected) await replyPermission(item.requestId, "reject", item.message);
        batch.flushing = false;
        permissionBatches.delete(sessionId);
      }
      async function handlePermissionEvent(event: { type: string; data: Record<string, unknown> }) {
        const properties = event.data;
        const data = properties;
        const requestIdValue = typeof data.id === "string" ? data.id : typeof data.requestID === "string" ? data.requestID : undefined;
        if (typeof requestIdValue !== "string") return;
        const requestId = requestIdValue;
        if (handledPermissionIds.has(requestId)) return;
        handledPermissionIds.add(requestId);
        const permissionBatch = batchFor(activeRuntimeSessionId);
        permissionBatch.active += 1;
        const permission = typeof data.permission === "string" ? data.permission : typeof data.action === "string" ? data.action : "";
        const rawPatterns = Array.isArray(data.patterns) ? data.patterns : data.resources;
        const patterns = Array.isArray(rawPatterns)
          ? rawPatterns.filter((value): value is string => typeof value === "string")
          : [];
        const rawMetadata = data.metadata;
        const metadata = rawMetadata && typeof rawMetadata === "object" ? rawMetadata as Record<string, unknown> : {};
        const fileMetadata = Array.isArray(metadata.files) ? metadata.files : [];
        const movePaths = fileMetadata.flatMap((value) => {
          if (!value || typeof value !== "object") return [];
          const movePath = (value as Record<string, unknown>).movePath;
          return typeof movePath === "string" ? [movePath] : [];
        });
        const editPath = typeof metadata.filepath === "string" ? [metadata.filepath] : [];
        const tool = data.tool && typeof data.tool === "object" ? data.tool as Record<string, unknown> : {};
        const callId = typeof tool.callID === "string" ? tool.callID : undefined;
        const toolInput = callId ? toolInputs.get(callId) : undefined;
        const readPermission = ["read", "grep", "glob", "list"].includes(permission);
        const allPaths = readPermission
          ? normalizePermissionPaths([...patterns, ...movePaths, ...editPath], toolInput, projectRuntime.project.workspacePath, { permission, worktree: permissionWorktree, metadata })
          : [...patterns, ...movePaths, ...editPath];
        const supported = ["bash", "edit", "read", "grep", "glob", "list", "webfetch", "websearch"].includes(permission);
        const commandValue = metadata.command ?? metadata.description ?? patterns[0];
        const request = {
          projectId,
          memberId: activeRun.initiatorMemberId ?? activeRun.memberId,
          source: "agent" as const,
          agentRunId: activeRun.id,
          sessionScope: currentSession.scope ?? "personal",
          agentHandle: currentSession.handle,
          kind: permission === "edit" ? "edit" as const : readPermission ? "read" as const : permission === "webfetch" || permission === "websearch" ? "fetch" as const : "command" as const,
          command: permission === "bash" ? String(commandValue ?? "") : undefined,
          paths: permission === "edit" || readPermission ? allPaths : undefined,
          url: permission === "webfetch" || permission === "websearch" ? String(metadata.url ?? patterns[0] ?? "") : undefined,
          cwd: projectRuntime.project.workspacePath,
          unknownTool: !supported
        };
        try {
          const permissionResult = await projectRuntime.guard.submit(request, {
            timeoutMs: Math.min(projectRuntime.guard.approvalTimeoutMs(), Math.max(1, Math.floor(options.runTimeoutMs / 2)))
          });
          if (permissionResult.approved && permissionResult.decision.action === "allow_snapshot") {
            await projectRuntime.guard.createSnapshot(request);
          }
          if (permissionResult.approved) {
            await replyPermission(requestId, "once");
          } else {
            guardRejected = true;
            permissionBatch.deferredRejects.push({
              requestId,
              message: permissionResult.decision.matchedRules.join(", ") || "Permission denied by project guard"
            });
          }
        } catch (error) {
          guardRejected = true;
          await appendTrace(projectId, runId, { type: "permission_failed", summary: error instanceof Error ? error.message : "Permission handling failed" });
          permissionBatch.deferredRejects.push({ requestId, message: "Permission handling failed" });
        } finally {
          permissionBatch.active -= 1;
          await flushRejectedPermissions(activeRuntimeSessionId, permissionBatch);
        }
      }

      const stopEvents = await options.runtime.subscribe(
        {
          workspacePath: projectRuntime.project.workspacePath,
          sessionId: runtimeSessionId
        },
        (event) => {
          const part = event.data.part;
          if (part && typeof part === "object") {
            const record = part as Record<string, unknown>;
            const callId = typeof record.callID === "string" ? record.callID : undefined;
            const state = record.state && typeof record.state === "object" ? record.state as Record<string, unknown> : undefined;
            if (callId && state?.input && typeof state.input === "object") toolInputs.set(callId, state.input);
          }
          void appendTrace(projectId, runId, {
            type: `opencode.${event.type}`,
            data: event.data
          }).catch((error) => appendTrace(projectId, runId, { type: "trace_failed", summary: error instanceof Error ? error.message : "Trace append failed" }));
          const permissionEvent = event.type === "permission.asked" || event.type === "permission.v2.asked";
          if (!permissionEvent) return;
          const task = handlePermissionEvent(event);
          permissionTasks.add(task);
          void task.then(() => permissionTasks.delete(task), () => permissionTasks.delete(task));
        }
      );

      let result: { text: string; messageId?: string };
      try {
        result = await runWithTimeout(options.runtime.run({
          workspacePath: projectRuntime.project.workspacePath,
          sessionId: runtimeSessionId,
          prompt: runtimePrompt
        }),
        options.runTimeoutMs,
        async () => {
          projectRuntime.guard.cancelRun(run.id);
          await options.runtime.cancel({
            workspacePath: projectRuntime.project.workspacePath,
            sessionId: runtimeSessionId
          });
        }
      ).finally(stopEvents);
      } catch (error) {
        if (guardRejected && error instanceof OpenCodeEmptyResponseError) {
          const message = "blocked_by_guard";
          await updateRun(projectId, runId, {
            status: "blocked_by_guard",
            error: message,
            finishedAt: new Date().toISOString()
          });
          appendActivity(projectId, {
            type: "agent_task_blocked",
            memberId: current.memberId,
            participantId: current.participantId,
            payload: {
              runId: current.id,
              sessionId: current.sessionId,
              name: current.memberName,
              error: message
            }
          });
          await appendTrace(projectId, runId, {
            type: "run_blocked_by_guard",
            summary: message
          });
          return;
        }
        const latestAfterFailure = await store.get(runId);
        if (latestAfterFailure?.status === "cancelled") {
          await updateRun(projectId, runId, { fileChanges: await collectChanges() });
          return;
        }
        throw error;
      }
      const latest = await store.get(runId);
      if (latest?.status === "cancelled") {
        await updateRun(projectId, runId, { fileChanges: await collectChanges(result.messageId) });
        return;
      }
      const fileChanges = await collectChanges(result.messageId);
      if (fileChanges.length > 0) {
        await appendTrace(projectId, runId, {
          type: "file_changes",
          summary: `${fileChanges.length} file${fileChanges.length === 1 ? "" : "s"} changed`,
          data: { files: fileChanges }
        });
      }
      await appendTrace(projectId, runId, {
        type: "assistant_message",
        summary: result.text,
        data: { text: result.text }
      });
      const finishedAt = new Date().toISOString();
      await updateRun(projectId, runId, {
        status: "completed",
        output: result.text,
        fileChanges,
        finishedAt
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
        summary: "Agent run completed"
      });
    } catch (error) {
      const latest = await store.get(runId);
      if (latest?.status === "cancelled") return;
      const message = error instanceof Error ? error.message : "Agent run failed";
      await updateRun(projectId, runId, {
        status: "failed",
        error: message,
        finishedAt: new Date().toISOString()
      });
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
        summary: message
      });
    } finally {
      options.runtimeManager.find(projectId)?.guard.cancelRun(runId);
      activeRuns.delete(runId);
    }
  }

  const manager = {
    async initialize() {
      for (const project of await options.registry.listProjects()) {
        await migrateLegacyAgentSessions(project.id, getStore(project.id), getSessionStore(project.id), new Set((await options.members.listMembers(project.id)).map((member) => member.memberId)));
        for (const run of await getStore(project.id).list()) {
          if (!["queued", "running"].includes(run.status)) continue;
          const failure = diagnoseAgentFailure(new Error("服务端重启中断了任务。"), run.activity?.phase ?? "creating-session", (await getTrace(project.id, run.id).list()).at(-1)?.sequence ?? 0, options.sensitiveValues);
          failure.retryable = true; failure.guidance = "服务重启中断了任务，已完成的文件修改继续保留，可以重试。";
          await updateRun(project.id, run.id, { status: "failed", error: failure.message, failure, questions: [], finishedAt: new Date().toISOString() });
          await appendTrace(project.id, run.id, { type: "run_failed", summary: failure.message, data: failure as unknown as Record<string, unknown> });
        }
        await ensureDefaultTeamAgent(project.id);
      }
    },
    async createRun(input: { projectId: string; memberId: string; prompt: string; contexts?: AgentPromptContext[]; sessionId?: string; source?: AgentRun["source"]; chatMessageId?: string; extraPrompt?: string; interruptsRunId?: string; runId?: string; initiatorRole?: string; interrupt?: boolean }) {
      if (disposing) throw new Error("Agent manager is closing");
      const settings = options.getSettings();
      if (!settings.enabled) throw new Error("Agent is disabled");
      if (!settings.apiKeyConfigured) throw new Error("DEEPSEEK_API_KEY is required");
      const prompt = input.prompt.trim(); if (!prompt) throw new Error("Agent prompt is required");
      const member = requireMember(input.projectId, input.memberId);
      const session = input.sessionId ? await manager.getSessionForMember(input.projectId, input.sessionId, input.memberId) : await manager.createSession({ projectId: input.projectId, memberId: input.memberId, title: prompt.slice(0, 80) });
      return withLock(sessionOperations, `${input.projectId}:${session.id}`, async () => {
        if ((await getSessionStore(input.projectId).get(session.id))?.deletedAt) throw new Error("Agent session has been deleted");
        const runId = input.runId ?? nanoid(12);
        const active = (await getStore(input.projectId).list()).filter((run) => run.sessionId === session.id && ["queued", "running"].includes(run.status));
        for (const previous of active) await manager.cancelRun(input.projectId, previous.id, input.memberId, { runId, memberId: input.memberId });
        const run = await getStore(input.projectId).create({ projectId: input.projectId, memberId: input.memberId, initiatorMemberId: input.memberId, initiatorRole: input.initiatorRole, participantId: member.participantId, memberName: member.displayName, prompt, contexts: normalizeAgentContexts(input.contexts), sessionId: session.id, sessionScope: session.scope ?? "personal", runtimeSessionId: session.runtimeSessionId, status: "queued", runtime: "opencode", provider: "deepseek", model: settings.model, source: input.source ?? "agent-panel", chatMessageId: input.chatMessageId, extraPrompt: input.extraPrompt, interruptsRunId: active.at(-1)?.id ?? input.interruptsRunId }, runId);
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
        await getSessionStore(projectId).update(sessionId, { deletedAt: new Date().toISOString() });
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
      const run = await manager.createRun({ projectId, memberId, prompt: previous.prompt, contexts: previous.contexts, sessionId: previous.sessionId, source: previous.source, chatMessageId: message?.id, extraPrompt: previous.extraPrompt });
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
    hasActiveTasks() { return [...queues.values()].some((queue) => queue.activeRunIds.size || queue.runIds.length); },
    getWriteLedger(projectId: string, runId: string) { return ledger.list(projectId, runId); },
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
        options.runtimeManager.find(projectId)?.guard.cancelRun(run.id);
        await updateRun(projectId, run.id, {
          status: "cancelled",
          finishedAt: new Date().toISOString()
        });
        await appendTrace(projectId, run.id, {
          type: "run_cancelled",
          summary: "Agent run cancelled because the project was deleted"
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
          return running
            ? [
                options.runtime.cancel({
                  workspacePath: running.workspacePath,
                  sessionId: running.runtimeSessionId
                })
              ]
            : [];
        })
      );
      if (queue.completion) await queue.completion;
      await Promise.all(queue.runningPromises);
      ledger.clearProject(projectId);
      queues.delete(projectId);
      stores.delete(projectId);
      for (const key of traces.keys()) {
        if (key.startsWith(`${projectId}:`)) traces.delete(key);
      }
      sessionStores.delete(projectId);
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
      options.runtimeManager.find(projectId)?.guard.cancelRun(runId);
      if (active) await options.runtime.cancel({ workspacePath: active.workspacePath, sessionId: active.runtimeSessionId });
      await questions.get(runId)?.dispose();
      appendActivity(projectId, { type: "agent_task_cancelled", memberId: run.memberId, participantId: run.participantId, payload: { runId, sessionId: run.sessionId, name: run.memberName, reason: interruptedBy ? "interrupted" : "cancelled" } });
      return cancelled;
  }
  return manager;
}
export type AgentRunManager = ReturnType<typeof createAgentRunManager>;
