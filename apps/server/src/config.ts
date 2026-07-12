import path from "node:path";

export interface ServerConfig {
  port: number;
  workspaceRoot: string;
  commandWhitelist: string[];
  commandMode: CommandMode;
}

export type CommandMode = "restricted" | "unrestricted";

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
      .filter(Boolean),
    commandMode:
      env.SIMPLERCP_COMMAND_MODE === "unrestricted"
        ? "unrestricted"
        : "restricted"
  };
}
