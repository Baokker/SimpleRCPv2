import path from "node:path";

export interface ServerConfig {
  port: number;
  workspaceRoot: string;
  commandWhitelist: string[];
  commandMode: CommandMode;
  agent: AgentConfig;
}

export type CommandMode = "restricted" | "unrestricted";

export interface AgentConfig {
  provider: "mock" | "openai-compatible";
  baseUrl: string;
  apiKey?: string;
  model: string;
  name: string;
  mentionAliases: string[];
  editablePaths: string[];
}

export function loadConfig(env = process.env): ServerConfig {
  const workspaceRoot = path.resolve(
    env.SIMPLERCP_WORKSPACE ?? process.cwd()
  );
  const deepseekApiKey = env.DEEPSEEK_API_KEY;
  const genericProvider = env.AGENT_PROVIDER as AgentConfig["provider"] | undefined;
  const provider = genericProvider ?? (deepseekApiKey ? "openai-compatible" : "mock");
  const baseUrl =
    env.AGENT_BASE_URL ?? env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com";
  const defaultName =
    provider === "mock" ? "MockAgent" : baseUrl.includes("deepseek") ? "DeepSeek" : "ConfiguredAgent";
  const name = env.AGENT_NAME?.trim() || defaultName;

  return {
    port: Number(env.PORT ?? 4000),
    workspaceRoot,
    commandWhitelist: (env.SIMPLERCP_COMMANDS ?? "npm test,npm run build")
      .split(",")
      .map((command) => command.trim())
      .filter(Boolean),
    commandMode:
      env.SIMPLERCP_COMMAND_MODE === "unrestricted"
        ? "unrestricted"
        : "restricted",
    agent: {
      provider,
      baseUrl,
      apiKey: env.AGENT_API_KEY ?? deepseekApiKey,
      model: env.AGENT_MODEL ?? env.DEEPSEEK_MODEL ?? "deepseek-v4-flash",
      name,
      mentionAliases: uniqueStrings([
        name,
        ...splitCsv(env.AGENT_MENTION_ALIASES)
      ]),
      editablePaths: splitCsv(env.AGENT_EDITABLE_PATHS, [
        "src/**",
        "tests/**",
        "package.json",
        "README.md"
      ])
    }
  };
}

function splitCsv(value: string | undefined, fallback: string[] = []) {
  const values = (value ? value.split(",") : fallback)
    .map((item) => item.trim())
    .filter(Boolean);
  return values.length > 0 ? values : fallback;
}

function uniqueStrings(values: string[]) {
  return [...new Set(values)];
}
