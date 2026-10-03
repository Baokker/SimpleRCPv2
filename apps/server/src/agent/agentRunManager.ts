import path from "node:path";
import type {
  AgentRun,
  AgentSettingsResponse,
  AgentSession,
  AgentTraceEvent,
  AgentPromptContext,
  EventRecord
} from "@simplercp/shared";
import type { AgentRuntime } from "./agentRuntime.js";
import { createAgentRunStore, type AgentRunStore } from "./agentRunStore.js";
import {
  createAgentSessionStore,
  type AgentSessionStore
} from "./agentSessionStore.js";
import { createTraceStore, type TraceStore } from "./traceStore.js";
import { getProjectMetadataPath, type ProjectRegistry } from "../projects.js";
import type { ProjectRuntimeManager } from "../projectRuntimeManager.js";
import {
  compareAgentWorkspaceSnapshots,
  createAgentWorkspaceSnapshot
} from "./agentWorkspaceSnapshot.js";
import {
  buildRuntimePrompt,
  mergeFileChanges,
  normalizeAgentContexts,
  previewPrompt,
  runWithTimeout
} from "./agentRunSupport.js";
import { migrateLegacyAgentSessions } from "./agentSessionAccess.js";
import type { MemberStore } from "../auth/identity.js";
import { normalizeHandle, validateHandle } from "./teamAgentSupport.js";

interface AgentRunManagerOptions {
  members: MemberStore;
  runtime: AgentRuntime;
  registry: ProjectRegistry;
  runtimeManager: ProjectRuntimeManager;
  getSettings(): AgentSettingsResponse;
  apiKey?: string;
  sensitiveValues?: string[];
  runTimeoutMs: number;
  appendActivity?: (
    projectId: string,
    input: Omit<EventRecord, "id" | "timestamp">
  ) => EventRecord;
}

interface ProjectQueue {
  runIds: string[];
  processing: boolean;
  completion?: Promise<void>;
}

interface ActiveRun {
  workspacePath: string;
  runtimeSessionId: string;
}

export type AgentRunManagerEvent =
  | { type: "run_updated"; projectId: string; run: AgentRun }
  | { type: "activity_appended"; projectId: string; event: EventRecord }
  | {
      type: "trace_appended";
      projectId: string;
      runId: string;
      event: AgentTraceEvent;
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
  const queues = new Map<string, ProjectQueue>();
  const activeRuns = new Map<string, ActiveRun>();
  const teamAgentOperations = new Map<string, Promise<unknown>>();
  const listeners = new Set<(event: AgentRunManagerEvent) => void>();
  let disposing = false;

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
    const queue: ProjectQueue = { runIds: [], processing: false };
    queues.set(projectId, queue);
    return queue;
  }

  function emit(event: AgentRunManagerEvent) {
    for (const listener of listeners) listener(event);
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

  async function appendTrace(
    projectId: string,
    runId: string,
    input: Omit<AgentTraceEvent, "sequence" | "timestamp">
  ) {
    const event = await getTrace(projectId, runId).append(input);
    emit({ type: "trace_appended", projectId, runId, event });
    return event;
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

  async function processQueue(projectId: string) {
    const queue = getQueue(projectId);
    if (queue.processing) return queue.completion;
    queue.processing = true;
    queue.completion = (async () => {
      while (queue.runIds.length > 0 && !disposing) {
        const runId = queue.runIds.shift();
        if (!runId) continue;
        await executeRun(projectId, runId);
      }
    })().finally(() => {
      queue.processing = false;
    });
    return queue.completion;
  }

  async function recordCancelledFileChanges(
    projectId: string,
    runId: string,
    workspacePath: string,
    runtimeSessionId: string,
    workspaceBefore: Awaited<ReturnType<typeof createAgentWorkspaceSnapshot>>,
    messageId?: string
  ) {
    let workspaceChanges: AgentRun["fileChanges"] = [];
    let runtimeChanges: AgentRun["fileChanges"] = [];
    try {
      workspaceChanges = compareAgentWorkspaceSnapshots(
        workspaceBefore,
        await createAgentWorkspaceSnapshot(workspacePath)
      );
    } catch (error) {
      await appendTrace(projectId, runId, {
        type: "file_changes_unavailable",
        summary: `Workspace snapshot failed while recording cancelled changes: ${error instanceof Error ? error.message : "Unknown error"}`
      });
    }
    try {
      runtimeChanges = await options.runtime.getDiff({
        workspacePath,
        sessionId: runtimeSessionId,
        messageId
      });
    } catch (error) {
      await appendTrace(projectId, runId, {
        type: "file_changes_unavailable",
        summary: `Runtime diff failed while recording cancelled changes: ${error instanceof Error ? error.message : "Unknown error"}`
      });
    }
    const fileChanges = mergeFileChanges(workspaceChanges, runtimeChanges);
    await updateRun(projectId, runId, { fileChanges });
    if (fileChanges.length > 0) {
      await appendTrace(projectId, runId, {
        type: "file_changes",
        summary: `${fileChanges.length} file${fileChanges.length === 1 ? "" : "s"} changed before cancellation`,
        data: { files: fileChanges }
      });
    }
  }

  async function executeRun(projectId: string, runId: string) {
    const store = getStore(projectId);
    const current = await store.get(runId);
    if (!current || current.status !== "queued") return;
    try {
      const projectRuntime = options.runtimeManager.get(projectId);
      await projectRuntime.documents.awaitIdle();
      const session = current.sessionId
        ? await getSessionStore(projectId).get(current.sessionId)
        : undefined;
      if (!session) throw new Error("Agent session not found");
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
      const revisionsBefore = projectRuntime.documents.getRevisions();
      const startedAt = new Date().toISOString();
      let run = await updateRun(projectId, runId, {
        status: "running",
        startedAt
      });
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

      const stopEvents = await options.runtime.subscribe(
        {
          workspacePath: projectRuntime.project.workspacePath,
          sessionId: runtimeSessionId
        },
        async (event) => {
          await appendTrace(projectId, runId, {
            type: `opencode.${event.type}`,
            data: event.data
          });
        }
      );

      const previousRun = run.interruptsRunId
        ? await store.get(run.interruptsRunId)
        : undefined;
      const interruptionPrompt = previousRun
        ? buildInterruptionPrompt(previousRun, run, projectRuntime.room.members)
        : undefined;

      let result: { text: string; messageId?: string };
      try {
        result = await runWithTimeout(options.runtime.run({
          workspacePath: projectRuntime.project.workspacePath,
          sessionId: runtimeSessionId,
          prompt: await buildRuntimePrompt(
            projectRuntime.project.workspacePath,
            [interruptionPrompt, run.extraPrompt, run.prompt].filter(Boolean).join("\n\n"),
            run.contexts,
            projectRuntime.project.name
          )
        }), options.runTimeoutMs, () => options.runtime.cancel({
          workspacePath: projectRuntime.project.workspacePath,
          sessionId: runtimeSessionId
        })).finally(stopEvents);
      } catch (error) {
        const latestAfterFailure = await store.get(runId);
        if (latestAfterFailure?.status === "cancelled") {
          await recordCancelledFileChanges(projectId, runId, projectRuntime.project.workspacePath, runtimeSessionId, workspaceBefore);
          return;
        }
        throw error;
      }
      const latest = await store.get(runId);
      if (latest?.status === "cancelled") {
        await recordCancelledFileChanges(projectId, runId, projectRuntime.project.workspacePath, runtimeSessionId, workspaceBefore, result.messageId);
        return;
      }
      const runtimeFileChanges = await options.runtime.getDiff({
        workspacePath: projectRuntime.project.workspacePath,
        sessionId: runtimeSessionId,
        messageId: result.messageId
      });
      const workspaceAfter = await createAgentWorkspaceSnapshot(
        projectRuntime.project.workspacePath
      );
      const fileChanges = mergeFileChanges(
        compareAgentWorkspaceSnapshots(workspaceBefore, workspaceAfter),
        runtimeFileChanges
      );
      for (const change of fileChanges) {
        const previousRevision = revisionsBefore.get(change.file) ?? 0;
        const currentRevision = projectRuntime.documents.getRevision(change.file);
        if (currentRevision <= previousRevision) continue;
        await appendTrace(projectId, runId, {
          type: "concurrent_change",
          summary: `${change.file} was edited by a member while the Agent was running`,
          data: {
            path: change.file,
            previousRevision,
            currentRevision
          }
        });
      }
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
      activeRuns.delete(runId);
    }
  }

  return {
    async initialize() {
      const projects = await options.registry.listProjects();
      for (const project of projects) {
        await migrateLegacySessions(project.id);
        const store = getStore(project.id);
        const interrupted = (await store.list()).filter(
          (run) => run.status === "queued" || run.status === "running"
        );
        for (const run of interrupted) {
          const message = "Agent run was interrupted by a server restart";
          await updateRun(project.id, run.id, {
            status: "failed",
            error: message,
            finishedAt: new Date().toISOString()
          });
          await appendTrace(project.id, run.id, {
            type: "run_failed",
            summary: message
          });
          appendActivity(project.id, {
            type: "agent_task_failed",
            memberId: run.memberId,
            participantId: run.participantId,
            payload: {
              runId: run.id,
              sessionId: run.sessionId,
              name: run.memberName,
              error: message
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
      const store = getStore(input.projectId);
      const sessionStore = getSessionStore(input.projectId);
      let session = input.sessionId
        ? await sessionStore.get(input.sessionId)
        : undefined;
      if (session) {
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
        status: "queued",
        runtime: "opencode",
        provider: "deepseek",
        model: settings.model,
        source: input.source ?? "agent-panel",
        chatMessageId: input.chatMessageId,
        extraPrompt: input.extraPrompt?.trim() || undefined,
        interruptsRunId: input.interruptsRunId
      }, input.runId);
      emit({ type: "run_updated", projectId: input.projectId, run });
      await appendTrace(input.projectId, run.id, {
        type: "run_queued",
        summary: "Agent run queued"
      });
      getQueue(input.projectId).runIds.push(run.id);
      setImmediate(() => void processQueue(input.projectId));
      return run;
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
      if (["completed", "failed", "cancelled"].includes(run.status)) return run;

      const queue = getQueue(projectId);
      queue.runIds = queue.runIds.filter((queuedRunId) => queuedRunId !== runId);
      const cancelled = await updateRun(projectId, runId, {
        status: "cancelled",
        finishedAt: new Date().toISOString(),
        interruptedByRunId: interruptedBy?.runId,
        interruptedByMemberId: interruptedBy?.memberId
      });
      await appendTrace(projectId, runId, {
        type: interruptedBy ? "run_interrupted" : "run_cancelled",
        summary: interruptedBy ? "Agent run interrupted" : "Agent run cancelled",
        data: interruptedBy ? { interruptedByRunId: interruptedBy.runId, interruptedByMemberId: interruptedBy.memberId } : undefined
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
        await options.runtime.cancel({
          workspacePath: active.workspacePath,
          sessionId: active.runtimeSessionId
        });
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
          (queue) => queue.processing || queue.runIds.length > 0
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
      queue.runIds = queue.runIds.filter((runId) => !activeIds.has(runId));

      for (const run of active) {
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
      queues.delete(projectId);
      stores.delete(projectId);
      for (const key of traces.keys()) {
        if (key.startsWith(`${projectId}:`)) traces.delete(key);
      }
      sessionStores.delete(projectId);
    },
    async dispose() {
      disposing = true;
      await Promise.all(
        [...activeRuns.values()].map((active) =>
          options.runtime.cancel({
            workspacePath: active.workspacePath,
            sessionId: active.runtimeSessionId
          })
        )
      );
      await Promise.all(
        [...queues.values()]
          .map((queue) => queue.completion)
          .filter((completion): completion is Promise<void> => Boolean(completion))
      );
      listeners.clear();
    }
  };
}

export type AgentRunManager = ReturnType<typeof createAgentRunManager>;
