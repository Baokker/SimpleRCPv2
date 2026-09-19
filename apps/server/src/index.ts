import http from "node:http";
import { fileURLToPath } from "node:url";
import { config as loadEnvironment } from "dotenv";
import { createApp } from "./createApp.js";
import { loadConfig } from "./config.js";
import { attachRealtimeServer } from "./realtime.js";

loadEnvironment({
  path: fileURLToPath(new URL("../../../.env", import.meta.url))
});

const config = loadConfig();
const app = await createApp(config);
const server = http.createServer(app);
const realtime = attachRealtimeServer(
  server,
  app.locals.runtimeManager,
  app.locals.agentRuns
);

server.listen(config.port, config.host, () => {
  console.log(`SimpleRCPv2 server listening on http://${config.host}:${config.port}`);
  console.log(`Open ${config.publicOrigin}`);
  console.log(`Project data: ${config.dataDir}`);
});

let shuttingDown = false;

async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  realtime.dispose();
  for (const webSocketServer of [
    realtime.presence,
    realtime.documents,
    realtime.terminal
  ]) {
    for (const client of webSocketServer.clients) client.terminate();
    webSocketServer.close();
  }
  await app.locals.agentRuns.dispose();
  await app.locals.agentRuntime.dispose();
  await app.locals.runtimeManager.dispose();
  server.close(() => process.exit(0));
}

process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());
