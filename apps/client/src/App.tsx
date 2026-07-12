import { useEffect, useMemo, useRef, useState } from "react";
import {
  createWorkspaceDirectory,
  createWorkspaceFile,
  deleteWorkspacePath,
  getChatMessages,
  getEvents,
  getHealth,
  getRoom,
  getRuntimeConfig,
  getWorkspaceTree,
  joinRoom,
  readWorkspaceFile,
  renameWorkspacePath,
  runQuickCommand,
  sendChatMessage,
  sendConnectionOffline
} from "./api";
import { CollaborationPanel } from "./components/CollaborationPanel";
import { EditorArea, type OpenFile } from "./components/EditorArea";
import { TerminalPanel } from "./components/TerminalPanel";
import { WorkspaceExplorer } from "./components/WorkspaceExplorer";
import { connectRoomSocket, type ClientSocket } from "./socket";
import type {
  ChatMessage,
  CursorPosition,
  EditorSelection,
  EventRecord,
  RemoteCursor,
  RoomMember,
  RuntimeConfig,
  WorkspaceNode
} from "./types";

export function App() {
  const [roomId, setRoomId] = useState("");
  const [member, setMember] = useState<RoomMember | null>(null);
  const [members, setMembers] = useState<RoomMember[]>([]);
  const [tree, setTree] = useState<WorkspaceNode[]>([]);
  const [openFiles, setOpenFiles] = useState<OpenFile[]>([]);
  const [activePath, setActivePath] = useState<string>();
  const [events, setEvents] = useState<EventRecord[]>([]);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [remoteCursorMap, setRemoteCursorMap] = useState<
    Record<string, RemoteCursor>
  >({});
  const [runtimeConfig, setRuntimeConfig] = useState<RuntimeConfig>({
    commandMode: "restricted",
    commands: []
  });
  const [chatText, setChatText] = useState("");
  const [terminalLines, setTerminalLines] = useState<string[]>([]);
  const [selectedCommand, setSelectedCommand] = useState("");
  const [commandText, setCommandText] = useState("");
  const [workspaceName, setWorkspaceName] = useState("");
  const [commandRunning, setCommandRunning] = useState(false);
  const [connectionState, setConnectionState] = useState("Connecting");
  const socketRef = useRef<ClientSocket | null>(null);
  const membersRef = useRef<RoomMember[]>([]);
  const connectionRef = useRef<{ roomId: string; connectionId: string } | null>(
    null
  );
  const bootStartedRef = useRef(false);
  const editTimersRef = useRef(new Map<string, number>());

  const displayName = useMemo(
    () =>
      new URLSearchParams(window.location.search).get("name") ??
      `User-${Math.floor(Math.random() * 1000)}`,
    []
  );
  const remoteCursors = useMemo(
    () => Object.values(remoteCursorMap),
    [remoteCursorMap]
  );

  useEffect(() => {
    if (bootStartedRef.current) return;
    bootStartedRef.current = true;
    let mounted = true;

    async function boot() {
      const health = await getHealth();
      const userId = getUserId(displayName);
      const connectionId = getConnectionId();
      const joined = await joinRoom(
        health.roomId,
        displayName,
        userId,
        connectionId
      );
      const [room, workspaceTree, eventRecords, runtime, messages] =
        await Promise.all([
          getRoom(health.roomId),
          getWorkspaceTree(),
          getEvents(),
          getRuntimeConfig(),
          getChatMessages(health.roomId)
        ]);

      if (!mounted) return;
      membersRef.current = room.members;
      setRoomId(health.roomId);
      setMember(joined);
      setMembers(room.members);
      setWorkspaceName(room.workspaceName);
      setTree(workspaceTree);
      setEvents(eventRecords);
      setRuntimeConfig(runtime);
      setChatMessages(messages);
      setSelectedCommand(runtime.commands[0] ?? "");
      setCommandText(runtime.commands[0] ?? "");

      const connected = connectRoomSocket({
        roomId: health.roomId,
        memberId: joined.id,
        connectionId,
        onMessage(message) {
          setConnectionState("Connected");
          if (message.type === "presence") {
            membersRef.current = message.members;
            setMembers(message.members);
            const onlineIds = new Set(
              message.members
                .filter((candidate) => candidate.online)
                .map((candidate) => candidate.id)
            );
            setRemoteCursorMap((cursors) =>
              Object.fromEntries(
                Object.entries(cursors)
                  .filter(([memberId]) => onlineIds.has(memberId))
                  .map(([memberId, cursor]) => [
                    memberId,
                    {
                      ...cursor,
                      displayName:
                        message.members.find(
                          (candidate) => candidate.id === memberId
                        )?.displayName ?? cursor.displayName
                    }
                  ])
              )
            );
          }
          if (message.type === "cursor_change" && message.memberId !== joined.id) {
            const collaborator = membersRef.current.find(
              (candidate) => candidate.id === message.memberId
            );
            setRemoteCursorMap((cursors) => ({
              ...cursors,
              [message.memberId]: {
                memberId: message.memberId,
                displayName: collaborator?.displayName ?? "Collaborator",
                path: message.path,
                position: message.position,
                selection: message.selection
              }
            }));
          }
          if (message.type === "chat_message") {
            void refreshSharedState(health.roomId);
          }
        }
      });
      connectionRef.current = { roomId: health.roomId, connectionId };
      socketRef.current = connected;
      connected.sendReady();
    }

    void boot();
    return () => {
      mounted = false;
      const connection = connectionRef.current;
      if (connection) {
        sendConnectionOffline(connection.roomId, connection.connectionId);
      }
      socketRef.current?.close();
      for (const timer of editTimersRef.current.values()) {
        window.clearTimeout(timer);
      }
      editTimersRef.current.clear();
    };
  }, [displayName]);

  useEffect(() => {
    function markOffline() {
      const connection = connectionRef.current;
      if (connection) {
        sendConnectionOffline(connection.roomId, connection.connectionId);
      }
    }
    window.addEventListener("pagehide", markOffline);
    return () => window.removeEventListener("pagehide", markOffline);
  }, []);

  useEffect(() => {
    if (!roomId) return;
    const timer = window.setInterval(() => {
      void refreshSharedState(roomId);
    }, 1500);
    return () => window.clearInterval(timer);
  }, [roomId]);

  async function refreshSharedState(targetRoomId: string) {
    const [room, eventRecords, workspaceTree, messages] = await Promise.all([
      getRoom(targetRoomId),
      getEvents(),
      getWorkspaceTree(),
      getChatMessages(targetRoomId)
    ]);
    membersRef.current = room.members;
    setMembers(room.members);
    setEvents(eventRecords);
    setTree(workspaceTree);
    setChatMessages(messages);
    setTerminalLines(terminalLinesFromEvents(eventRecords));
  }

  async function refreshEvents() {
    setEvents(await getEvents());
  }

  async function openFile(path: string) {
    if (!openFiles.some((file) => file.path === path)) {
      let result = await readWorkspaceFile(path);
      if (result.status === "binary") {
        window.alert(
          `${path} is a binary file (${formatBytes(result.size)}) and cannot be opened in the text editor.`
        );
        return;
      }
      if (result.status === "large") {
        const shouldLoad = window.confirm(
          `${path} is ${formatBytes(result.size)}. Large files may slow down collaboration. Open it anyway?`
        );
        if (!shouldLoad) return;
        result = await readWorkspaceFile(path, true);
      }
      if (result.status !== "text") return;
      setOpenFiles((files) => [
        ...files,
        { path, content: result.content }
      ]);
    }
    setActivePath(path);
    socketRef.current?.sendOpenFile(path);
    await refreshEvents();
  }

  function selectFile(path: string) {
    setActivePath(path);
    socketRef.current?.sendOpenFile(path);
  }

  function reportFileEdit(path: string) {
    const existing = editTimersRef.current.get(path);
    if (existing) window.clearTimeout(existing);
    editTimersRef.current.set(
      path,
      window.setTimeout(() => {
        editTimersRef.current.delete(path);
        socketRef.current?.sendFileEdited(path);
      }, 400)
    );
  }

  function changeCursor(
    path: string,
    position: CursorPosition,
    selection: EditorSelection
  ) {
    socketRef.current?.sendCursorChange(path, position, selection);
  }

  async function sendChat() {
    const text = chatText.trim();
    if (!text || !member || !roomId) return;
    await sendChatMessage(roomId, {
      authorId: member.id,
      authorName: member.displayName,
      text
    });
    socketRef.current?.sendChat(text);
    setChatText("");
    await refreshSharedState(roomId);
  }

  async function createFileFromPrompt() {
    const path = window.prompt("New file path");
    if (!path || !member) return;
    setTree(await createWorkspaceFile(path, member.id));
    await openFile(path);
  }

  async function createFolderFromPrompt() {
    const path = window.prompt("New folder path");
    if (!path || !member) return;
    setTree(await createWorkspaceDirectory(path, member.id));
    await refreshEvents();
  }

  async function renamePathFromPrompt(path: string) {
    const toPath = window.prompt("Rename path", path);
    if (!toPath || toPath === path || !member) return;
    setTree(await renameWorkspacePath(path, toPath, member.id));
    setOpenFiles((files) =>
      files.map((file) =>
        file.path === path ? { ...file, path: toPath } : file
      )
    );
    if (activePath === path) setActivePath(toPath);
    await refreshEvents();
  }

  async function deletePathWithConfirm(path: string) {
    if (!window.confirm(`Delete ${path}?`) || !member) return;
    setTree(await deleteWorkspacePath(path, member.id));
    closePath(path);
    await refreshEvents();
  }

  async function runSelectedCommand() {
    const command =
      runtimeConfig.commandMode === "unrestricted"
        ? commandText.trim()
        : selectedCommand;
    if (!member || !command || !roomId) return;
    setCommandRunning(true);
    try {
      const run = await runQuickCommand(command, member.id);
      setTerminalLines((lines) => [
        ...lines,
        `$ ${command}`,
        run.output.trimEnd(),
        `exit ${run.exitCode}`
      ]);
      await refreshSharedState(roomId);
    } finally {
      setCommandRunning(false);
    }
  }

  function closePath(path: string) {
    setOpenFiles((files) =>
      files.filter((file) => file.path !== path && !file.path.startsWith(`${path}/`))
    );
    if (activePath === path || activePath?.startsWith(`${path}/`)) {
      setActivePath(undefined);
    }
  }

  function closeFile(path: string) {
    const index = openFiles.findIndex((file) => file.path === path);
    if (index < 0) return;
    const remaining = openFiles.filter((file) => file.path !== path);
    setOpenFiles(remaining);

    if (activePath === path) {
      const next = remaining[Math.min(index, remaining.length - 1)];
      setActivePath(next?.path);
      if (next) socketRef.current?.sendOpenFile(next.path);
    }
  }

  return (
    <main className="app-shell">
      <aside className="workspace-pane">
        <WorkspaceExplorer
          tree={tree}
          activePath={activePath}
          workspaceName={workspaceName}
          onOpenFile={openFile}
          onCreateFile={createFileFromPrompt}
          onCreateFolder={createFolderFromPrompt}
          onRenamePath={renamePathFromPrompt}
          onDeletePath={deletePathWithConfirm}
        />
      </aside>
      <section className="editor-pane">
        <EditorArea
          openFiles={openFiles}
          activePath={activePath}
          roomId={roomId}
          remoteCursors={remoteCursors}
          onSelectFile={selectFile}
          onCloseFile={closeFile}
          onLocalEdit={reportFileEdit}
          onCursorChange={changeCursor}
        />
      </section>
      <aside className="collab-pane">
        <CollaborationPanel
          members={members}
          events={events}
          chatMessages={chatMessages}
          remoteCursors={remoteCursors}
          chatText={chatText}
          onChatTextChange={setChatText}
          onSendChat={sendChat}
        />
      </aside>
      <section className="terminal-pane">
        <TerminalPanel
          lines={terminalLines}
          runtimeConfig={runtimeConfig}
          selectedCommand={selectedCommand}
          commandText={commandText}
          running={commandRunning}
          onSelectedCommandChange={setSelectedCommand}
          onCommandTextChange={setCommandText}
          onRunCommand={runSelectedCommand}
        />
      </section>
      <div className="status-bar" data-testid="status-bar">
        <span>{connectionState}</span>
        <span>Room {roomId || "..."}</span>
        <span>{member?.displayName ?? "Joining"}</span>
        <span>{workspaceName || "Workspace"}</span>
      </div>
    </main>
  );
}

function terminalLinesFromEvents(events: EventRecord[]) {
  return events.flatMap((event) => {
    if (event.type !== "command_output") return [];
    const payload = event.payload as { output?: unknown } | undefined;
    return [String(payload?.output ?? "")];
  });
}

function getUserId(displayName: string) {
  const key = `simplercp.userId.${displayName.toLowerCase()}`;
  const existing = window.localStorage.getItem(key);
  if (existing) return existing;
  const next = window.crypto.randomUUID();
  window.localStorage.setItem(key, next);
  return next;
}

function getConnectionId() {
  const existing = window.sessionStorage.getItem("simplercp.connectionId");
  if (existing) return existing;
  const next = window.crypto.randomUUID();
  window.sessionStorage.setItem("simplercp.connectionId", next);
  return next;
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}
