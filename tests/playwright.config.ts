import { defineConfig } from "@playwright/test";
import { fileURLToPath } from "node:url";

const workspaceRoot = fileURLToPath(
  new URL("../.test-workspaces/e2e-workspace/", import.meta.url)
);
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
      command: `node e2e/prepareWorkspace.mjs && PORT=${serverPort} SIMPLERCP_WORKSPACE=${JSON.stringify(workspaceRoot)} SIMPLERCP_COMMANDS="npm test" SIMPLERCP_COMMAND_MODE=unrestricted SIMPLERCP_HOST_TOKEN=e2e-host-secret SIMPLERCP_SHELL=/bin/sh pnpm --filter @simplercp/server dev`,
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
