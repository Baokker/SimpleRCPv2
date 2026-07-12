import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../config.js";

describe("server config", () => {
  it("loads workspace, port, and command whitelist from environment", () => {
    const config = loadConfig({
      PORT: "4500",
      SIMPLERCP_WORKSPACE: "tests/fixtures/sample-workspace",
      SIMPLERCP_COMMANDS: "npm test,pnpm test"
    });

    expect(config).toEqual({
      port: 4500,
      workspaceRoot: path.resolve("tests/fixtures/sample-workspace"),
      commandWhitelist: ["npm test", "pnpm test"],
      commandMode: "restricted",
      agent: {
        provider: "mock",
        baseUrl: "https://api.deepseek.com",
        apiKey: undefined,
        model: "deepseek-v4-flash",
        name: "MockAgent",
        mentionAliases: ["MockAgent"],
        editablePaths: ["src/**", "tests/**", "package.json", "README.md"]
      }
    });
  });

  it("loads an OpenAI-compatible agent from generic environment variables", () => {
    const config = loadConfig({
      SIMPLERCP_WORKSPACE: ".",
      AGENT_PROVIDER: "openai-compatible",
      AGENT_BASE_URL: "https://api.deepseek.com",
      AGENT_API_KEY: "test-key",
      AGENT_MODEL: "deepseek-v4-pro"
    });

    expect(config.agent).toEqual({
      provider: "openai-compatible",
      baseUrl: "https://api.deepseek.com",
      apiKey: "test-key",
      model: "deepseek-v4-pro",
      name: "DeepSeek",
      mentionAliases: ["DeepSeek"],
      editablePaths: ["src/**", "tests/**", "package.json", "README.md"]
    });
  });

  it("loads DeepSeek aliases for OpenAI-compatible agent config", () => {
    const config = loadConfig({
      SIMPLERCP_WORKSPACE: ".",
      DEEPSEEK_API_KEY: "deepseek-test-key",
      DEEPSEEK_MODEL: "deepseek-v4-flash"
    });

    expect(config.agent).toEqual({
      provider: "openai-compatible",
      baseUrl: "https://api.deepseek.com",
      apiKey: "deepseek-test-key",
      model: "deepseek-v4-flash",
      name: "DeepSeek",
      mentionAliases: ["DeepSeek"],
      editablePaths: ["src/**", "tests/**", "package.json", "README.md"]
    });
  });

  it("loads configured agent mention aliases and editable paths", () => {
    const config = loadConfig({
      SIMPLERCP_WORKSPACE: ".",
      AGENT_PROVIDER: "openai-compatible",
      AGENT_BASE_URL: "https://open.bigmodel.cn/api/paas/v4",
      AGENT_API_KEY: "test-key",
      AGENT_MODEL: "glm-4.5",
      AGENT_NAME: "GLM",
      AGENT_MENTION_ALIASES: "GLM,Zhipu",
      AGENT_EDITABLE_PATHS: "src/**,docs/**"
    });

    expect(config.agent).toMatchObject({
      provider: "openai-compatible",
      name: "GLM",
      mentionAliases: ["GLM", "Zhipu"],
      editablePaths: ["src/**", "docs/**"]
    });
  });

  it("loads restricted command mode by default", () => {
    const config = loadConfig({ SIMPLERCP_WORKSPACE: "." });

    expect(config.commandMode).toBe("restricted");
  });

  it("loads unrestricted command mode when explicitly configured", () => {
    const config = loadConfig({
      SIMPLERCP_WORKSPACE: ".",
      SIMPLERCP_COMMAND_MODE: "unrestricted"
    });

    expect(config.commandMode).toBe("unrestricted");
  });
});
