import { defineConfig } from "@playwright/test";
import { fileURLToPath } from "node:url";

const data = fileURLToPath(new URL("../.test-workspaces/checkpoint-b-browser/", import.meta.url));
const imports = fileURLToPath(new URL("../demo/", import.meta.url));
export default defineConfig({
  testDir: "./e2e",
  testMatch: "conflict-guard-checkpoint-b.spec.ts",
  workers: 1,
  timeout: 240000,
  expect: { timeout: 20000 },
  use: { baseURL: "http://127.0.0.1:5176", trace: "retain-on-failure" },
  webServer: [
    { command: `PORT=4102 SIMPLERCP_DATA_DIR='${data}' SIMPLERCP_WORKSPACES_DIR=/tmp/simplercp-checkpoint-b-${process.pid} SIMPLERCP_IMPORT_ROOTS='${imports}' SIMPLERCP_FAKE_AGENT_RUNTIME=false SIMPLERCP_TERMINAL_ENABLED=false SIMPLERCP_OPENCODE_PORT=4198 SIMPLERCP_AGENT_RUN_TIMEOUT_MS=180000 CONFLICT_GUARD=full CONFLICT_GUARD_STRATEGY=G3 CONFLICT_GUARD_PROVIDER_MODE=record pnpm --filter @simplercp/server dev`, url: "http://127.0.0.1:4102/api/health", reuseExistingServer: false, timeout: 30000 },
    { command: "VITE_SIMPLERCP_API_ORIGIN=http://127.0.0.1:4102 VITE_SIMPLERCP_CLIENT_PORT=5176 pnpm --filter @simplercp/client exec vite --host 127.0.0.1 --port 5176", url: "http://127.0.0.1:5176", reuseExistingServer: false, timeout: 30000 }
  ]
});
