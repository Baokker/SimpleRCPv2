import path from "node:path";
import type {
  AgentFileChange,
  AgentRun,
  AgentSettingsResponse,
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
import type { ProjectRegistry } from "../projects.js";
import type { ProjectRuntimeManager } from "../projectRuntimeManager.js";
import {
  compareAgentWorkspaceSnapshots,
  createAgentWorkspaceSnapshot
} from "./agentWorkspaceSnapshot.js";
import { readWorkspaceFile } from "../workspace.js";

interface AgentRunManagerOptions {
  runtime: AgentRuntime;
  registry: ProjectRegistry;
  runtimeManager: ProjectRuntimeManager;
  getSettings(): AgentSettingsResponse;
  apiKey?: string;
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
    };

export function createAgentRunManager(options: AgentRunManagerOptions) {
  const stores = new Map<string, AgentRunStore>();
  const sessionStores = new Map<string, AgentSessionStore>();
  const traces = new Map<string, TraceStore>();
  const queues = new Map<string, ProjectQueue>();
  const activeRuns = new Map<string, ActiveRun>();
  const listeners = new Set<(event: AgentRunManagerEvent) => void>();
  let disposing = false;

  function getStore(projectId: string) {
    const existing = stores.get(projectId);
    if (existing) return existing;
    const project = options.registry.getProject(projectId);
    if (!project) throw new Error("Project not found");
    const store = createAgentRunStore(projectId, path.dirname(project.workspacePath));
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
      options.apiKey ? [options.apiKey] : []
    );
    traces.set(key, trace);
    return trace;
  }

  function getSessionStore(projectId: string) {
    const existing = sessionStores.get(projectId);
    if (existing) return existing;
    const project = options.registry.getProject(projectId);
    if (!project) throw new Error("Project not found");
    const store = createAgentSessionStore(projectId, path.dirname(project.workspacePath));
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

  async function migrateLegacySessions(projectId: string) {
    const runStore = getStore(projectId);
    const sessionStore = getSessionStore(projectId);
    const runs = await runStore.list();
    const migrated = new Map<string, Awaited<ReturnType<typeof sessionStore.create>>>();

    for (const run of runs) {
      if (run.sessionId && await sessionStore.get(run.sessionId)) continue;
      const legacyRuntimeSessionId = run.runtimeSessionId ?? run.sessionId;
      const migrationKey = `${run.memberId}:${legacyRuntimeSessionId ?? run.id}`;
      let session = migrated.get(migrationKey);
      if (!session) {
        session = await sessionStore.create({
          projectId,
          memberId: run.memberId,
          memberName: run.memberName,
          title: run.prompt.slice(0, 80),
          runtime: "opencode",
          runtimeSessionId: legacyRuntimeSessionId,
          lastRunId: run.id
        });
        migrated.set(migrationKey, session);
      }
      await runStore.update(run.id, {
        sessionId: session.id,
        runtimeSessionId: legacyRuntimeSessionId
      });
    }
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

  async function executeRun(projectId: string, runId: string) {
    const store = getStore(projectId);
    const current = await store.get(runId);
    if (!current || current.status !== "queued") return;
    try {
      const projectRuntime = options.runtimeManager.get(projectId);
      await projectRuntime.documents.awaitIdle();
      const workspaceBefore = await createAgentWorkspaceSnapshot(
        projectRuntime.project.workspacePath
      );
      const revisionsBefore = projectRuntime.documents.getRevisions();
      const startedAt = new Date().toISOString();
      let run = await updateRun(projectId, runId, {
        status: "running",
        startedAt
      });
      await appendTrace(projectId, runId, {
        type: "run_started",
        summary: "Agent run started"
      });

      const session = run.sessionId
        ? await getSessionStore(projectId).get(run.sessionId)
        : undefined;
      if (!session) throw new Error("Agent session not found");
      let runtimeSessionId = run.runtimeSessionId ?? session.runtimeSessionId;
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
        payload: {
          runId: run.id,
          sessionId: run.sessionId,
          sessionTitle: session.title,
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

      const result = await runWithTimeout(
        options.runtime.run({
          workspacePath: projectRuntime.project.workspacePath,
          sessionId: runtimeSessionId,
          prompt: await buildRuntimePrompt(projectRuntime.project.workspacePath, run.prompt, run.contexts)
        }),
        options.runTimeoutMs,
        () =>
          options.runtime.cancel({
            workspacePath: projectRuntime.project.workspacePath,
          sessionId: runtimeSessionId
          })
      ).finally(stopEvents);
      const latest = await store.get(runId);
      if (latest?.status === "cancelled") return;
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
      appendActivity(projectId, {
        type: "agent_task_completed",
        memberId: run.memberId,
        payload: {
          runId: run.id,
          sessionId: run.sessionId,
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
        payload: {
          runId: current.id,
          sessionId: current.sessionId,
          error: message
        }
      });
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
        }
      }
    },
    async createRun(input: {
      projectId: string;
      memberId: string;
      prompt: string;
      sessionId?: string;
      contexts?: AgentPromptContext[];
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
      if (session && session.memberId !== input.memberId) {
        throw new Error("Agent session belongs to another member");
      }
      if (!session) {
        if (input.sessionId) throw new Error("Agent session not found");
        session = await sessionStore.create({
          projectId: input.projectId,
          memberId: input.memberId,
          memberName: member.displayName,
          title: prompt.slice(0, 80),
          runtime: "opencode"
        });
      }
      const contexts = normalizeAgentContexts(input.contexts);
      const run = await store.create({
        projectId: input.projectId,
        memberId: input.memberId,
        memberName: member.displayName,
        prompt,
        contexts,
        sessionId: session.id,
        runtimeSessionId: session.runtimeSessionId,
        status: "queued",
        runtime: "opencode",
        provider: "deepseek",
        model: settings.model
      });
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
        memberName: member.displayName,
        title,
        runtime: "opencode"
      });
    },
    async getSession(projectId: string, sessionId: string) {
      const session = await getSessionStore(projectId).get(sessionId);
      if (!session) throw new Error("Agent session not found");
      return session;
    },
    async listSessions(projectId: string, memberId: string) {
      const projectRuntime = options.runtimeManager.get(projectId);
      if (!projectRuntime.rooms.getMember(projectRuntime.room.id, memberId)) {
        throw new Error("Project membership is required");
      }
      return getSessionStore(projectId).list(memberId);
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
    async cancelRun(projectId: string, runId: string, memberId: string) {
      const projectRuntime = options.runtimeManager.get(projectId);
      if (!projectRuntime.rooms.getMember(projectRuntime.room.id, memberId)) {
        throw new Error("Project membership is required");
      }
      const store = getStore(projectId);
      const run = await store.get(runId);
      if (!run) throw new Error("Agent run not found");
      if (run.memberId !== memberId) {
        throw new Error("Agent run belongs to another member");
      }
      if (["completed", "failed", "cancelled"].includes(run.status)) return run;

      const queue = getQueue(projectId);
      queue.runIds = queue.runIds.filter((queuedRunId) => queuedRunId !== runId);
      const cancelled = await updateRun(projectId, runId, {
        status: "cancelled",
        finishedAt: new Date().toISOString()
      });
      await appendTrace(projectId, runId, {
        type: "run_cancelled",
        summary: "Agent run cancelled"
      });
      appendActivity(projectId, {
        type: "agent_task_cancelled",
        memberId: run.memberId,
        payload: {
          runId: run.id,
          sessionId: run.sessionId
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
          payload: {
            runId: run.id,
            sessionId: run.sessionId,
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

async function buildRuntimePrompt(
  workspacePath: string,
  prompt: string,
  contexts: AgentPromptContext[] | undefined
) {
  if (!contexts || contexts.length === 0) return prompt;
  const sections: string[] = [];
  for (const context of contexts) {
    const result = await readWorkspaceFile(workspacePath, context.path);
    if (result.status !== "text") {
      throw new Error(`Agent context must be a text file smaller than 1 MB: ${context.path}`);
    }
    sections.push(`--- ${context.path} ---\n${result.content}\n--- end ${context.path} ---`);
  }
  return `Relevant project files:\n${sections.join("\n")}\n\nUser request:\n${prompt}`;
}

function previewPrompt(prompt: string) {
  const normalized = prompt.replace(/\s+/g, " ").trim();
  return normalized.length > 120 ? `${normalized.slice(0, 117)}…` : normalized;
}

function normalizeAgentContexts(contexts: AgentPromptContext[] | undefined) {
  if (!contexts) return undefined;
  if (!Array.isArray(contexts)) throw new Error("Agent contexts must be an array");
  const normalized = contexts.map((context) => {
    if (context?.type !== "file" || typeof context.path !== "string" || !context.path.trim()) {
      throw new Error("Invalid Agent file context");
    }
    return { type: "file" as const, path: context.path.trim() };
  });
  return normalized.length ? normalized : undefined;
}

async function runWithTimeout<T>(
  operation: Promise<T>,
  timeoutMs: number,
  cancel: () => Promise<void>
) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let cancellation: Promise<void> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      cancellation = cancel();
      reject(new Error(`Agent run exceeded ${timeoutMs} ms`));
    }, timeoutMs);
  });
  try {
    return await Promise.race([operation, timeout]);
  } catch (error) {
    if (cancellation) await cancellation;
    throw error;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function mergeFileChanges(
  workspaceChanges: AgentRun["fileChanges"] = [],
  runtimeChanges: AgentRun["fileChanges"] = []
) {
  const runtimeByFile = new Map(
    runtimeChanges.map((change) => [change.file, change])
  );
  const merged: AgentFileChange[] = workspaceChanges.map((change) => ({
    ...change,
    patch: runtimeByFile.get(change.file)?.patch
  }));
  const workspacePaths = new Set(workspaceChanges.map((change) => change.file));
  merged.push(
    ...runtimeChanges.filter((change) => !workspacePaths.has(change.file))
  );
  return merged;
}

export type AgentRunManager = ReturnType<typeof createAgentRunManager>;
