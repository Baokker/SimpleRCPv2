import { describe, expect, it } from "vitest";
import { agentEnv, terminalEnv } from "../processEnv.js";

describe("child process environments", () => {
  it("keeps model configuration only in the Agent environment", () => {
    const env = {
      PATH: "/bin",
      HOME: "/home/test",
      DEEPSEEK_API_KEY: "test-key",
      DEEPSEEK_BASE_URL: "https://example.test/v1",
      SESSION_TOKEN: "session-token",
      SESSION_COOKIE: "cookie"
    };
    expect(terminalEnv(env)).toEqual({ PATH: "/bin", HOME: "/home/test" });
    expect(agentEnv(env)).toMatchObject({ PATH: "/bin", HOME: "/home/test", DEEPSEEK_API_KEY: "test-key", DEEPSEEK_BASE_URL: "https://example.test/v1" });
    expect(agentEnv(env)).not.toHaveProperty("SESSION_TOKEN");
  });
  it("MiniMax 进程只收到所选 provider 的凭据", () => {
    const env = { PATH: "/bin", MINIMAX_API_KEY: "minimax-credential", DEEPSEEK_API_KEY: "deepseek-credential", TYPESAFE_API_KEY: "jev-credential", SIMPLERCP_AGENT_ENV_ALLOW: "DEEPSEEK_API_KEY,TYPESAFE_API_KEY" };
    expect(agentEnv(env, "minimax")).toEqual({ PATH: "/bin", MINIMAX_API_KEY: "minimax-credential" });
    expect(terminalEnv(env)).toEqual({ PATH: "/bin" });
  });
});
