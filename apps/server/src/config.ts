import path from "node:path";
import { fileURLToPath } from "node:url";

const defaultRepositoryRoot = fileURLToPath(new URL("../../../", import.meta.url));

export interface ServerConfig {
  port: number;
  host: string;
  publicOrigin: string;
  dataDir: string;
  workspacesDir?: string;
  demoProjectRoot: string;
  terminalEnabled?: boolean;
  fakeAgentRuntime?: boolean;
  knowledge?: KnowledgeMode;
  knowledgeRecordEvents?: boolean;
  captureConfig?: import("@simplercp/knowledge").CaptureConfigInput;
  importRoots?: string[];
  agent?: {
    apiKey?: string;
    baseUrl: string;
    model: string;
    openCodePort?: number;
    runTimeoutMs?: number;
  };
}

export type KnowledgeMode = "off" | "capture" | "inject" | "full";

export function loadConfig(
  env: NodeJS.ProcessEnv = process.env,
  repositoryRoot = defaultRepositoryRoot
): ServerConfig {
  const port = Number(env.PORT ?? 4000);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("PORT must be an integer between 1 and 65535");
  }

  const configuredDataDir = env.SIMPLERCP_DATA_DIR?.trim() || undefined;
  if (configuredDataDir && !path.isAbsolute(configuredDataDir)) {
    throw new Error("SIMPLERCP_DATA_DIR must be an absolute path");
  }

  const publicOrigin = env.SIMPLERCP_PUBLIC_URL ?? "http://127.0.0.1:5173";
  const publicUrl = new URL(publicOrigin);
  if (!["http:", "https:"].includes(publicUrl.protocol)) {
    throw new Error("SIMPLERCP_PUBLIC_URL must use http or https");
  }

  const agentBaseUrl = new URL(
    env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com/v1"
  );
  if (!["http:", "https:"].includes(agentBaseUrl.protocol)) {
    throw new Error("DEEPSEEK_BASE_URL must use http or https");
  }
  const agentModel = env.DEEPSEEK_MODEL?.trim() || "deepseek-chat";
  const openCodePort = Number(env.SIMPLERCP_OPENCODE_PORT ?? 4096);
  if (!Number.isInteger(openCodePort) || openCodePort < 1 || openCodePort > 65_535) {
    throw new Error("SIMPLERCP_OPENCODE_PORT must be an integer between 1 and 65535");
  }
  const runTimeoutMs = Number(env.SIMPLERCP_AGENT_RUN_TIMEOUT_MS ?? 600_000);
  if (!Number.isInteger(runTimeoutMs) || runTimeoutMs < 1) {
    throw new Error("SIMPLERCP_AGENT_RUN_TIMEOUT_MS must be a positive integer");
  }
  const terminalEnabled = readBoolean(
    env.SIMPLERCP_TERMINAL_ENABLED,
    "SIMPLERCP_TERMINAL_ENABLED",
    true
  );
  const fakeAgentRuntime = readBoolean(
    env.SIMPLERCP_FAKE_AGENT_RUNTIME,
    "SIMPLERCP_FAKE_AGENT_RUNTIME",
    false
  );
  const knowledge = readKnowledgeMode(env.KNOWLEDGE);
  const importRoots = !env.SIMPLERCP_IMPORT_ROOTS?.trim()
    ? undefined
    : env.SIMPLERCP_IMPORT_ROOTS.split(",").map((value) => value.trim()).filter(Boolean);
  if (importRoots?.some((root) => !path.isAbsolute(root))) throw new Error("SIMPLERCP_IMPORT_ROOTS must contain absolute paths");
  const dataDir = configuredDataDir ?? path.resolve(repositoryRoot, ".simplercp-data");
  const workspacesDir = env.SIMPLERCP_WORKSPACES_DIR?.trim() || path.join(dataDir, "workspaces");
  if (!path.isAbsolute(workspacesDir)) throw new Error("SIMPLERCP_WORKSPACES_DIR must be an absolute path");

  const config: ServerConfig = {
    port,
    host: env.SIMPLERCP_HOST ?? "127.0.0.1",
    publicOrigin: publicUrl.origin,
    dataDir,
    workspacesDir,
    importRoots,
    demoProjectRoot: path.resolve(repositoryRoot, "demo/workspace"),
    terminalEnabled,
    fakeAgentRuntime,
    knowledge,
    ...(knowledge !== "off" ? { knowledgeRecordEvents: readBoolean(env.KNOWLEDGE_RECORD_EVENTS, "KNOWLEDGE_RECORD_EVENTS", true) } : {}),
    agent: {
      apiKey: env.DEEPSEEK_API_KEY?.trim() || undefined,
      baseUrl: agentBaseUrl.toString().replace(/\/$/, ""),
      model: agentModel,
      openCodePort,
      runTimeoutMs
    }
  };
  return config;
}

function readKnowledgeMode(value: string | undefined): KnowledgeMode {
  const mode = value?.trim() || "off";
  if (mode === "off" || mode === "capture" || mode === "inject" || mode === "full") return mode;
  throw new Error("KNOWLEDGE must be one of off, capture, inject, full");
}

function readBoolean(
  value: string | undefined,
  name: string,
  defaultValue: boolean
) {
  if (value === undefined) return defaultValue;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error(`${name} must be true or false`);
}
