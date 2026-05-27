import { defineConfig } from "@playwright/test";
import os from "node:os";
import path from "node:path";

const workspaceRoot = path.join(os.tmpdir(), "simplercp-e2e-workspace");

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  expect: {
    timeout: 10_000
  },
  use: {
    baseURL: "http://127.0.0.1:5173",
    trace: "retain-on-failure"
  },
  webServer: [
    {
      command: `node e2e/prepareWorkspace.mjs && SIMPLERCP_WORKSPACE=${workspaceRoot} SIMPLERCP_COMMANDS="npm test" pnpm --filter @simplercp/server dev`,
      url: "http://127.0.0.1:4000/api/health",
      reuseExistingServer: false,
      timeout: 30_000
    },
    {
      command: "pnpm --filter @simplercp/client dev",
      url: "http://127.0.0.1:5173",
      reuseExistingServer: false,
      timeout: 30_000
    }
  ]
});
