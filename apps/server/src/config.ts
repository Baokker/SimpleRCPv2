import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ProjectConflictGuardConfig } from "./conflictGuard/projectConflictGuard.js";
import { defaultAdjudicationConfig, validateAdjudicationConfig, defaultRoutingConfig, validateBodyUnrelatedMaxAdjacentLines } from "@simplercp/conflict-guard";

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
  sensitiveValues?: string[];
  conflictGuard?: ProjectConflictGuardConfig;
  importRoots?: string[];
  agent?: {
    apiKey?: string;
    baseUrl: string;
    model: string;
    openCodePort?: number;
    runTimeoutMs?: number;
    maxConcurrentRuns?: number;
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

  const agentBaseUrl = new URL(
    env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com/v1"
  );
  if (!["http:", "https:"].includes(agentBaseUrl.protocol)) {
    throw new Error("DEEPSEEK_BASE_URL must use http or https");
  }
  const agentModel = env.DEEPSEEK_MODEL?.trim() || "deepseek-flash";
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
  const fakeAgentRuntime = readBoolean(
    env.SIMPLERCP_FAKE_AGENT_RUNTIME,
    "SIMPLERCP_FAKE_AGENT_RUNTIME",
    false
  );
  const conflictGuardMode = env.CONFLICT_GUARD ?? "off";
  if (!(["off", "observe", "rules", "full"] as const).includes(conflictGuardMode as never)) {
    throw new Error("CONFLICT_GUARD must be off, observe, rules, or full");
  }
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
    sensitiveValues: Object.entries(env).filter(([name, value]) => /(?:KEY|TOKEN|SECRET)(?:_|$)/i.test(name) && value).map(([, value]) => value!),
    conflictGuard: {
      mode: conflictGuardMode as ProjectConflictGuardConfig["mode"],
      idleMs: 1_500,
      cursorLeaveLines: 3,
      maxBatchDurationMs: 5_000,
      activeIdleMs: 600_000,
      cursorDebounceMs: 200,
      bodyUnrelatedMaxAdjacentLines: validateBodyUnrelatedMaxAdjacentLines(Number(env.CONFLICT_GUARD_BODY_ADJACENT_LINES ?? defaultRoutingConfig.bodyUnrelatedMaxAdjacentLines)),
      arbitration: (() => { const mode = env.CONFLICT_GUARD_ARBITRATION ?? "owner"; if (!["owner", "all-human", "all-auto"].includes(mode)) throw new Error("CONFLICT_GUARD_ARBITRATION must be owner, all-human, or all-auto"); return mode as "owner" | "all-human" | "all-auto"; })(),
      intentInjection: (() => { const value = env.CONFLICT_GUARD_INTENT_INJECTION ?? "on"; if (!["on", "off"].includes(value)) throw new Error("CONFLICT_GUARD_INTENT_INJECTION must be on or off"); return value === "on"; })(),
      ...(conflictGuardMode === "full" ? { adjudication: {
        settings: validateAdjudicationConfig({ ...defaultAdjudicationConfig, strategy: (env.CONFLICT_GUARD_STRATEGY ?? "G3") as typeof defaultAdjudicationConfig.strategy, threshold: Number(env.CONFLICT_GUARD_THRESHOLD ?? defaultAdjudicationConfig.threshold), invariants: readBoolean(env.CONFLICT_GUARD_INVARIANTS, "CONFLICT_GUARD_INVARIANTS", true), deep: env.CONFLICT_GUARD_DEEP ?? "deepseek", t2Strategy: (env.CONFLICT_GUARD_T2_STRATEGY ?? "G1") as "G1" | "G2" | "G3", t3Strategy: (env.CONFLICT_GUARD_T3_STRATEGY ?? "G1") as "G1" | "G2" | "G3", t2Reasoning: readBoolean(env.CONFLICT_GUARD_T2_REASONING, "CONFLICT_GUARD_T2_REASONING", false), t3Reasoning: readBoolean(env.CONFLICT_GUARD_T3_REASONING, "CONFLICT_GUARD_T3_REASONING", false) }),
        mode: (env.CONFLICT_GUARD_PROVIDER_MODE ?? "live") as "live" | "record" | "replay",
        cacheDirectory: path.resolve(repositoryRoot, "packages/conflict-guard/bench/model-cache"),
        jev: { apiKey: env.TYPESAFE_API_KEY, baseUrl: env.TYPESAFE_BASE_URL },
        deepseek: { apiKey: env.DEEPSEEK_API_KEY, baseUrl: agentBaseUrl.toString().replace(/\/$/, ""), model: agentModel },
        ...(env.ADJUDICATION_COMPATIBLE_BASE_URL && env.ADJUDICATION_COMPATIBLE_MODEL ? { compatible: { apiKey: env.ADJUDICATION_COMPATIBLE_API_KEY, baseUrl: env.ADJUDICATION_COMPATIBLE_BASE_URL, model: env.ADJUDICATION_COMPATIBLE_MODEL } } : {})
      } } : {})
    },
    agent: {
      apiKey: env.DEEPSEEK_API_KEY?.trim() || undefined,
      baseUrl: agentBaseUrl.toString().replace(/\/$/, ""),
      model: agentModel,
      openCodePort,
      runTimeoutMs,
      maxConcurrentRuns
    }
  };
  return config;
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
