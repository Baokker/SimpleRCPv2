import { defineConfig } from "@playwright/test";
import os from "node:os";
import path from "node:path";

const workspaceRoot = path.join(os.tmpdir(), "simplercp-e2e-workspace");
const serverPort = 4100;
const clientPort = 5174;

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  expect: {
    timeout: 10_000
  },
  use: {
    baseURL: `http://127.0.0.1:${clientPort}`,
    trace: "retain-on-failure"
  },
  webServer: [
    {
      command: `node e2e/prepareWorkspace.mjs && PORT=${serverPort} SIMPLERCP_WORKSPACE=${workspaceRoot} SIMPLERCP_COMMANDS="npm test" SIMPLERCP_COMMAND_MODE=unrestricted pnpm --filter @simplercp/server dev`,
      url: `http://127.0.0.1:${serverPort}/api/health`,
      reuseExistingServer: false,
      timeout: 30_000
    },
    {
      command: `VITE_SIMPLERCP_API_ORIGIN=http://127.0.0.1:${serverPort} VITE_SIMPLERCP_CLIENT_PORT=${clientPort} pnpm --filter @simplercp/client exec vite --host 127.0.0.1 --port ${clientPort}`,
      url: `http://127.0.0.1:${clientPort}`,
      reuseExistingServer: false,
      timeout: 30_000
    }
  ]
});
