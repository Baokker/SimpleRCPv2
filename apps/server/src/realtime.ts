import type http from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import { setPersistence, setupWSConnection } from "y-websocket/bin/utils";
import type { CollaborativeDocumentStore } from "./collaborativeDocuments.js";
import type { EventLog } from "./eventLog.js";
import type { RoomStore } from "./rooms.js";
import type { ClientMessage, ServerMessage } from "./types.js";

interface SocketIdentity {
  roomId: string;
  memberId: string;
  connectionId?: string;
}

export interface RealtimeContext {
  events: EventLog;
  rooms: RoomStore;
  documents?: CollaborativeDocumentStore;
}

export function handleRealtimeMessage({
  events,
  rooms,
  message
}: RealtimeContext & { message: ClientMessage }): {
  broadcast: ServerMessage;
} {
  if (message.type === "ready") {
    return {
      broadcast: {
        type: "presence",
        roomId: message.roomId,
        members: rooms.getRoom(message.roomId)?.members ?? []
      }
    };
  }

  if (message.type === "open_file") {
    rooms.updatePresence(message.roomId, message.memberId, {
      currentFile: message.path,
      connectionId: message.connectionId
    });
    events.append({
      type: "file_opened",
      roomId: message.roomId,
      memberId: message.memberId,
      payload: { path: message.path }
    });
    return {
      broadcast: {
        type: "presence",
        roomId: message.roomId,
        members: rooms.getRoom(message.roomId)?.members ?? []
      }
    };
  }

  if (message.type === "file_edited") {
    const event = events.append({
      type: "file_changed",
      roomId: message.roomId,
      memberId: message.memberId,
      payload: { path: message.path }
    });
    return {
      broadcast: {
        type: "event",
        event
      }
    };
  }

  if (message.type === "cursor_change") {
    return {
      broadcast: {
        type: "cursor_change",
        roomId: message.roomId,
        memberId: message.memberId,
        path: message.path,
        position: message.position,
        selection: message.selection
      }
    };
  }

  return {
    broadcast: {
      type: "chat_message",
      roomId: message.roomId,
      memberId: message.memberId,
      text: message.text
    }
  };
}

export function attachRealtimeServer(
  server: http.Server,
  context: RealtimeContext & { documents: CollaborativeDocumentStore }
) {
  const wss = new WebSocketServer({ noServer: true });
  const documentWss = new WebSocketServer({ noServer: true });
  const documents = context.documents;
  const sockets = new Set<WebSocket>();
  const identities = new Map<WebSocket, SocketIdentity>();

  setPersistence({
    provider: null,
    bindState() {},
    async writeState(name, document) {
      await documents.flushDocument(name, document);
      documents.release(name);
    }
  });

  server.on("upgrade", (request, socket, head) => {
    const pathname = new URL(request.url ?? "/", "http://localhost").pathname;
    if (pathname === "/ws") {
      wss.handleUpgrade(request, socket, head, (webSocket) => {
        wss.emit("connection", webSocket, request);
      });
      return;
    }
    if (pathname.startsWith("/yjs/")) {
      const name = decodeURIComponent(pathname.slice("/yjs/".length));
      void documents
        .prepareDocument(name)
        .then(() => {
          documentWss.handleUpgrade(request, socket, head, (webSocket) => {
            setupWSConnection(webSocket, request, { docName: name });
          });
        })
        .catch(() => socket.destroy());
      return;
    }
    socket.destroy();
  });

  wss.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => {
      sockets.delete(socket);
      const identity = identities.get(socket);
      identities.delete(socket);
      if (!identity) return;
      try {
        if (identity.connectionId) {
          context.rooms.markConnectionOffline(
            identity.roomId,
            identity.connectionId
          );
        } else {
          context.rooms.markOffline(identity.roomId, identity.memberId);
        }
        context.rooms.cleanupStaleMembers(identity.roomId);
        broadcastToAll(sockets, {
          type: "presence",
          roomId: identity.roomId,
          members: context.rooms.getRoom(identity.roomId)?.members ?? []
        });
      } catch {
        // The room may have been removed during shutdown.
      }
    });
    socket.on("message", (data) => {
      try {
        const parsed = JSON.parse(data.toString()) as ClientMessage;
        identities.set(socket, {
          roomId: parsed.roomId,
          memberId: parsed.memberId,
          connectionId: parsed.connectionId
        });
        if (parsed.connectionId) {
          context.rooms.markConnectionOnline(parsed.roomId, parsed.connectionId);
        } else {
          context.rooms.markOnline(parsed.roomId, parsed.memberId);
        }
        const { broadcast } = handleRealtimeMessage({
          ...context,
          message: parsed
        });
        broadcastToAll(sockets, broadcast);
      } catch (error) {
        socket.send(
          JSON.stringify({
            type: "event",
            event: {
              id: "realtime-error",
              type: "realtime_error",
              timestamp: new Date().toISOString(),
              payload: {
                message:
                  error instanceof Error ? error.message : "Unknown realtime error"
              }
            }
          } satisfies ServerMessage)
        );
      }
    });
  });

  return {
    presence: wss,
    documents: documentWss,
    broadcastWorkspaceChanged(path: string) {
      broadcastToAll(sockets, { type: "workspace_changed", path });
    }
  };
}

function broadcastToAll(sockets: Set<WebSocket>, message: ServerMessage) {
  const payload = JSON.stringify(message);
  for (const socket of sockets) {
    if (socket.readyState === socket.OPEN) {
      socket.send(payload);
    }
  }
}
