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
      demoProjectRoot: "/srv/simplercp/demo/workspace"
    });
  });

  it("loads deployment settings from environment", () => {
    expect(
      loadConfig({
        PORT: "4500",
        SIMPLERCP_HOST: "0.0.0.0",
        SIMPLERCP_PUBLIC_URL: "https://code.example.com",
        SIMPLERCP_DATA_DIR: "/srv/simplercp-data"
      }, "/srv/simplercp")
    ).toEqual({
      port: 4500,
      host: "0.0.0.0",
      publicOrigin: "https://code.example.com",
      dataDir: "/srv/simplercp-data",
      demoProjectRoot: path.resolve("/srv/simplercp/demo/workspace")
    });
  });

  it("rejects a relative data directory", () => {
    expect(() =>
      loadConfig({ SIMPLERCP_DATA_DIR: "runtime-data" }, "/srv/simplercp")
    ).toThrow("SIMPLERCP_DATA_DIR must be an absolute path");
  });
});
