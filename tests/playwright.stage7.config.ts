import { defineConfig } from "@playwright/test";
import { fileURLToPath } from "node:url";

const data = fileURLToPath(new URL("../.test-workspaces/stage7-browser/", import.meta.url));
const imports = fileURLToPath(new URL("../demo/", import.meta.url));
export default defineConfig({
  testDir: "./e2e", testMatch: "conflict-guard-arbitration.spec.ts", workers: 1,
  timeout: 540000, expect: { timeout: 20000 },
  use: { baseURL: "http://127.0.0.1:5177", trace: "retain-on-failure" },
  webServer: [
    { command: `PORT=4103 SIMPLERCP_DATA_DIR='${data}' SIMPLERCP_IMPORT_ROOTS='${imports}' SIMPLERCP_FAKE_AGENT_RUNTIME=false SIMPLERCP_TERMINAL_ENABLED=false SIMPLERCP_OPENCODE_PORT=4199 SIMPLERCP_AGENT_RUN_TIMEOUT_MS=180000 CONFLICT_GUARD=full CONFLICT_GUARD_ARBITRATION=owner CONFLICT_GUARD_INTENT_INJECTION=on CONFLICT_GUARD_PROVIDER_MODE=record pnpm --filter @simplercp/server exec node dist/index.js`, url: "http://127.0.0.1:4103/api/health", reuseExistingServer: false, timeout: 30000 },
    { command: "VITE_SIMPLERCP_API_ORIGIN=http://127.0.0.1:4103 VITE_SIMPLERCP_CLIENT_PORT=5177 pnpm --filter @simplercp/client exec vite --host 127.0.0.1 --port 5177", url: "http://127.0.0.1:5177", reuseExistingServer: false, timeout: 30000 }
  ]
});
