const baseNames = new Set([
  "PATH", "HOME", "USER", "LOGNAME", "SHELL", "LANG", "TERM", "COLORTERM", "TMPDIR", "TZ"
]);
const identityNames = /TOKEN|SECRET|PASSWORD|COOKIE/i;
const sensitiveNames = /KEY|TOKEN|SECRET|PASSWORD|COOKIE/i;

function buildEnvironment(env: NodeJS.ProcessEnv, additional: string[], credential?: string) {
  const allowed = new Set([...baseNames, ...additional]);
  const entries = Object.entries(env).filter(([name, value]) => {
    if (typeof value !== "string" || identityNames.test(name)) return false;
    if (sensitiveNames.test(name) && name !== credential) return false;
    return allowed.has(name) || name.startsWith("LC_");
  });
  const result = Object.fromEntries(entries) as Record<string, string>;
  if (env.SIMPLERCP_TERMINAL_HOME) result.HOME = env.SIMPLERCP_TERMINAL_HOME;
  return result;
}

export function terminalEnv(env: NodeJS.ProcessEnv = process.env) {
  return buildEnvironment(env, (env.SIMPLERCP_TERMINAL_ENV_ALLOW ?? "").split(",").map((name) => name.trim()));
}

export function agentEnv(env: NodeJS.ProcessEnv = process.env, provider: "minimax" | "deepseek" = "deepseek") {
  const prefix = provider === "minimax" ? "MINIMAX" : "DEEPSEEK";
  return buildEnvironment(env, [`${prefix}_API_KEY`, `${prefix}_BASE_URL`, `${prefix}_MODEL`, ...(env.SIMPLERCP_AGENT_ENV_ALLOW ?? "").split(",").map((name) => name.trim())], `${prefix}_API_KEY`);
}
