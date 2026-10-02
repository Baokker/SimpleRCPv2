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
});
