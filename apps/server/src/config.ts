import path from "node:path";
import type { GuardLlmMode } from "@simplercp/shared";
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
  guardMode?: "full" | "human-only" | "native" | "off";
  guardLlmMode?: GuardLlmMode;
  guardApprovalTimeoutMs?: number;
  guardLlmTimeoutMs?: number;
  fakeAgentRuntime?: boolean;
  sensitiveValues?: string[];
  importRoots?: string[];
  agent?: {
    provider?: "deepseek" | "minimax";
    apiKey?: string;
    baseUrl: string;
    model: string;
    openCodePort?: number;
    runTimeoutMs?: number;
    maxConcurrentRuns?: number;
    activityConfig?: { waitingMs: number; stalledMs: number };
  };
}

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

  const llmProvider = env.SIMPLERCP_LLM_PROVIDER?.trim().toLowerCase() || "deepseek";
  if (llmProvider !== "deepseek" && llmProvider !== "minimax") {
    throw new Error("SIMPLERCP_LLM_PROVIDER must be deepseek or minimax");
  }
  const providerPrefix = llmProvider === "minimax" ? "MINIMAX" : "DEEPSEEK";
  const agentBaseUrl = new URL(
    env[`${providerPrefix}_BASE_URL`]?.trim() || (llmProvider === "minimax" ? "https://api.minimaxi.com/v1" : "https://api.deepseek.com/v1")
  );
  if (!["http:", "https:"].includes(agentBaseUrl.protocol)) {
    throw new Error(`${providerPrefix}_BASE_URL must use http or https`);
  }
  const agentModel = env[`${providerPrefix}_MODEL`]?.trim() || (llmProvider === "minimax" ? "MiniMax-M3" : "deepseek-flash");
  const openCodePort = Number(env.SIMPLERCP_OPENCODE_PORT ?? 4096);
  if (!Number.isInteger(openCodePort) || openCodePort < 1 || openCodePort > 65_535) {
    throw new Error("SIMPLERCP_OPENCODE_PORT must be an integer between 1 and 65535");
  }
  const runTimeoutMs = Number(env.SIMPLERCP_AGENT_RUN_TIMEOUT_MS ?? 600_000);
  if (!Number.isInteger(runTimeoutMs) || runTimeoutMs < 1) {
    throw new Error("SIMPLERCP_AGENT_RUN_TIMEOUT_MS must be a positive integer");
  }
  const maxConcurrentRuns = Number(env.SIMPLERCP_AGENT_MAX_CONCURRENT_RUNS ?? 3);
  if (!Number.isInteger(maxConcurrentRuns) || maxConcurrentRuns < 1) {
    throw new Error("SIMPLERCP_AGENT_MAX_CONCURRENT_RUNS must be a positive integer");
  }
  const terminalEnabled = readBoolean(
    env.SIMPLERCP_TERMINAL_ENABLED,
    "SIMPLERCP_TERMINAL_ENABLED",
    true
  );
  const guardMode = env.SIMPLERCP_GUARD_MODE ?? "full";
  if (!["full", "human-only", "native", "off"].includes(guardMode)) {
    throw new Error("SIMPLERCP_GUARD_MODE must be full, human-only, native, or off");
  }
  const guardLlmMode = env.SIMPLERCP_GUARD_LLM_MODE?.trim() || undefined;
  if (guardLlmMode !== undefined && !["off", "suggest", "auto"].includes(guardLlmMode)) {
    throw new Error("SIMPLERCP_GUARD_LLM_MODE must be off, suggest, or auto");
  }
  const guardApprovalTimeoutMs = Number(env.SIMPLERCP_GUARD_APPROVAL_TIMEOUT_MS ?? 120_000);
  if (!Number.isInteger(guardApprovalTimeoutMs) || guardApprovalTimeoutMs < 1) {
    throw new Error("SIMPLERCP_GUARD_APPROVAL_TIMEOUT_MS must be a positive integer");
  }
  const guardLlmTimeoutMs = Number(env.SIMPLERCP_GUARD_LLM_TIMEOUT_MS ?? 15_000);
  if (!Number.isInteger(guardLlmTimeoutMs) || guardLlmTimeoutMs < 1) {
    throw new Error("SIMPLERCP_GUARD_LLM_TIMEOUT_MS must be a positive integer");
  }
  const fakeAgentRuntime = readBoolean(
    env.SIMPLERCP_FAKE_AGENT_RUNTIME,
    "SIMPLERCP_FAKE_AGENT_RUNTIME",
    false
  );
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
    ...(guardLlmMode ? { guardLlmMode: guardLlmMode as GuardLlmMode } : {}),
    fakeAgentRuntime,
    sensitiveValues: Object.entries(env).filter(([name, value]) => /(?:KEY|TOKEN|SECRET)(?:_|$)/i.test(name) && value).map(([, value]) => value!),
    agent: {
      provider: llmProvider,
      apiKey: env[`${providerPrefix}_API_KEY`]?.trim() || undefined,
      baseUrl: agentBaseUrl.toString().replace(/\/$/, ""),
      model: agentModel,
      openCodePort,
      runTimeoutMs,
      maxConcurrentRuns,
      activityConfig: {
        waitingMs: positiveInteger(env.SIMPLERCP_AGENT_WAITING_MS, "SIMPLERCP_AGENT_WAITING_MS", 20_000),
        stalledMs: positiveInteger(env.SIMPLERCP_AGENT_STALLED_MS, "SIMPLERCP_AGENT_STALLED_MS", 60_000)
      }
    }
  };
  Object.defineProperties(config, {
    guardMode: { value: guardMode, enumerable: env.SIMPLERCP_GUARD_MODE !== undefined },
    guardApprovalTimeoutMs: { value: guardApprovalTimeoutMs, enumerable: env.SIMPLERCP_GUARD_APPROVAL_TIMEOUT_MS !== undefined },
    guardLlmTimeoutMs: { value: guardLlmTimeoutMs, enumerable: env.SIMPLERCP_GUARD_LLM_TIMEOUT_MS !== undefined }
  });
  if (config.agent!.activityConfig!.stalledMs <= config.agent!.activityConfig!.waitingMs) throw new Error("SIMPLERCP_AGENT_STALLED_MS 必须大于 SIMPLERCP_AGENT_WAITING_MS");
  return config;
}

function positiveInteger(value: string | undefined, name: string, fallback: number) {
  const number = Number(value ?? fallback);
  if (!Number.isInteger(number) || number < 1) throw new Error(`${name} 必须为正整数`);
  return number;
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
