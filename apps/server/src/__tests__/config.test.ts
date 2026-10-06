import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../config.js";

describe("server config", () => {
  it("uses stable local defaults when no environment variables are set", () => {
    expect(loadConfig({ MINIMAX_API_KEY: "configured-key" }, "/srv/simplercp")).toEqual({
      port: 4000,
      host: "127.0.0.1",
      publicOrigin: "http://127.0.0.1:5173",
      dataDir: "/srv/simplercp/.simplercp-data",
      workspacesDir: "/srv/simplercp/.simplercp-data/workspaces",
      importRoots: undefined,
      demoProjectRoot: "/srv/simplercp/demo/workspace",
      terminalEnabled: true,
      fakeAgentRuntime: false,
      knowledge: "off",
      agent: {
        provider: "minimax",
        apiKey: "configured-key",
        baseUrl: "https://api.minimaxi.com/v1",
        model: "MiniMax-M2",
        openCodePort: 4096,
        runTimeoutMs: 600_000
      }
    });
  });

  it("loads deployment settings from environment", () => {
    expect(
      loadConfig({
        PORT: "4500",
        SIMPLERCP_HOST: "0.0.0.0",
        SIMPLERCP_PUBLIC_URL: "https://code.example.com",
        SIMPLERCP_DATA_DIR: "/srv/simplercp-data",
        SIMPLERCP_TERMINAL_ENABLED: "false",
        AGENT_LLM_PROVIDER: "deepseek",
        DEEPSEEK_API_KEY: "configured-key",
        DEEPSEEK_BASE_URL: "https://models.example.com/v1",
        DEEPSEEK_MODEL: "DeepSeek-V4-Flash"
      }, "/srv/simplercp")
    ).toEqual({
      port: 4500,
      host: "0.0.0.0",
      publicOrigin: "https://code.example.com",
      dataDir: "/srv/simplercp-data",
      workspacesDir: "/srv/simplercp-data/workspaces",
      importRoots: undefined,
      demoProjectRoot: path.resolve("/srv/simplercp/demo/workspace"),
      terminalEnabled: false,
      fakeAgentRuntime: false,
      knowledge: "off",
      agent: {
        provider: "deepseek",
        apiKey: "configured-key",
        baseUrl: "https://models.example.com/v1",
        model: "DeepSeek-V4-Flash",
        openCodePort: 4096,
        runTimeoutMs: 600_000
      }
    });
  });

  it("rejects a relative data directory", () => {
    expect(() =>
      loadConfig({ SIMPLERCP_DATA_DIR: "runtime-data" }, "/srv/simplercp")
    ).toThrow("SIMPLERCP_DATA_DIR must be an absolute path");
  });

  it("rejects an invalid terminal setting", () => {
    expect(() =>
      loadConfig({ MINIMAX_API_KEY: "configured", SIMPLERCP_TERMINAL_ENABLED: "disabled" }, "/srv/simplercp")
    ).toThrow("SIMPLERCP_TERMINAL_ENABLED must be true or false");
  });

  it("does not read knowledge model settings when knowledge is off", () => {
    expect(() => loadConfig({ AGENT_LLM_PROVIDER: "deepseek", DEEPSEEK_API_KEY: "configured", KNOWLEDGE: "off", KNOWLEDGE_LLM_PROVIDER: "invalid", MINIMAX_BASE_URL: "not-a-url" })).not.toThrow();
  });

  it("uses defaults for blank optional paths and validates workspace and import paths", () => {
    const config = loadConfig({ SIMPLERCP_FAKE_AGENT_RUNTIME: "true", SIMPLERCP_DATA_DIR: "", SIMPLERCP_WORKSPACES_DIR: "", SIMPLERCP_IMPORT_ROOTS: "" }, "/srv/simplercp");
    expect(config.dataDir).toBe("/srv/simplercp/.simplercp-data");
    expect(config.workspacesDir).toBe("/srv/simplercp/.simplercp-data/workspaces");
    expect(config.importRoots).toBeUndefined();
    expect(() => loadConfig({ SIMPLERCP_FAKE_AGENT_RUNTIME: "true", SIMPLERCP_WORKSPACES_DIR: "relative" })).toThrow("absolute path");
    expect(() => loadConfig({ SIMPLERCP_FAKE_AGENT_RUNTIME: "true", SIMPLERCP_IMPORT_ROOTS: "relative" })).toThrow("absolute paths");
    expect(loadConfig({ SIMPLERCP_FAKE_AGENT_RUNTIME: "true", SIMPLERCP_IMPORT_ROOTS: "/srv/imports,/srv/examples" }).importRoots).toEqual(["/srv/imports", "/srv/examples"]);
  });

  it("parses the knowledge feature mode and rejects invalid values", () => {
    expect(loadConfig({ SIMPLERCP_FAKE_AGENT_RUNTIME: "true", KNOWLEDGE: "capture" }).knowledge).toBe("capture");
    expect(loadConfig({ SIMPLERCP_FAKE_AGENT_RUNTIME: "true", KNOWLEDGE: "inject" }).knowledge).toBe("inject");
    expect(loadConfig({ SIMPLERCP_FAKE_AGENT_RUNTIME: "true", KNOWLEDGE: "full" }).knowledge).toBe("full");
    expect(() => loadConfig({ SIMPLERCP_FAKE_AGENT_RUNTIME: "true", KNOWLEDGE: "invalid" })).toThrow("KNOWLEDGE must be one of off, capture, inject, full");
  });

  it("selects MiniMax for knowledge calls when its key is configured", () => {
    expect(loadConfig({ KNOWLEDGE: "full", MINIMAX_API_KEY: "configured", MINIMAX_BASE_URL: "https://api.minimaxi.com/v1", MINIMAX_MODEL: "MiniMax-M2" }).knowledgeLlm).toEqual({
      provider: "minimax", apiKey: "configured", baseUrl: "https://api.minimaxi.com/v1", model: "MiniMax-M2"
    });
    expect(loadConfig({ AGENT_LLM_PROVIDER: "deepseek", KNOWLEDGE: "full", DEEPSEEK_API_KEY: "configured" }).knowledgeLlm).toMatchObject({ provider: "deepseek", apiKey: "configured" });
    expect(() => loadConfig({ SIMPLERCP_FAKE_AGENT_RUNTIME: "true", KNOWLEDGE: "full", KNOWLEDGE_LLM_PROVIDER: "invalid" })).toThrow("KNOWLEDGE_LLM_PROVIDER must be minimax or deepseek");
  });

  it("requires the selected provider key and accepts a separate Agent model", () => {
    expect(() => loadConfig({ DEEPSEEK_API_KEY: "configured" })).toThrow("MINIMAX_API_KEY is required");
    expect(() => loadConfig({ AGENT_LLM_PROVIDER: "deepseek", MINIMAX_API_KEY: "configured" })).toThrow("DEEPSEEK_API_KEY is required");
    expect(loadConfig({ MINIMAX_API_KEY: "configured", AGENT_MINIMAX_MODEL: "MiniMax-M2.1" }).agent?.model).toBe("MiniMax-M2.1");
  });
});
