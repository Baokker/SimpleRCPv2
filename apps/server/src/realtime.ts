import type http from "node:http";
import { WebSocketServer, type RawData, type WebSocket } from "ws";
import { setPersistence, setupWSConnection } from "y-websocket/bin/utils";
import { parseDocumentName } from "./collaborativeDocuments.js";
import type { EventLog } from "./eventLog.js";
import type { AgentRunManager } from "./agent/agentRunManager.js";
import type { ProjectRuntime } from "./projectRuntime.js";
import type { ProjectRuntimeManager } from "./projectRuntimeManager.js";
import type { RoomStore } from "./rooms.js";
import type {
  ClientMessage,
  FileEditActivity,
  ServerMessage,
  TerminalClientMessage,
  TerminalServerMessage
} from "./types.js";

interface SocketIdentity {
  projectId: string;
  roomId: string;
  memberId: string;
  connectionId?: string;
}

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
    const activity = readFileEditActivity(message);
    const member = rooms.getMember(message.roomId, message.memberId);
    if (!member) throw new Error("Project membership is required");
    const event = events.append({
      type: "file_changed",
      roomId: message.roomId,
      memberId: message.memberId,
      participantId: member.participantId,
      payload: { path: message.path, name: member.displayName, ...activity }
    });
    return { broadcast: { type: "event", event } };
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

  if (message.type === "chat_message") {
    return {
      broadcast: {
        type: "chat_message",
        roomId: message.roomId,
        memberId: message.memberId,
        text: message.text
      }
    };
  }

  const unexpected: never = message;
  throw new Error(`Unknown realtime message: ${JSON.stringify(unexpected)}`);
}

function readFileEditActivity(
  message: Extract<ClientMessage, { type: "file_edited" }>
): FileEditActivity {
  if (!Array.isArray(message.ranges) || message.ranges.length === 0) {
    throw new Error("File edit ranges are required");
  }
  if (message.ranges.length > 100) {
    throw new Error("File edit range limit exceeded");
  }
  const ranges = message.ranges.map((range) => {
    if (
      !Number.isInteger(range.startLine) ||
      !Number.isInteger(range.endLine) ||
      range.startLine < 1 ||
      range.endLine < range.startLine
    ) {
      throw new Error("File edit range is invalid");
    }
    return { startLine: range.startLine, endLine: range.endLine };
  });
  if (
    !Number.isInteger(message.addedLines) ||
    !Number.isInteger(message.removedLines) ||
    message.addedLines < 0 ||
    message.removedLines < 0
  ) {
    throw new Error("File edit line counts are invalid");
  }
  const startedAt = Date.parse(message.startedAt);
  const finishedAt = Date.parse(message.finishedAt);
  if (
    !Number.isFinite(startedAt) ||
    !Number.isFinite(finishedAt) ||
    finishedAt < startedAt
  ) {
    throw new Error("File edit timestamps are invalid");
  }
  return {
    ranges,
    addedLines: message.addedLines,
    removedLines: message.removedLines,
    startedAt: message.startedAt,
    finishedAt: message.finishedAt
  };
}

export function attachRealtimeServer(
  server: http.Server,
  runtimeManager: ProjectRuntimeManager,
  agentRuns?: AgentRunManager
) {
  const presenceWss = new WebSocketServer({ noServer: true });
  const documentWss = new WebSocketServer({ noServer: true });
  const terminalWss = new WebSocketServer({ noServer: true });
  const projectSockets = new Map<string, Set<WebSocket>>();
  const documentProjects = new Map<WebSocket, string>();
  const terminalProjects = new Map<WebSocket, string>();
  const identities = new Map<WebSocket, SocketIdentity>();
  const runtimeSubscriptions = new Map<string, Array<() => void>>();
  const removeAgentListener = agentRuns?.onEvent((event) => {
    if (event.type === "activity_appended") {
      broadcastToProject(projectSockets, event.projectId, {
        type: "event",
        event: event.event
      });
      return;
    }
    if (event.type === "run_updated") {
      broadcastToProject(projectSockets, event.projectId, {
        type: "agent_run_updated",
        run: event.run
      });
      return;
    }
    broadcastToProject(projectSockets, event.projectId, {
      type: "agent_trace_appended",
      runId: event.runId,
      sequence: event.event.sequence
    });
  });
  const removeProjectDisposingListener = runtimeManager.onProjectDisposing(
    (projectId) => {
      for (const socket of projectSockets.get(projectId) ?? []) {
        socket.close(1001, "Project deleted");
      }
      projectSockets.delete(projectId);
      for (const [socket, activeProjectId] of documentProjects) {
        if (activeProjectId === projectId) socket.close(1001, "Project deleted");
      }
      for (const [socket, activeProjectId] of terminalProjects) {
        if (activeProjectId === projectId) socket.close(1001, "Project deleted");
      }
      for (const remove of runtimeSubscriptions.get(projectId) ?? []) remove();
      runtimeSubscriptions.delete(projectId);
    }
  );

  function ensureRuntimeSubscriptions(runtime: ProjectRuntime) {
    if (runtimeSubscriptions.has(runtime.project.id)) return;
    const removeWorkspaceListener = runtime.onWorkspaceChanged((change) => {
      broadcastToProject(projectSockets, runtime.project.id, {
        type: "workspace_changed",
        change
      });
    });
    const removeFileSavedListener = runtime.onFileSaved((path) => {
      broadcastToProject(projectSockets, runtime.project.id, {
        type: "file_saved",
        path
      });
    });
    const removeTerminalListener = runtime.onTerminalData((data) => {
      const payload = JSON.stringify({
        type: "terminal_output",
        data
      } satisfies TerminalServerMessage);
      for (const socket of terminalWss.clients) {
        if (
          terminalProjects.get(socket) === runtime.project.id &&
          socket.readyState === socket.OPEN
        ) {
          socket.send(payload);
        }
      }
    });
    runtimeSubscriptions.set(runtime.project.id, [
      removeWorkspaceListener,
      removeFileSavedListener,
      removeTerminalListener
    ]);
  }

  setPersistence({
    provider: null,
    bindState() {},
    async writeState(name, document) {
      const { projectId } = parseDocumentName(name);
      if (!projectId) throw new Error("Project document is missing projectId");
      const documents = runtimeManager.get(projectId).documents;
      await documents.flushDocument(name, document);
      documents.release(name);
    }
  });

  server.on("upgrade", (request, socket, head) => {
    const requestUrl = new URL(request.url ?? "/", "http://localhost");
    const pathname = requestUrl.pathname;

    if (pathname === "/ws") {
      const projectId = requestUrl.searchParams.get("projectId") ?? "";
      const runtime = getRuntime(runtimeManager, projectId, socket);
      if (!runtime) return;
      ensureRuntimeSubscriptions(runtime);
      if (!projectSockets.has(projectId)) {
        projectSockets.set(projectId, new Set());
      }
      presenceWss.handleUpgrade(request, socket, head, (webSocket) => {
        projectSockets.get(projectId)?.add(webSocket);
        presenceWss.emit("connection", webSocket, request, projectId);
      });
      return;
    }

    if (pathname.startsWith("/yjs/")) {
      const segments = pathname.slice("/yjs/".length).split("/");
      if (segments.length !== 2) {
        socket.destroy();
        return;
      }
      const projectId = decodeURIComponent(segments[0] ?? "");
      const documentPart = decodeURIComponent(segments[1] ?? "");
      const runtime = getRuntime(runtimeManager, projectId, socket);
      if (!runtime) return;
      ensureRuntimeSubscriptions(runtime);
      const documentName = `${projectId}|${documentPart}`;
      const memberId = requestUrl.searchParams.get("memberId") ?? "";
      const { roomId } = parseDocumentName(documentName);
      if (!runtime.rooms.getMember(roomId, memberId)) {
        socket.destroy();
        return;
      }
      void runtime.documents
        .prepareDocument(documentName)
        .then(() => {
          documentWss.handleUpgrade(request, socket, head, (webSocket) => {
            documentProjects.set(webSocket, projectId);
            webSocket.on("close", () => documentProjects.delete(webSocket));
            setupWSConnection(webSocket, request, { docName: documentName });
          });
        })
        .catch(() => socket.destroy());
      return;
    }

    if (pathname === "/terminal") {
      const projectId = requestUrl.searchParams.get("projectId") ?? "";
      const runtime = getRuntime(runtimeManager, projectId, socket);
      if (!runtime) return;
      if (!runtime.terminalEnabled) {
        socket.destroy();
        return;
      }
      ensureRuntimeSubscriptions(runtime);
      const memberId = requestUrl.searchParams.get("memberId") ?? "";
      if (!runtime.rooms.getMember(runtime.room.id, memberId)) {
        socket.destroy();
        return;
      }
      terminalWss.handleUpgrade(request, socket, head, (webSocket) => {
        terminalProjects.set(webSocket, projectId);
        webSocket.on("close", () => terminalProjects.delete(webSocket));
        setupTerminalConnection(webSocket, memberId, runtime);
      });
      return;
    }

    socket.destroy();
  });

  presenceWss.on(
    "connection",
    (socket: WebSocket, _request: http.IncomingMessage, projectId: string) => {
    socket.on("close", () => {
      projectSockets.get(projectId)?.delete(socket);
      const identity = identities.get(socket);
      identities.delete(socket);
      if (!identity) return;
      const runtime = runtimeManager.find(identity.projectId);
      if (!runtime) return;
      if (identity.connectionId) {
        runtime.rooms.markConnectionOffline(
          identity.roomId,
          identity.connectionId
        );
      } else {
        runtime.rooms.markOffline(identity.roomId, identity.memberId);
      }
      runtime.rooms.cleanupStaleMembers(identity.roomId);
      broadcastToProject(projectSockets, projectId, {
        type: "presence",
        roomId: identity.roomId,
        members: runtime.rooms.getRoom(identity.roomId)?.members ?? []
      });
    });

    socket.on("message", (data: RawData) => {
      const runtime = runtimeManager.get(projectId);
      try {
        const parsed = JSON.parse(data.toString()) as ClientMessage;
        identities.set(socket, {
          projectId,
          roomId: parsed.roomId,
          memberId: parsed.memberId,
          connectionId: parsed.connectionId
        });
        if (parsed.connectionId) {
          runtime.rooms.markConnectionOnline(parsed.roomId, parsed.connectionId);
        } else {
          runtime.rooms.markOnline(parsed.roomId, parsed.memberId);
        }
        const { broadcast } = handleRealtimeMessage({
          events: runtime.events,
          rooms: runtime.rooms,
          message: parsed
        });
        broadcastToProject(projectSockets, projectId, broadcast);
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
    }
  );

  return {
    presence: presenceWss,
    documents: documentWss,
    terminal: terminalWss,
    dispose() {
      removeAgentListener?.();
      removeProjectDisposingListener();
      for (const removers of runtimeSubscriptions.values()) {
        for (const remove of removers) remove();
      }
      runtimeSubscriptions.clear();
    }
  };
}

function setupTerminalConnection(
  socket: WebSocket,
  memberId: string,
  runtime: ProjectRuntime
) {
  socket.send(
    JSON.stringify({
      type: "terminal_snapshot",
      data: runtime.terminal.getScrollback()
    } satisfies TerminalServerMessage)
  );
  socket.on("message", (raw: RawData) => {
    try {
      handleTerminalMessage(
        socket,
        JSON.parse(raw.toString()) as TerminalClientMessage,
        memberId,
        runtime
      );
    } catch {
      socket.send(
        JSON.stringify({
          type: "terminal_error",
          message: "Invalid terminal message"
        } satisfies TerminalServerMessage)
      );
    }
  });
}

function handleTerminalMessage(
  socket: WebSocket,
  message: TerminalClientMessage,
  memberId: string,
  runtime: ProjectRuntime
) {
  if (!runtime.rooms.getMember(runtime.room.id, memberId)) return;
  if (message.type === "resize") {
    runtime.terminal.resize(message.cols, message.rows);
    return;
  }
  if (message.type === "restart") {
    runtime.terminal.restart();
    return;
  }
  if (message.data.length > 10_000) {
    socket.send(
      JSON.stringify({
        type: "terminal_error",
        message: "Terminal input exceeds the 10000 character limit"
      } satisfies TerminalServerMessage)
    );
    return;
  }
  runtime.terminal.write(message.data);
}

function getRuntime(
  runtimeManager: ProjectRuntimeManager,
  projectId: string,
  socket: { destroy(): void }
) {
  if (!projectId) {
    socket.destroy();
    return undefined;
  }
  const project = runtimeManager.find(projectId);
  if (project) return project;
  try {
    return runtimeManager.get(projectId);
  } catch {
    socket.destroy();
    return undefined;
  }
}

function broadcastToProject(
  projectSockets: Map<string, Set<WebSocket>>,
  projectId: string,
  message: ServerMessage
) {
  const payload = JSON.stringify(message);
  for (const socket of projectSockets.get(projectId) ?? []) {
    if (socket.readyState === socket.OPEN) socket.send(payload);
  }
}
