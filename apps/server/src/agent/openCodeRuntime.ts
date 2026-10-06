import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import type { AgentSettingsResponse } from "@simplercp/shared";
import { createOpencodeClient } from "@opencode-ai/sdk/v2";
import { promisify } from "node:util";
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
}

export function createOpenCodeRuntime(
  options: OpenCodeRuntimeOptions
): AgentRuntime {
  let process = createProcess();
  let processModel = options.getSettings().model;

  function createProcess() {
    const settings = options.getSettings();
    return createOpenCodeProcess({
      port: options.port,
      provider: settings.provider,
      apiKey: options.apiKey,
      baseUrl: options.baseUrl,
      model: settings.model,
      mcp: options.mcp
    });
  }

  async function ensureCurrentProcess() {
    const model = options.getSettings().model;
    const provider = options.getSettings().provider;
    if (model !== processModel || provider !== (processProvider ?? provider)) {
      await process.dispose();
      process = createProcess();
      processModel = model;
      processProvider = provider;
    }
    return process;
  }
  let processProvider = options.getSettings().provider;

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
    if (!options.apiKey) throw new Error(`${settings.provider === "minimax" ? "MINIMAX_API_KEY" : "DEEPSEEK_API_KEY"} is required`);
    return settings;
  }

  return {
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
          apiKeyConfigured: settings.apiKeyConfigured
        };
      }
      const current = await ensureCurrentProcess();
      const running = await current.start();
      return {
        runtime: "opencode",
        state: "ready",
        version: running.version,
        model: settings.model,
        provider: settings.provider,
        apiKeyConfigured: settings.apiKeyConfigured
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
            id: settings.model,
            providerID: openCodeProviderId(settings.provider)
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
            providerID: openCodeProviderId(settings.provider),
            modelID: input.model ?? settings.model
          },
          ...(input.purpose === "knowledge-recap" ? {
            tools: { bash: false, edit: false, write: false, apply_patch: false, read: false, glob: false, grep: false, list: false, webfetch: false, websearch: false, task: false, question: false, todowrite: false, knowledge_knowledge_search: false, knowledge_knowledge_get: false, knowledge_knowledge_propose: false }
          } : {}),
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
      return { text, messageId: response.data.info.id, usage: normalizeAgentUsage(response.data.info) };
    },
    async getDiff(input) {
      const client = await getClient(input.workspacePath);
      const response = await client.session.diff(
        {
          directory: input.workspacePath,
          sessionID: input.sessionId,
          messageID: input.messageId
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
    async subscribe(input, listener) {
      const client = await getClient(input.workspacePath);
      const controller = new AbortController();
      const subscription = await client.event.subscribe(
        { directory: input.workspacePath },
        { signal: controller.signal }
      );
      const completion = (async () => {
        for await (const event of subscription.stream) {
          if (!eventBelongsToSession(event, input.sessionId)) continue;
          const properties = event.properties as Record<string, unknown>;
          const usage = event.type === "message.updated" ? normalizeAgentUsage(properties.info) : undefined;
          await listener({
            type: event.type,
            data: usage ? { ...properties, usageSummary: usage } : properties
          });
        }
      })().then(
        () => ({ failed: false as const }),
        (error: unknown) => ({ failed: true as const, error })
      );
      return async () => {
        controller.abort();
        const result = await completion;
        if (result.failed && !isAbortError(result.error)) throw result.error;
      };
    },
    async dispose() {
      await process.dispose();
    }
  };
}

function isAbortError(error: unknown) {
  return Boolean(error && typeof error === "object" && "name" in error && (error as { name?: unknown }).name === "AbortError");
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
