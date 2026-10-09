import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import type { AgentSettingsResponse } from "@simplercp/shared";
import { createOpencodeClient } from "@opencode-ai/sdk/v2";
import { promisify } from "node:util";
import { nanoid } from "nanoid";
import { AgentRuntimeRequestError, safeRequestTarget } from "./agentRunFailure.js";
import type { AgentRuntime } from "./agentRuntime.js";
import { normalizeAgentUsage } from "./agentUsage.js";
import {
  createOpenCodeProcess,
  openCodeProviderId
} from "./openCodeProcess.js";

const execFileAsync = promisify(execFile);

interface OpenCodeRuntimeOptions {
  port: number;
  provider?: "deepseek" | "minimax";
  apiKey?: string;
  baseUrl: string;
  getSettings(): AgentSettingsResponse;
  mcp?: { url: string | (() => string); token: string };
  activityConfig?: { waitingMs: number; stalledMs: number };
  createProcess?: typeof createOpenCodeProcess;
}

export function createOpenCodeRuntime(
  options: OpenCodeRuntimeOptions
): AgentRuntime {
  let process = createProcess();
  let processModel = options.getSettings().model;
  let processProvider = options.getSettings().provider;
  let activeRunCount = 0;
  let modelChangePromise: Promise<void> | undefined;
  const subscriptions = new Map<string, { error?: unknown }>();
  const pending = new Map<string, { userMessageId: string; assistantId?: string; complete(): Promise<void>; reject(error: unknown): void; controller: AbortController }>();

  function createProcess(model = options.getSettings().model) {
    const settings = options.getSettings();
    return (options.createProcess ?? createOpenCodeProcess)({
      port: options.port,
      provider: settings.provider,
      apiKey: options.apiKey,
      baseUrl: options.baseUrl,
      model,
      mcp: options.mcp
    });
  }

  async function ensureCurrentProcess() {
    if (modelChangePromise) await modelChangePromise;
    const model = options.getSettings().model;
    const provider = options.getSettings().provider;
    if ((model !== processModel || provider !== processProvider) && activeRunCount === 0) await startModelSwitch(model);
    return process;
  }
  function startModelSwitch(targetModel: string) {
    if (!modelChangePromise) {
      modelChangePromise = (async () => {
        await process.dispose();
        process = createProcess(targetModel);
        processModel = targetModel;
        processProvider = options.getSettings().provider;
      })().finally(() => { modelChangePromise = undefined; });
    }
    return modelChangePromise;
  }

  async function getClient(workspacePath: string) {
    const current = await ensureCurrentProcess();
    const running = await current.start();
    return createOpencodeClient({
      baseUrl: running.url,
      directory: workspacePath,
      fetch: async (request) => {
        const target = safeRequestTarget(request instanceof Request ? request.url : String(request));
        try {
          const response = await fetch(request);
          if (!response.ok) throw new AgentRuntimeRequestError({ source: "local-runtime", target, statusCode: response.status, errorType: "HttpError", message: `OpenCode HTTP ${response.status}: ${response.statusText}` });
          return response;
        } catch (error) {
          if (error instanceof AgentRuntimeRequestError) throw error;
          throw new AgentRuntimeRequestError({ source: "local-runtime", target, errorType: error instanceof Error ? error.name : "NetworkError", message: error instanceof Error ? error.message : String(error) }, error);
        }
      }
    });
  }

  function requireAvailableSettings() {
    const settings = options.getSettings();
    if (!settings.enabled) throw new Error("Agent is disabled");
    if (!options.apiKey) throw new Error(`${settings.provider === "minimax" ? "MINIMAX_API_KEY" : "DEEPSEEK_API_KEY"} is required`);
    return settings;
  }

  const runtime: AgentRuntime = {
    acquireRun() {
      const wasIdle = activeRunCount === 0;
      activeRunCount += 1;
      if (wasIdle && options.getSettings().model !== processModel) void startModelSwitch(options.getSettings().model).catch((error) => console.error("Agent runtime model switch failed", error));
      let released = false;
      return () => {
        if (released) return;
        released = true;
        activeRunCount = Math.max(0, activeRunCount - 1);
        if (activeRunCount === 0 && options.getSettings().model !== processModel) void ensureCurrentProcess().catch((error) => console.error("Agent runtime model switch failed", error));
      };
    },
    getCurrentModel: () => processModel,
    async prepareWorkspace(workspacePath: string) {
      return ensureWorkspaceRepository(workspacePath);
    },
    async status() {
      const settings = options.getSettings();
      if (!settings.enabled) {
        return {
          runtime: "opencode",
          state: "disabled",
          model: settings.model,
          provider: settings.provider,
          apiKeyConfigured: settings.apiKeyConfigured,
          activityConfig: options.activityConfig,
          ...(settings.model !== processModel && activeRunCount > 0 ? { modelChangePending: true } : {})
        };
      }
      const current = await ensureCurrentProcess();
      const running = await current.start();
      return {
        runtime: "opencode",
        state: "ready",
        version: running.version,
        model: processModel,
        provider: processProvider,
        apiKeyConfigured: settings.apiKeyConfigured,
        activityConfig: options.activityConfig,
        ...(settings.model !== processModel && activeRunCount > 0 ? { modelChangePending: true } : {})
      };
    },
    async createSession(input) {
      const settings = requireAvailableSettings();
      const client = await getClient(input.workspacePath);
      const response = await client.session.create(
        {
          directory: input.workspacePath,
          title: input.title,
          agent: "build",
          model: {
            id: processModel,
            providerID: openCodeProviderId(processProvider)
          }
        },
        { throwOnError: true }
      );
      return { id: response.data.id };
    },
    async run(input) {
      requireAvailableSettings();
      if (pending.has(input.sessionId)) throw new Error("同一 OpenCode 会话已有活动任务");
      let client: Awaited<ReturnType<typeof getClient>>;
      let stopOwnSubscription: (() => Promise<void>) | undefined;
      const userMessageId = `msg_${nanoid(26)}`;
      const controller = new AbortController();
      let resolve!: (result: { text: string; messageId: string }) => void;
      let reject!: (error: unknown) => void;
      const finished = new Promise<{ text: string; messageId: string }>((accept, fail) => { resolve = accept; reject = fail; });
      void finished.catch(() => undefined);
      const operation = {
        userMessageId, assistantId: undefined as string | undefined, controller, reject, completing: false,
        async complete() {
          if (!operation.assistantId || operation.completing || pending.get(input.sessionId) !== operation) return;
          operation.completing = true;
          try {
            const response = await client.session.message({ sessionID: input.sessionId, messageID: operation.assistantId }, { throwOnError: true, signal: controller.signal });
            if (response.data.info.role !== "assistant" || response.data.info.parentID !== userMessageId) throw new Error("OpenCode 返回的消息不属于本次任务");
            if (response.data.info.error) throw providerFailure(response.data.info.error, options.apiKey, options.baseUrl);
            const text = response.data.parts.filter((part) => part.type === "text").map((part) => part.text).join("\n");
            if (!text.trim()) throw new Error("OpenCode returned an empty response");
            resolve({ text, messageId: userMessageId });
          } catch (error) { reject(error); }
        }
      };
      pending.set(input.sessionId, operation);
      try {
        client = await getClient(input.workspacePath);
        controller.signal.throwIfAborted();
        if (!subscriptions.has(input.sessionId)) stopOwnSubscription = await runtime.subscribe(input, () => {});
        controller.signal.throwIfAborted();
        const subscription = subscriptions.get(input.sessionId);
        if (!subscription) throw new Error("OpenCode 任务缺少活动事件连接");
        if (subscription.error) throw subscription.error;
        await client.session.promptAsync({
          directory: input.workspacePath,
          sessionID: input.sessionId,
          messageID: userMessageId,
          agent: "build",
          ...(input.system ? {system: input.system} : {}),
          model: {
            providerID: openCodeProviderId(processProvider),
            modelID: input.model ?? processModel
          },
          ...(input.purpose === "knowledge-recap" ? {
            tools: { bash: false, edit: false, write: false, apply_patch: false, read: false, glob: false, grep: false, list: false, webfetch: false, websearch: false, task: false, question: false, todowrite: false, knowledge_knowledge_search: false, knowledge_knowledge_get: false, knowledge_knowledge_propose: false }
          } : {}),
          parts: [{ type: "text", text: input.prompt }]
        }, { throwOnError: true, signal: controller.signal });
        return await finished;
      } finally { controller.abort(); if (pending.get(input.sessionId) === operation) pending.delete(input.sessionId); await stopOwnSubscription?.(); }
    },
    async getDiff(input) {
      const client = await getClient(input.workspacePath);
      const response = await client.session.diff(
        {
          directory: input.workspacePath,
          sessionID: input.sessionId,
          ...(input.messageId ? { messageID: input.messageId } : {})
        },
        { throwOnError: true }
      );
      return response.data.flatMap((change) =>
        change.file
          ? [{
              file: change.file,
              patch: change.patch,
              additions: change.additions,
              deletions: change.deletions,
              status: change.status
            }]
          : []
      );
    },
    async cancel(input) {
      const operation = pending.get(input.sessionId);
      operation?.controller.abort();
      operation?.reject(new Error("Agent 任务已取消"));
      const client = await getClient(input.workspacePath);
      await client.session.abort(
        {
          directory: input.workspacePath,
          sessionID: input.sessionId
        },
        { throwOnError: true, signal: input.signal ?? AbortSignal.timeout(10_000) }
      );
    },
    async replyQuestion(input) {
      const client = await getClient(input.workspacePath);
      await client.question.reply({ directory: input.workspacePath, requestID: input.requestId, answers: input.answers }, { throwOnError: true, signal: input.signal ?? AbortSignal.timeout(10_000) });
    },
    async rejectQuestion(input) {
      const client = await getClient(input.workspacePath);
      await client.question.reject({ directory: input.workspacePath, requestID: input.requestId }, { throwOnError: true, signal: input.signal ?? AbortSignal.timeout(10_000) });
    },
    async subscribe(input, listener, onListenerError) {
      const client = await getClient(input.workspacePath);
      const controller = new AbortController();
      const state: { error?: unknown } = {};
      subscriptions.set(input.sessionId, state);
      const fail = (error: unknown) => { state.error = error; pending.get(input.sessionId)?.reject(error); };
      const subscription = await client.event.subscribe(
        { directory: input.workspacePath },
        { signal: controller.signal, sseMaxRetryAttempts: 1, onSseError(error) { if (!controller.signal.aborted) fail(new AgentRuntimeRequestError({ source: "local-runtime", target: "OpenCode /event", phase: "streaming", message: error instanceof Error ? error.message : String(error) }, error)); } }
      );
      const completion = (async () => {
        const belongsToRun = createRunSessionFilter(input.sessionId);
        for await (const event of subscription.stream) {
          if (!belongsToRun(event)) continue;
          const properties = event.properties as Record<string, unknown>;
          const operation = pending.get(input.sessionId);
          const info = properties.info as { id?: string; role?: string; parentID?: string } | undefined;
          if (operation && event.type === "message.updated" && info?.role === "assistant" && info.parentID === operation.userMessageId) operation.assistantId = info.id;
          if (operation && event.type === "session.error" && properties.sessionID === input.sessionId) operation.reject(providerFailure(properties.error as { name: string; data: Record<string, unknown> }, options.apiKey, options.baseUrl));
          const usage = event.type === "message.updated" ? normalizeAgentUsage(properties.info) : undefined;
          try {
            await listener({ type: event.type, data: usage ? { ...properties, usageSummary: usage } : properties });
          } catch (error) {
            fail(error);
            try { await onListenerError?.(error); } catch (reportError) { console.error("Agent runtime listener error reporting failed", reportError); }
            break;
          }
          if (operation && properties.sessionID === input.sessionId && (event.type === "session.idle" || event.type === "session.status" && (properties.status as { type?: string } | undefined)?.type === "idle")) await operation.complete();
        }
        if (!controller.signal.aborted) fail(new AgentRuntimeRequestError({ source: "local-runtime", target: "OpenCode /event", phase: "streaming", errorType: "EventStreamClosed", retryable: true, message: "OpenCode 事件连接提前结束" }));
      })().catch((error) => { if (!controller.signal.aborted) fail(error); });
      return async () => {
        controller.abort();
        if (subscriptions.get(input.sessionId) === state) subscriptions.delete(input.sessionId);
        pending.get(input.sessionId)?.reject(new Error("OpenCode 事件连接已经关闭"));
        await completion;
      };
    },
    async dispose() {
      for (const operation of pending.values()) { operation.controller.abort(); operation.reject(new Error("Agent 服务已经关闭")); }
      pending.clear();
      await process.dispose();
    }
  };
  return runtime;
}

export async function ensureWorkspaceRepository(workspacePath: string) {
  const gitPath = path.join(workspacePath, ".git");
  const repositoryExists = await fs.stat(gitPath)
    .then(() => true)
    .catch((error: unknown) => {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return false;
      throw error;
    });
  if (repositoryExists) return false;
  await execFileAsync("git", ["init", "--quiet", workspacePath]);
  return true;
}

function providerFailure(
  error: { name: string; data: Record<string, unknown> },
  apiKey: string | undefined,
  baseUrl: string
) {
  const statusCode = typeof error.data.statusCode === "number"
    ? ` (${error.data.statusCode})`
    : "";
  const rawMessage = typeof error.data.message === "string"
    ? error.data.message
    : error.name;
  const message = apiKey
    ? rawMessage.split(apiKey).join("[REDACTED]")
    : rawMessage;
  return new AgentRuntimeRequestError({ source: "model-provider", target: safeRequestTarget(`${baseUrl.replace(/\/$/, "")}/chat/completions`), errorType: error.name, ...(typeof error.data.statusCode === "number" ? { statusCode: error.data.statusCode } : {}), message: `OpenCode Provider request failed${statusCode}: ${message}` });
}

export function createRunSessionFilter(sessionId: string) {
  const sessions = new Set([sessionId]);
  return (event: { type: string; properties: unknown }) => {
    const properties = event.properties as { sessionID?: string; info?: { id?: string; parentID?: string; sessionID?: string }; part?: { sessionID?: string } };
    if (event.type === "session.created" && properties.info?.id && properties.info.parentID && sessions.has(properties.info.parentID)) sessions.add(properties.info.id);
    return [properties.sessionID, properties.info?.sessionID, properties.part?.sessionID, event.type.startsWith("session.") ? properties.info?.id : undefined].some((id) => id !== undefined && sessions.has(id));
  };
}
