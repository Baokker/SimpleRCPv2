import type http from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import type { EventLog } from "./eventLog.js";
import type { RoomStore } from "./rooms.js";
import type { ClientMessage, ServerMessage } from "./types.js";

export interface RealtimeContext {
  events: EventLog;
  rooms: RoomStore;
}

export function handleRealtimeMessage({
  events,
  rooms,
  message
}: RealtimeContext & { message: ClientMessage }): {
  broadcast: ServerMessage;
} {
  if (message.type === "open_file") {
    rooms.updatePresence(message.roomId, message.memberId, {
      currentFile: message.path
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

  if (message.type === "file_change") {
    events.append({
      type: "file_changed",
      roomId: message.roomId,
      memberId: message.memberId,
      payload: { path: message.path }
    });
    return {
      broadcast: {
        type: "file_change",
        roomId: message.roomId,
        memberId: message.memberId,
        path: message.path,
        content: message.content
      }
    };
  }

  events.append({
    type: "chat_message",
    roomId: message.roomId,
    memberId: message.memberId,
    payload: { text: message.text }
  });

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
  context: RealtimeContext
) {
  const wss = new WebSocketServer({ server, path: "/ws" });
  const sockets = new Set<WebSocket>();

  wss.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.on("message", (data) => {
      try {
        const parsed = JSON.parse(data.toString()) as ClientMessage;
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

  return wss;
}

function broadcastToAll(sockets: Set<WebSocket>, message: ServerMessage) {
  const payload = JSON.stringify(message);
  for (const socket of sockets) {
    if (socket.readyState === socket.OPEN) {
      socket.send(payload);
    }
  }
}
