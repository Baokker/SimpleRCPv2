import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { createOpencodeClient } from "@opencode-ai/sdk/v2";
import { createOpenCodeProcess, OPEN_CODE_PROVIDER_ID } from "../src/agent/openCodeProcess.js";

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const environment = dotenv.config({ path: path.join(repository, ".env") }).parsed ?? {};
const secrets = Object.entries(environment).filter(([name]) => /KEY|TOKEN|SECRET/.test(name)).map(([, value]) => value).filter(Boolean);
const sanitize = (text: string) => secrets.reduce((result, value) => result.split(value).join("[REDACTED]"), text);
const workspace = path.join(repository, ".test-workspaces/stage6-permission-probe");
const evidence = path.join(repository, "docs/conflict-guard/evidence/stage-6-smoke");
await fs.mkdir(workspace, { recursive: true });
await fs.mkdir(evidence, { recursive: true });
await fs.writeFile(path.join(workspace, "probe.ts"), "export const probeValue = 1;\n");
const model = process.env.DEEPSEEK_MODEL ?? "deepseek-chat";
const runtime = createOpenCodeProcess({ port: 4196, apiKey: process.env.DEEPSEEK_API_KEY, baseUrl: process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com/v1", model });
const controller = new AbortController();
const events: unknown[] = [];
let client: ReturnType<typeof createOpencodeClient> | undefined;
let sessionId: string | undefined;
const deadline = setTimeout(() => {
  controller.abort();
  if (client && sessionId) void client.session.abort({ sessionID: sessionId, directory: workspace });
}, 120_000);
try {
  const running = await runtime.start();
  client = createOpencodeClient({ baseUrl: running.url, directory: workspace });
  const session = await client.session.create({ title: "Stage 6 permission probe", permission: [{ permission: "edit", pattern: "*", action: "ask" }] }, { throwOnError: true });
  sessionId = session.data.id;
  const subscription = await client.event.subscribe({ directory: workspace }, { signal: controller.signal });
  const stream = (async () => {
    for await (const event of subscription.stream) {
      if (event.type !== "permission.asked" || event.properties.sessionID !== sessionId) continue;
      events.push(event);
      await fs.writeFile(path.join(evidence, "permission-events.json"), sanitize(JSON.stringify({ version: running.version, events }, null, 2)) + "\n");
      await client!.permission.reply({ requestID: event.properties.id, directory: workspace, reply: "once" }, { throwOnError: true });
    }
  })();
  await client.session.prompt({ sessionID: sessionId, directory: workspace, model: { providerID: OPEN_CODE_PROVIDER_ID, modelID: model }, parts: [{ type: "text", text: "Work only inside this directory. Use the edit tool to change probeValue from 1 to 2 in probe.ts. Then use write to create written.ts with export const writtenValue = 3; Then use apply_patch to add patched.ts with export const patchedValue = 4; Do not use bash for writes. Do not inspect parent directories. Finish after these three operations." }] }, { throwOnError: true, signal: controller.signal });
  controller.abort();
  await stream.catch(() => undefined);
  console.log(JSON.stringify({ permissionEvents: events.length, files: await fs.readdir(workspace) }));
} catch (error) {
  console.error(sanitize(error instanceof Error ? error.message : String(error)));
  process.exitCode = 1;
} finally {
  clearTimeout(deadline);
  controller.abort();
  await runtime.dispose();
}
