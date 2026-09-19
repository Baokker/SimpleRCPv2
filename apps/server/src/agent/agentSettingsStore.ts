import fs from "node:fs/promises";
import path from "node:path";
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
  apiKeyConfigured: boolean;
}

export async function createAgentSettingsStore(
  options: AgentSettingsStoreOptions
) {
  let settings = await loadSettings(options.storagePath, options.defaultModel);
  let operations = Promise.resolve();

  return {
    get(): AgentSettingsResponse {
      return {
        ...settings,
        apiKeyConfigured: options.apiKeyConfigured
      };
    },
    async update(input: unknown): Promise<AgentSettingsResponse> {
      const nextSettings = validateSettings(input);
      operations = operations.then(async () => {
        await saveSettings(options.storagePath, nextSettings);
        settings = nextSettings;
      });
      await operations;
      return this.get();
    }
  };
}

async function loadSettings(
  storagePath: string,
  defaultModel: string
): Promise<AgentSettings> {
  try {
    const parsed = JSON.parse(
      await fs.readFile(storagePath, "utf8")
    ) as AgentSettingsFile;
    validateSettingsFile(parsed);
    return parsed.settings;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return {
        provider: "deepseek",
        model: defaultModel,
        enabled: true
      };
    }
    throw error;
  }
}

function validateSettingsFile(value: AgentSettingsFile) {
  if (
    value.version !== 1 ||
    value.settings?.provider !== "deepseek" ||
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
  if (input.provider !== "deepseek") {
    throw new Error("provider must be deepseek");
  }
  if (typeof input.model !== "string" || !input.model.trim()) {
    throw new Error("model is required");
  }
  if (typeof input.enabled !== "boolean") {
    throw new Error("enabled must be a boolean");
  }
  return {
    provider: "deepseek",
    model: input.model.trim(),
    enabled: input.enabled
  };
}

async function saveSettings(storagePath: string, settings: AgentSettings) {
  await fs.mkdir(path.dirname(storagePath), { recursive: true });
  const nextPath = `${storagePath}.next`;
  await fs.writeFile(
    nextPath,
    `${JSON.stringify({ version: 1, settings } satisfies AgentSettingsFile, null, 2)}\n`,
    "utf8"
  );
  await fs.rename(nextPath, storagePath);
}
