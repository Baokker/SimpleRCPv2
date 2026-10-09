import { defineConfig } from "@playwright/test";
import { fileURLToPath } from "node:url";

const dataDir = fileURLToPath(
  new URL("../.test-workspaces/e2e-data/", import.meta.url)
);
const serverPort = Number(process.env.SIMPLERCP_E2E_SERVER_PORT ?? 4100);
const clientPort = Number(process.env.SIMPLERCP_E2E_CLIENT_PORT ?? 5174);
const openCodePort = Number(process.env.SIMPLERCP_E2E_OPENCODE_PORT ?? 4296);
const terminalEnabled = process.env.SIMPLERCP_TERMINAL_ENABLED ?? "true";
const knowledgeMode = process.env.KNOWLEDGE ?? "off";
const fakeAgentRuntime = process.env.SIMPLERCP_FAKE_AGENT_RUNTIME ?? "true";
const maxConcurrentRuns = process.env.SIMPLERCP_AGENT_MAX_CONCURRENT_RUNS ?? "3";
const importRoot = fileURLToPath(new URL("../demo/", import.meta.url));

export default defineConfig({
  testDir: "./e2e",
  workers: 1,
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
      command: `node e2e/prepareWorkspace.mjs && PORT=${serverPort} KNOWLEDGE=${knowledgeMode} SIMPLERCP_DATA_DIR='${dataDir}' SIMPLERCP_IMPORT_ROOTS='${importRoot}' SIMPLERCP_OPENCODE_PORT=${openCodePort} SIMPLERCP_SHELL=/bin/sh SIMPLERCP_TERMINAL_ENABLED=${terminalEnabled} SIMPLERCP_FAKE_AGENT_RUNTIME=${fakeAgentRuntime} SIMPLERCP_AGENT_MAX_CONCURRENT_RUNS='${maxConcurrentRuns}' pnpm --filter @simplercp/server dev:once`,
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
