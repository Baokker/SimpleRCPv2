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
  it("isolates both providers even when an allowlist names both keys", () => {
    const env = { MINIMAX_API_KEY: "selected", DEEPSEEK_API_KEY: "other", SIMPLERCP_AGENT_ENV_ALLOW: "MINIMAX_API_KEY,DEEPSEEK_API_KEY" };
    expect(agentEnv(env, "minimax")).toEqual({ MINIMAX_API_KEY: "selected" });
    expect(agentEnv(env, "deepseek")).toEqual({ DEEPSEEK_API_KEY: "other" });
    expect(terminalEnv(env)).toEqual({});
  });
});
