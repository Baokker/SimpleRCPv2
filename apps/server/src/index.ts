import http from "node:http";
import { createApp } from "./createApp.js";
import { loadConfig } from "./config.js";
import { attachRealtimeServer } from "./realtime.js";
import { createSharedTerminal } from "./sharedTerminal.js";
import { watchWorkspace } from "./workspaceWatcher.js";

const config = loadConfig();
const app = createApp(config);
const sharedTerminal = createSharedTerminal({
  workspaceRoot: config.workspaceRoot
});
app.locals.sharedTerminal = sharedTerminal;
const server = http.createServer(app);

const realtime = attachRealtimeServer(server, {
  events: app.locals.events,
  rooms: app.locals.rooms,
  documents: app.locals.documents,
  sessionControl: app.locals.sessionControl,
  terminal: sharedTerminal
});

const workspaceWatcher = watchWorkspace(config.workspaceRoot, async (change) => {
  if (change.type === "change" || change.type === "add") {
    await app.locals.documents.reloadPath(change.path);
  }
  if (change.type === "unlink" || change.type === "unlinkDir") {
    app.locals.documents.dropPath(change.path);
  }
  if (change.type !== "change") {
    realtime.broadcastWorkspaceChanged(change.path);
  }
});

server.listen(config.port, "127.0.0.1", () => {
  console.log(
    `SimpleRCPv2 server listening on http://127.0.0.1:${config.port}`
  );
  console.log(`Workspace root: ${config.workspaceRoot}`);
  console.log(
    `Host URL: http://127.0.0.1:5173/?hostToken=${app.locals.hostAccessToken}`
  );
  console.log("Guest URL: http://127.0.0.1:5173/");
});

let shuttingDown = false;

async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const webSocketServer of [
    realtime.presence,
    realtime.documents,
    realtime.terminal
  ]) {
    for (const client of webSocketServer.clients) client.terminate();
    webSocketServer.close();
  }
  sharedTerminal.dispose();
  await workspaceWatcher.close();
  server.close(() => process.exit(0));
}

process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());
