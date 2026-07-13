import http from "node:http";
import { createApp } from "./createApp.js";
import { loadConfig } from "./config.js";
import { attachRealtimeServer } from "./realtime.js";
import { watchWorkspace } from "./workspaceWatcher.js";

const config = loadConfig();
const app = createApp(config);
const server = http.createServer(app);

const realtime = attachRealtimeServer(server, {
  events: app.locals.events,
  rooms: app.locals.rooms,
  documents: app.locals.documents
});

watchWorkspace(config.workspaceRoot, async (change) => {
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
});
