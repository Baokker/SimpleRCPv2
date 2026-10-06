import { execFile } from "node:child_process";
import { statSync } from "node:fs";
import path from "node:path";
import type { AgentSettingsResponse } from "@simplercp/shared";
import { createOpencodeClient } from "@opencode-ai/sdk/v2";
import { promisify } from "node:util";
import type { AgentRuntime } from "./agentRuntime.js";
import {
  createOpenCodeProcess,
  OPEN_CODE_PROVIDER_ID
} from "./openCodeProcess.js";

const execFileAsync = promisify(execFile);

interface OpenCodeRuntimeOptions {
  port: number;
  apiKey?: string;
  baseUrl: string;
  editPermission?: "allow" | "ask";
  getSettings(): AgentSettingsResponse;
  createProcess?: (options: {
    port: number;
    apiKey?: string;
    baseUrl: string;
    model: string;
    editPermission?: "allow" | "ask";
  }) => {
    start(): Promise<{ url: string; version: string }>;
    dispose(): Promise<void>;
  };
}

export function createOpenCodeRuntime(
  options: OpenCodeRuntimeOptions
): AgentRuntime {
  const processFactory = options.createProcess ?? createOpenCodeProcess;
  let process = createProcess();
  let processModel = options.getSettings().model;
  let activeRunCount = 0;
  let modelChangePromise: Promise<void> | undefined;

  function createProcess(model = options.getSettings().model) {
    return processFactory({
      port: options.port,
      apiKey: options.apiKey,
      baseUrl: options.baseUrl,
      model,
      editPermission: options.editPermission
    });
  }

  async function ensureCurrentProcess() {
    if (modelChangePromise) await modelChangePromise;
    const model = options.getSettings().model;
    if (model === processModel || activeRunCount > 0) return process;
    await startModelSwitch(model);
    return process;
  }

  function startModelSwitch(targetModel: string) {
    if (!modelChangePromise) {
      modelChangePromise = (async () => {
        await process.dispose();
        process = createProcess(targetModel);
        processModel = targetModel;
      })().finally(() => { modelChangePromise = undefined; });
    }
    return modelChangePromise;
  }

  async function getClient(workspacePath: string) {
    const current = await ensureCurrentProcess();
    const running = await current.start();
    return createOpencodeClient({
      baseUrl: running.url,
      directory: workspacePath
    });
  }

  function requireAvailableSettings() {
    const settings = options.getSettings();
    if (!settings.enabled) throw new Error("Agent is disabled");
    if (!options.apiKey) throw new Error("DEEPSEEK_API_KEY is required");
    return settings;
  }

  return {
    acquireRun() {
      const wasIdle = activeRunCount === 0;
      activeRunCount += 1;
      if (wasIdle && options.getSettings().model !== processModel) void startModelSwitch(options.getSettings().model).catch((error) => console.error("Agent runtime model switch failed", error));
      let released = false;
      return () => {
        if (released) return;
        released = true;
        activeRunCount = Math.max(0, activeRunCount - 1);
        if (activeRunCount === 0 && options.getSettings().model !== processModel) {
          void ensureCurrentProcess().catch((error) => console.error("Agent runtime model switch failed", error));
        }
      };
    },
    setActiveRunCount(count: number) {
      activeRunCount = count;
      if (activeRunCount === 0 && options.getSettings().model !== processModel) {
        void ensureCurrentProcess().catch((error) => console.error("Agent runtime model switch failed", error));
      }
    },
    getCurrentModel() {
      return processModel;
    },
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
          apiKeyConfigured: settings.apiKeyConfigured,
          ...(settings.model !== processModel && activeRunCount > 0 ? { modelChangePending: true } : {})
        };
      }
      if (modelChangePromise) await modelChangePromise;
      const current = await ensureCurrentProcess();
      const running = await current.start();
      return {
        runtime: "opencode",
        state: "ready",
        version: running.version,
        model: processModel,
        apiKeyConfigured: settings.apiKeyConfigured,
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
            providerID: OPEN_CODE_PROVIDER_ID
          }
        },
        { throwOnError: true }
      );
      return { id: response.data.id };
    },
    async run(input) {
      const settings = requireAvailableSettings();
      const client = await getClient(input.workspacePath);
      const response = await client.session.prompt(
        {
          directory: input.workspacePath,
          sessionID: input.sessionId,
          agent: "build",
          model: {
            providerID: OPEN_CODE_PROVIDER_ID,
            modelID: processModel
          },
          parts: [{ type: "text", text: input.prompt }]
        },
        { throwOnError: true }
      );
      if (response.data.info.error) {
        throw new Error(formatProviderError(response.data.info.error, options.apiKey));
      }
      const text = response.data.parts
        .filter((part) => part.type === "text")
        .map((part) => part.text)
        .join("\n");
      if (!text.trim()) throw new Error("OpenCode returned an empty response");
      return { text, messageId: response.data.info.id };
    },
    async getDiff(input) {
      const client = await getClient(input.workspacePath);
      const response = await client.session.diff(
        {
          directory: input.workspacePath,
          sessionID: input.sessionId
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
      const client = await getClient(input.workspacePath);
      await client.session.abort(
        {
          directory: input.workspacePath,
          sessionID: input.sessionId
        },
        { throwOnError: true }
      );
    },
    async replyPermission(input) {
      const client = await getClient(input.workspacePath);
      await client.permission.reply({ directory: input.workspacePath, requestID: input.requestId, reply: input.reply, message: input.message }, { throwOnError: true });
    },
    async subscribe(input, listener, onListenerError) {
      const client = await getClient(input.workspacePath);
      const controller = new AbortController();
      const subscription = await client.event.subscribe(
        { directory: input.workspacePath },
        { signal: controller.signal }
      );
      const completion = (async () => {
        for await (const event of subscription.stream) {
          if (!eventBelongsToSession(event, input.sessionId)) continue;
          try {
            await listener({
              type: event.type,
              data: event.properties as Record<string, unknown>
            });
          } catch (error) {
            console.error("Agent runtime listener failed", error);
            try {
              await onListenerError?.(error);
            } catch (reportError) {
              console.error("Agent runtime listener error reporting failed", reportError);
            }
          }
        }
      })();
      return async () => {
        controller.abort();
        await completion.catch((error) => console.error("Agent runtime event stream failed", error));
      };
    },
    async dispose() {
      await process.dispose();
    }
  };
}

export async function ensureWorkspaceRepository(workspacePath: string) {
  const gitPath = path.join(workspacePath, ".git");
  const repositoryExists = statSync(gitPath, { throwIfNoEntry: false });
  if (repositoryExists) return false;
  await execFileAsync("git", ["init", "--quiet", workspacePath]);
  return true;
}

function formatProviderError(
  error: { name: string; data: Record<string, unknown> },
  apiKey: string | undefined
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
  return `OpenCode Provider request failed${statusCode}: ${message}`;
}

function eventBelongsToSession(event: {
  properties: unknown;
}, sessionId: string) {
  const properties = event.properties as {
    sessionID?: unknown;
    info?: { sessionID?: unknown };
    part?: { sessionID?: unknown };
  };
  return (
    properties.sessionID === sessionId ||
    properties.info?.sessionID === sessionId ||
    properties.part?.sessionID === sessionId
  );
}
