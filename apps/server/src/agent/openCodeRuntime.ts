import type { AgentSettingsResponse } from "@simplercp/shared";
import { createOpencodeClient } from "@opencode-ai/sdk/v2";
import type { AgentRuntime } from "./agentRuntime.js";
import {
  createOpenCodeProcess,
  OPEN_CODE_PROVIDER_ID
} from "./openCodeProcess.js";

interface OpenCodeRuntimeOptions {
  port: number;
  apiKey?: string;
  baseUrl: string;
  getSettings(): AgentSettingsResponse;
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
      apiKey: options.apiKey,
      baseUrl: options.baseUrl,
      model: settings.model
    });
  }

  async function ensureCurrentProcess() {
    const model = options.getSettings().model;
    if (model !== processModel) {
      await process.dispose();
      process = createProcess();
      processModel = model;
    }
    return process;
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
    async status() {
      const settings = options.getSettings();
      if (!settings.enabled) {
        return {
          runtime: "opencode",
          state: "disabled",
          model: settings.model,
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
            modelID: settings.model
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
          await listener({
            type: event.type,
            data: event.properties as Record<string, unknown>
          });
        }
      })();
      return async () => {
        controller.abort();
        await completion.catch((error) => {
          if (!controller.signal.aborted) throw error;
        });
      };
    },
    async dispose() {
      await process.dispose();
    }
  };
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
