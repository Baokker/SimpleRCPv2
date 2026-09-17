import type {
  CursorPosition,
  EditorSelection,
  ServerMessage
} from "./types";

export interface ClientSocket {
  sendOpenFile(path: string): void;
  sendFileEdited(path: string): void;
  sendCursorChange(
    path: string,
    position: CursorPosition,
    selection: EditorSelection
  ): void;
  sendChat(text: string): void;
  sendReady(): void;
  close(): void;
}

export function connectRoomSocket({
  projectId,
  roomId,
  memberId,
  connectionId,
  onMessage
}: {
  projectId: string;
  roomId: string;
  memberId: string;
  connectionId?: string;
  onMessage(message: ServerMessage): void;
}): ClientSocket {
  const protocol = window.location.protocol === "https:" ? "wss" : "ws";
  const socket = new WebSocket(
    `${protocol}://${window.location.host}/ws?projectId=${encodeURIComponent(projectId)}`
  );
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
    sendFileEdited(path) {
      send({ type: "file_edited", path });
    },
    sendCursorChange(path, position, selection) {
      send({ type: "cursor_change", path, position, selection });
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
