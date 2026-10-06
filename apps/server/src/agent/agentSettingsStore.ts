import { readJsonFile, writeJsonFileAtomically } from "../jsonFile.js";
import type {
  AgentSettings,
  AgentSettingsResponse
} from "@simplercp/shared";

interface AgentSettingsFile {
  version: 1;
  settings: AgentSettings;
}

interface AgentSettingsStoreOptions {
  storagePath: string;
  defaultModel: string;
  defaultProvider?: "deepseek" | "minimax";
  apiKeyConfigured: boolean;
}

export async function createAgentSettingsStore(
  options: AgentSettingsStoreOptions
) {
  let settings = await loadSettings(options.storagePath, options.defaultModel, options.defaultProvider);
  let operations = Promise.resolve();

  function get(): AgentSettingsResponse {
    return { ...settings, apiKeyConfigured: options.apiKeyConfigured };
  }

  return {
    get,
    async update(input: unknown): Promise<AgentSettingsResponse> {
      const nextSettings = validateSettings(input);
      if (options.defaultProvider && nextSettings.provider !== options.defaultProvider) throw new Error("Agent provider must match AGENT_LLM_PROVIDER; restart the server to change it");
      operations = operations.then(async () => {
        await saveSettings(options.storagePath, nextSettings);
        settings = nextSettings;
      });
      await operations;
      return get();
    }
  };
}

async function loadSettings(
  storagePath: string,
  defaultModel: string,
  defaultProvider: "deepseek" | "minimax" = "deepseek"
): Promise<AgentSettings> {
  const parsed = await readJsonFile<AgentSettingsFile>(storagePath);
  if (parsed === undefined) {
    return { provider: defaultProvider, model: defaultModel, enabled: true };
  }
  validateSettingsFile(parsed);
  if (parsed.settings.provider !== defaultProvider) return { provider: defaultProvider, model: defaultModel, enabled: parsed.settings.enabled };
  return parsed.settings;
}

function validateSettingsFile(value: AgentSettingsFile) {
  if (
    !value ||
    value.version !== 1 ||
    (value.settings?.provider !== "deepseek" && value.settings?.provider !== "minimax") ||
    typeof value.settings.model !== "string" ||
    !value.settings.model.trim() ||
    typeof value.settings.enabled !== "boolean"
  ) {
    throw new Error("Invalid Agent settings file");
  }
}

function validateSettings(value: unknown): AgentSettings {
  if (!value || typeof value !== "object") {
    throw new Error("Agent settings are required");
  }
  const input = value as Record<string, unknown>;
  if ("apiKey" in input) {
    throw new Error("API Key must be configured through the server environment");
  }
  if (input.provider !== "deepseek" && input.provider !== "minimax") {
    throw new Error("provider must be deepseek or minimax");
  }
  if (typeof input.model !== "string" || !input.model.trim()) {
    throw new Error("model is required");
  }
  if (typeof input.enabled !== "boolean") {
    throw new Error("enabled must be a boolean");
  }
  return {
    provider: input.provider,
    model: input.model.trim(),
    enabled: input.enabled
  };
}

async function saveSettings(storagePath: string, settings: AgentSettings) {
  await writeJsonFileAtomically(storagePath, { version: 1, settings } satisfies AgentSettingsFile);
}

export type AgentSettingsStore = Awaited<
  ReturnType<typeof createAgentSettingsStore>
>;
