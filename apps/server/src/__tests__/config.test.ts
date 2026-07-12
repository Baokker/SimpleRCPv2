import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../config.js";

describe("server config", () => {
  it("loads workspace, port, and command whitelist from environment", () => {
    expect(
      loadConfig({
        PORT: "4500",
        SIMPLERCP_WORKSPACE: "tests/fixtures/sample-workspace",
        SIMPLERCP_COMMANDS: "npm test,pnpm test"
      })
    ).toEqual({
      port: 4500,
      workspaceRoot: path.resolve("tests/fixtures/sample-workspace"),
      commandWhitelist: ["npm test", "pnpm test"],
      commandMode: "restricted"
    });
  });

  it("loads unrestricted command mode when explicitly configured", () => {
    expect(
      loadConfig({
        SIMPLERCP_WORKSPACE: ".",
        SIMPLERCP_COMMAND_MODE: "unrestricted"
      }).commandMode
    ).toBe("unrestricted");
  });
});
