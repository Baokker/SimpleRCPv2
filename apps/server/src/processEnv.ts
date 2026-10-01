const baseNames = new Set([
  "PATH", "HOME", "USER", "LOGNAME", "SHELL", "LANG", "TERM", "COLORTERM", "TMPDIR", "TZ"
]);
const identityNames = /TOKEN|SECRET|PASSWORD|ADMIN|COOKIE/i;
const sensitiveNames = /KEY|TOKEN|SECRET|PASSWORD|ADMIN|COOKIE/i;

function buildEnvironment(env: NodeJS.ProcessEnv, additional: string[], agent: boolean) {
  const allowed = new Set([...baseNames, ...additional]);
  const entries = Object.entries(env).filter(([name, value]) => {
    if (typeof value !== "string" || identityNames.test(name)) return false;
    if (sensitiveNames.test(name) && !(agent && name === "DEEPSEEK_API_KEY")) return false;
    return allowed.has(name) || name.startsWith("LC_");
  });
  const result = Object.fromEntries(entries) as Record<string, string>;
  if (env.SIMPLERCP_TERMINAL_HOME) result.HOME = env.SIMPLERCP_TERMINAL_HOME;
  return result;
}

export function terminalEnv(env: NodeJS.ProcessEnv = process.env) {
  return buildEnvironment(env, (env.SIMPLERCP_TERMINAL_ENV_ALLOW ?? "").split(",").map((name) => name.trim()), false);
}

export function agentEnv(env: NodeJS.ProcessEnv = process.env) {
  return buildEnvironment(env, ["DEEPSEEK_API_KEY", "DEEPSEEK_BASE_URL", "DEEPSEEK_MODEL", ...(env.SIMPLERCP_AGENT_ENV_ALLOW ?? "").split(",").map((name) => name.trim())], true);
}
