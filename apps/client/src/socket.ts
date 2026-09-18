import type {
  CursorPosition,
  EditorSelection,
  FileEditActivity,
  ServerMessage
} from "./types";

export interface ClientSocket {
  sendOpenFile(path: string): void;
  sendFileEdited(path: string, activity: FileEditActivity): void;
  sendCursorChange(
    path: string,
    position: CursorPosition,
    selection: EditorSelection
  ): void;
  sendChat(text: string): void;
  sendReady(): void;
  retry(): void;
  close(): void;
}

export type ConnectionState =
  | "Connecting"
  | "Connected"
  | "Reconnecting"
  | "Offline";

export function connectRoomSocket({
  projectId,
  roomId,
  memberId,
  connectionId,
  onMessage,
  onStateChange,
  onProjectDeleted
}: {
  projectId: string;
  roomId: string;
  memberId: string;
  connectionId?: string;
  onMessage(message: ServerMessage): void;
  onStateChange(state: ConnectionState): void;
  onProjectDeleted(): void;
}): ClientSocket {
  const protocol = window.location.protocol === "https:" ? "wss" : "ws";
  const endpoint = `${protocol}://${window.location.host}/ws?projectId=${encodeURIComponent(projectId)}`;
  let socket: WebSocket | undefined;
  let reconnectTimer: number | undefined;
  let reconnectAttempt = 0;
  let closed = false;
  let readyRequested = false;
  let currentFile: string | undefined;

  function connect() {
    if (closed) return;
    if (reconnectTimer) window.clearTimeout(reconnectTimer);
    reconnectTimer = undefined;
    onStateChange(reconnectAttempt === 0 ? "Connecting" : "Reconnecting");
    const nextSocket = new WebSocket(endpoint);
    socket = nextSocket;
    nextSocket.addEventListener("open", () => {
      reconnectAttempt = 0;
      onStateChange("Connected");
      if (readyRequested) sendNow({ type: "ready" });
      if (currentFile) sendNow({ type: "open_file", path: currentFile });
    });
    nextSocket.addEventListener("message", (event) => {
      onMessage(JSON.parse(event.data) as ServerMessage);
    });
    nextSocket.addEventListener("close", (event) => {
      if (socket === nextSocket) socket = undefined;
      if (closed) return;
      if (event.code === 1001 && event.reason === "Project deleted") {
        closed = true;
        onStateChange("Offline");
        onProjectDeleted();
        return;
      }
      reconnectAttempt += 1;
      if (reconnectAttempt >= 5) {
        onStateChange("Offline");
        return;
      }
      onStateChange("Reconnecting");
      reconnectTimer = window.setTimeout(
        connect,
        Math.min(5_000, 500 * 2 ** Math.min(reconnectAttempt, 4))
      );
    });
    nextSocket.addEventListener("error", () => {
      if (nextSocket.readyState !== WebSocket.CLOSED) nextSocket.close();
    });
  }

  function envelope(message: Record<string, unknown>) {
    return JSON.stringify({ roomId, memberId, connectionId, ...message });
  }

  function sendNow(message: Record<string, unknown>) {
    if (socket?.readyState === WebSocket.OPEN) socket.send(envelope(message));
  }

  function send(message: Record<string, unknown>) {
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(envelope(message));
    }
  }

  connect();

  return {
    sendOpenFile(path) {
      currentFile = path;
      send({ type: "open_file", path });
    },
    sendFileEdited(path, activity) {
      send({ type: "file_edited", path, ...activity });
    },
    sendCursorChange(path, position, selection) {
      send({ type: "cursor_change", path, position, selection });
    },
    sendChat(text) {
      send({ type: "chat_message", text });
    },
    sendReady() {
      readyRequested = true;
      sendNow({ type: "ready" });
    },
    retry() {
      if (closed || socket) return;
      reconnectAttempt = 0;
      connect();
    },
    close() {
      closed = true;
      if (reconnectTimer) window.clearTimeout(reconnectTimer);
      socket?.close();
      socket = undefined;
    }
  };
}
