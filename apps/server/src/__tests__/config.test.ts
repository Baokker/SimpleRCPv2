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
      commandWhitelist: ["npm test", "pnpm test"]
    });
  });
});
