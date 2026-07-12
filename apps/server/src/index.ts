import http from "node:http";
import { createApp } from "./createApp.js";
import { loadConfig } from "./config.js";
import { attachRealtimeServer } from "./realtime.js";

const config = loadConfig();
const app = createApp(config);
const server = http.createServer(app);

attachRealtimeServer(server, {
  events: app.locals.events,
  rooms: app.locals.rooms,
  documents: app.locals.documents
});

server.listen(config.port, "127.0.0.1", () => {
  console.log(
    `SimpleRCPv2 server listening on http://127.0.0.1:${config.port}`
  );
  console.log(`Workspace root: ${config.workspaceRoot}`);
});
