import path from "node:path";

export interface ServerConfig {
  port: number;
  workspaceRoot: string;
  commandWhitelist: string[];
}

export function loadConfig(env = process.env): ServerConfig {
  const workspaceRoot = path.resolve(
    env.SIMPLERCP_WORKSPACE ?? process.cwd()
  );

  return {
    port: Number(env.PORT ?? 4000),
    workspaceRoot,
    commandWhitelist: (env.SIMPLERCP_COMMANDS ?? "npm test,npm run build")
      .split(",")
      .map((command) => command.trim())
      .filter(Boolean)
  };
}
