import crypto from "node:crypto";
import diff from "fast-diff";
import type { AgentRun, AgentTraceEvent, EventRecord } from "@simplercp/shared";
import { buildAgentRecapSystemPrompt, parseAgentRecapDraft } from "@simplercp/knowledge";
import type { AgentRuntime } from "./agentRuntime.js";
import type { AgentRunStore } from "./agentRunStore.js";
import type { AgentSessionStore } from "./agentSessionStore.js";
import type { ProjectRuntimeManager } from "../projectRuntimeManager.js";
import type { createAgentWorkspaceSnapshot } from "./agentWorkspaceSnapshot.js";
import { createAgentSessionOperations } from "./agentSessionOperations.js";
import { createAgentUsageCollector, estimateAgentUsageCost, toLlmUsage } from "./agentUsage.js";
import { executeRuntimePrompt } from "./agentRuntimeExecution.js";

type Snapshot = Awaited<ReturnType<typeof createAgentWorkspaceSnapshot>>;

export function withSnapshotContents(changes: NonNullable<AgentRun["fileChanges"]>, before: Snapshot, after: Snapshot) {
  return changes.map((change) => ({
    ...change,
    ...(before.get(change.file)?.content !== undefined ? { beforeText: before.get(change.file)!.content } : {}),
    ...(after.get(change.file)?.content !== undefined ? { afterText: after.get(change.file)!.content } : {})
  }));
}

export function agentInsertedRanges(changes: NonNullable<AgentRun["fileChanges"]>, ownerId: string) {
  return changes.flatMap((change) => {
    if (change.afterText === undefined || change.attribution === "ambiguous") return [];
    let offset = 0;
    const ranges: Array<{ file: string; start: number; end: number; text: string; ownerId: string }> = [];
    for (const [operation, text] of diff(change.beforeText ?? "", change.afterText)) {
      if (operation === diff.EQUAL) offset += text.length;
      if (operation === diff.INSERT) {
        ranges.push({ file: change.file, start: offset, end: offset + text.length, text, ownerId });
        offset += text.length;
      }
    }
    return ranges;
  });
}

export function extractAgentToolEvent(type: string, data: Record<string, unknown>, run: AgentRun) {
  const part = (data.part && typeof data.part === "object" ? data.part : data) as Record<string, unknown>;
  const state = (part.state && typeof part.state === "object" ? part.state : part) as Record<string, unknown>;
  const input = (state.input && typeof state.input === "object" ? state.input : {}) as Record<string, unknown>;
  const toolName = typeof part.tool === "string" ? part.tool : typeof state.tool === "string" ? state.tool : undefined;
  if (!type.toLowerCase().includes("tool") && part.type !== "tool" && !toolName) return;
  const status = typeof state.status === "string" ? state.status : undefined;
  if (status && !["completed", "success", "error", "failed"].includes(status)) return;
  if (!status && typeof data.success !== "boolean") return;
  const command = typeof input.command === "string" ? input.command : typeof input.cmd === "string" ? input.cmd : typeof state.command === "string" ? state.command : undefined;
  const rawError = state.error ?? data.error;
  const error = rawError === undefined ? undefined : (typeof rawError === "string" ? rawError : JSON.stringify(rawError)).slice(0, 2000);
  const metadata = state.metadata as Record<string, unknown> | undefined;
  const exitCode = typeof state.exitCode === "number" ? state.exitCode : typeof metadata?.exitCode === "number" ? metadata.exitCode : undefined;
  return { runId: run.id, memberId: run.initiatorMemberId ?? run.memberId, tool: toolName ?? "tool", command, success: status === "completed" || status === "success" || (!status && data.success === true), exitCode, error };
}

interface KnowledgeHooksOptions {
  runtime: AgentRuntime;
  runtimeManager: ProjectRuntimeManager;
  getStore(projectId: string): AgentRunStore;
  getSessionStore(projectId: string): AgentSessionStore;
  listTrace(projectId: string, runId: string): Promise<AgentTraceEvent[]>;
  appendTrace(projectId: string, runId: string, input: Omit<AgentTraceEvent, "sequence" | "timestamp">): Promise<AgentTraceEvent>;
  appendActivity(projectId: string, input: Omit<EventRecord, "id" | "timestamp">): void;
  isClosing(projectId: string): boolean;
  runTimeoutMs: number;
  operations: ReturnType<typeof createAgentSessionOperations>;
}

export function createAgentKnowledgeHooks(options: KnowledgeHooksOptions) {
  const postChecks = new Set<string>();
  const selfRecaps = new Map<Promise<unknown>, { projectId: string; active?: { workspacePath: string; runtimeSessionId: string } }>();

  async function postCheck(projectId: string, run: AgentRun) {
    const key = `${projectId}:${run.id}`;
    if (postChecks.has(key)) return;
    const provider = options.runtimeManager.find(projectId)?.knowledgeProvider;
    if (!provider || (provider.mode !== "inject" && provider.mode !== "full")) return;
    postChecks.add(key);
    const result = await provider.postRunCheck(run);
    options.appendActivity(projectId, { type: "knowledge_post_check", memberId: run.initiatorMemberId ?? run.memberId, payload: { runId: run.id, hits: result.hits } });
    await options.appendTrace(projectId, run.id, { type: "knowledge_post_check", data: { hits: result.hits } });
  }

  async function requestAgentSelfRecap(projectId: string, runId: string, evidence: Record<string, unknown>) {
    const run = await options.getStore(projectId).get(runId);
    if (!run?.sessionId) throw new Error("Agent session is unavailable for self recap");
    if (!["completed", "failed", "cancelled"].includes(run.status)) throw Object.assign(new Error("Agent run must finish before self recap"), { statusCode: 409 });
    const state: { projectId: string; active?: { workspacePath: string; runtimeSessionId: string } } = { projectId };
    const operation = options.operations.run(`${projectId}:${run.sessionId}`, async () => {
      if (options.isClosing(projectId)) throw new Error("Agent run manager is closing");
      const projectRuntime = options.runtimeManager.get(projectId);
      const session = await options.getSessionStore(projectId).get(run.sessionId!);
      if (!session || session.deletedAt) throw new Error("Agent session is unavailable for self recap");
      const sessionId = run.runtimeSessionId ?? session.runtimeSessionId;
      if (!sessionId) throw new Error("Agent runtime session is unavailable for self recap");
      const prompt = [buildAgentRecapSystemPrompt(evidence, (await projectRuntime.knowledgeProvider?.getConfig())?.recapLanguage ?? "zh"), "Review the completed Agent task using only this evidence.", `AGENT CORRECTION EVIDENCE (JSON):\n${JSON.stringify(evidence)}`].join("\n\n");
      const promptHash = crypto.createHash("sha256").update(prompt).digest("hex");
      const release = options.runtime.acquireRun?.();
      const provider = run.provider;
      const model = options.runtime.getCurrentModel?.() ?? run.model;
      const observedUsage = createAgentUsageCollector();
      state.active = { workspacePath: projectRuntime.project.workspacePath, runtimeSessionId: sessionId };
      try {
        const result = await executeRuntimePrompt({ runtime: options.runtime, input: { workspacePath: projectRuntime.project.workspacePath, sessionId, prompt, purpose: "knowledge-recap", model }, timeoutMs: options.runTimeoutMs, usage: observedUsage, onEvent: (event) => observedUsage.observe(event), onSubscriptionError: async (error) => { await options.appendTrace(projectId, runId, { type: "runtime_subscription_error", summary: error instanceof Error ? error.message : String(error) }); } });
        if (!parseAgentRecapDraft(result.text, evidence)) throw new Error("Agent self recap returned invalid JSON");
        const usage = estimateAgentUsageCost(observedUsage.total(), provider, model);
        await options.appendTrace(projectId, runId, { type: "knowledge_recap_self", data: { outputHash: crypto.createHash("sha256").update(result.text).digest("hex"), promptHash, chars: result.text.length, provider, model, usage, completed: true } });
        return { text: result.text, provider, model, promptHash, usage: toLlmUsage(usage) };
      } catch (error) {
        const usage = estimateAgentUsageCost(observedUsage.total(), provider, model);
        const recapError = Object.assign(new Error(error instanceof Error ? error.message : String(error)), { promptHash, provider, model, usage: toLlmUsage(usage) });
        await options.appendTrace(projectId, runId, { type: "knowledge_recap_self", data: { promptHash, provider, model, error: recapError.message, usage, completed: false } });
        throw recapError;
      } finally { state.active = undefined; release?.(); }
    });
    selfRecaps.set(operation, state);
    try { return await operation; } finally { selfRecaps.delete(operation); }
  }

  return {
    postCheck,
    requestAgentSelfRecap,
    bind(projectId: string) {
      const runtime = options.runtimeManager.get(projectId);
      const provider = runtime.knowledgeProvider;
      if (!provider) return;
      provider.bind({
        listRuns: (id) => options.getStore(id).list(),
        listTrace: options.listTrace,
        appendTrace: async (id, runId, event) => { await options.appendTrace(id, runId, event); },
        notify: (memberId, message) => runtime.notifyKnowledge(memberId, message),
        async createSystemMessage(run, text) {
          const session = run.sessionId ? await options.getSessionStore(projectId).get(run.sessionId) : undefined;
          if (session?.scope !== "team") return;
          await runtime.chat.createMessage({ roomId: runtime.room.id, authorId: "agent", authorName: "System", kind: "system", agentSessionId: session.id, runId: run.id, text });
        }
      });
      runtime.capture?.bindAgentSelfRecap((suggestion) => requestAgentSelfRecap(projectId, suggestion.actors.runIds[0] ?? "", suggestion.evidence), () => provider.getConfig().then((value) => value.recapMode));
    },
    hasActiveTasks: () => selfRecaps.size > 0,
    async disposeProject(projectId: string) {
      const operations = [...selfRecaps].filter(([, state]) => state.projectId === projectId);
      await Promise.all(operations.flatMap(([, state]) => state.active ? [options.runtime.cancel({ workspacePath: state.active.workspacePath, sessionId: state.active.runtimeSessionId })] : []));
      await Promise.allSettled(operations.map(([operation]) => operation));
      for (const key of postChecks) if (key.startsWith(`${projectId}:`)) postChecks.delete(key);
    }
  };
}
