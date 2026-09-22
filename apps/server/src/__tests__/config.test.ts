import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../config.js";

describe("server config", () => {
  it("uses stable local defaults when no environment variables are set", () => {
    expect(loadConfig({}, "/srv/simplercp")).toEqual({
      port: 4000,
      host: "127.0.0.1",
      publicOrigin: "http://127.0.0.1:5173",
      dataDir: "/srv/simplercp/.simplercp-data",
      demoProjectRoot: "/srv/simplercp/demo/workspace",
      terminalEnabled: true,
      agent: {
        apiKey: undefined,
        baseUrl: "https://api.deepseek.com/v1",
        model: "deepseek-chat",
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
        DEEPSEEK_API_KEY: "configured-key",
        DEEPSEEK_BASE_URL: "https://models.example.com/v1",
        DEEPSEEK_MODEL: "DeepSeek-V4-Flash"
      }, "/srv/simplercp")
    ).toEqual({
      port: 4500,
      host: "0.0.0.0",
      publicOrigin: "https://code.example.com",
      dataDir: "/srv/simplercp-data",
      demoProjectRoot: path.resolve("/srv/simplercp/demo/workspace"),
      terminalEnabled: false,
      agent: {
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
      loadConfig({ SIMPLERCP_TERMINAL_ENABLED: "disabled" }, "/srv/simplercp")
    ).toThrow("SIMPLERCP_TERMINAL_ENABLED must be true or false");
  });
});
