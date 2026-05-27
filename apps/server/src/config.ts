import path from "node:path";

export interface ServerConfig {
  port: number;
  workspaceRoot: string;
  commandWhitelist: string[];
  agent: AgentConfig;
}

export interface AgentConfig {
  provider: "mock" | "openai-compatible";
  baseUrl: string;
  apiKey?: string;
  model: string;
}

export function loadConfig(env = process.env): ServerConfig {
  const workspaceRoot = path.resolve(
    env.SIMPLERCP_WORKSPACE ?? process.cwd()
  );
  const deepseekApiKey = env.DEEPSEEK_API_KEY;
  const genericProvider = env.AGENT_PROVIDER as AgentConfig["provider"] | undefined;
  const provider = genericProvider ?? (deepseekApiKey ? "openai-compatible" : "mock");

  return {
    port: Number(env.PORT ?? 4000),
    workspaceRoot,
    commandWhitelist: (env.SIMPLERCP_COMMANDS ?? "npm test,npm run build")
      .split(",")
      .map((command) => command.trim())
      .filter(Boolean),
    agent: {
      provider,
      baseUrl:
        env.AGENT_BASE_URL ?? env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com",
      apiKey: env.AGENT_API_KEY ?? deepseekApiKey,
      model: env.AGENT_MODEL ?? env.DEEPSEEK_MODEL ?? "deepseek-v4-flash"
    }
  };
}
