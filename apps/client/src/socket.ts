import type { ServerMessage } from "./types";

export interface ClientSocket {
  sendOpenFile(path: string): void;
  sendFileChange(path: string, content: string): void;
  sendChat(text: string): void;
  sendReady(): void;
  close(): void;
}

export function connectRoomSocket({
  roomId,
  memberId,
  connectionId,
  onMessage
}: {
  roomId: string;
  memberId: string;
  connectionId?: string;
  onMessage(message: ServerMessage): void;
}): ClientSocket {
  const protocol = window.location.protocol === "https:" ? "wss" : "ws";
  const socket = new WebSocket(`${protocol}://${window.location.host}/ws`);
  socket.addEventListener("message", (event) => {
    onMessage(JSON.parse(event.data) as ServerMessage);
  });

  function send(message: Record<string, unknown>) {
    const payload = JSON.stringify({ roomId, memberId, connectionId, ...message });
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(payload);
    } else {
      socket.addEventListener("open", () => socket.send(payload), {
        once: true
      });
    }
  }

  return {
    sendOpenFile(path) {
      send({ type: "open_file", path });
    },
    sendFileChange(path, content) {
      send({ type: "file_change", path, content });
    },
    sendChat(text) {
      send({ type: "chat_message", text });
    },
    sendReady() {
      send({ type: "ready" });
    },
    close() {
      socket.close();
    }
  };
}
