import { useEffect, useMemo, useRef, useState } from "react";
import {
  claimHost,
  createWorkspaceDirectory,
  createWorkspaceFile,
  deleteWorkspacePath,
  getChatMessages,
  getEvents,
  getHealth,
  getRoom,
  getSessionSettings,
  getWorkspaceDirectory,
  getWorkspaceTree,
  joinRoom,
  readWorkspaceFile,
  renameWorkspacePath,
  runQuickCommand,
  sendChatMessage,
  sendConnectionOffline,
  updateSessionSettings
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
  SessionSettings,
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
  const [sessionSettings, setSessionSettings] = useState<SessionSettings>({
    terminalEnabled: true,
    commandMode: "restricted",
    commands: [],
    commandTimeoutMs: 30_000,
    guestCanEditFiles: true,
    guestCanManageFiles: true,
    guestCanRunCommands: true
  });
  const [chatText, setChatText] = useState("");
  const [selectedCommand, setSelectedCommand] = useState("");
  const [commandText, setCommandText] = useState("");
  const [workspaceName, setWorkspaceName] = useState("");
  const [workspaceRoot, setWorkspaceRoot] = useState("");
  const [commandRunning, setCommandRunning] = useState(false);
  const [connectionState, setConnectionState] = useState("Connecting");
  const [followingMemberId, setFollowingMemberId] = useState<string>();
  const socketRef = useRef<ClientSocket | null>(null);
  const membersRef = useRef<RoomMember[]>([]);
  const connectionRef = useRef<{ roomId: string; connectionId: string } | null>(
    null
  );
  const bootStartedRef = useRef(false);
  const editTimersRef = useRef(new Map<string, number>());
  const loadedDirectoriesRef = useRef(new Set<string>());
  const workspaceRefreshTimerRef = useRef<number>();
  const hostSessionRef = useRef<string>();

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
      const hostSession = await resolveHostSession();
      hostSessionRef.current = hostSession;
      const health = await getHealth();
      const userId = getUserId(displayName);
      const connectionId = getConnectionId();
      const joined = await joinRoom(
        health.roomId,
        displayName,
        userId,
        connectionId,
        hostSession
      );
      const [room, workspaceTree, eventRecords, sessionInfo, messages] =
        await Promise.all([
          getRoom(health.roomId),
          getWorkspaceTree(),
          getEvents(),
          getSessionSettings(),
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
      setSessionSettings(sessionInfo.settings);
      setWorkspaceRoot(sessionInfo.workspaceRoot);
      setChatMessages(messages);
      setSelectedCommand(sessionInfo.settings.commands[0] ?? "");
      setCommandText(sessionInfo.settings.commands[0] ?? "");

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
          if (message.type === "workspace_changed") {
            scheduleWorkspaceRefresh();
          }
          if (message.type === "session_settings_changed") {
            setSessionSettings(message.settings);
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
      if (workspaceRefreshTimerRef.current) {
        window.clearTimeout(workspaceRefreshTimerRef.current);
      }
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

  useEffect(() => {
    if (!sessionSettings.commands.includes(selectedCommand)) {
      setSelectedCommand(sessionSettings.commands[0] ?? "");
    }
  }, [selectedCommand, sessionSettings.commands]);

  useEffect(() => {
    if (!followingMemberId) return;
    const cursor = remoteCursorMap[followingMemberId];
    const collaborator = members.find(
      (candidate) => candidate.id === followingMemberId
    );
    const path = cursor?.path ?? collaborator?.currentFile;
    if (!path) return;
    if (path !== activePath) {
      void openFile(path);
      return;
    }
    if (cursor) {
      window.requestAnimationFrame(() => {
        window.__simplercpEditors?.[path]?.revealPositionInCenter(
          cursor.position
        );
      });
    }
  }, [activePath, followingMemberId, members, remoteCursorMap]);

  async function refreshSharedState(targetRoomId: string) {
    const [room, eventRecords, messages] = await Promise.all([
      getRoom(targetRoomId),
      getEvents(),
      getChatMessages(targetRoomId)
    ]);
    membersRef.current = room.members;
    setMembers(room.members);
    setEvents(eventRecords);
    setChatMessages(messages);
  }

  async function refreshEvents() {
    setEvents(await getEvents());
  }

  async function loadDirectory(path: string) {
    loadedDirectoriesRef.current.add(path);
    const children = await getWorkspaceDirectory(path);
    setTree((nodes) => setDirectoryChildren(nodes, path, children));
  }

  async function refreshWorkspaceTree() {
    const paths = ["", ...loadedDirectoriesRef.current];
    const entries = await Promise.all(
      paths.map(async (path) => [path, await getWorkspaceDirectory(path)] as const)
    );
    const directories = new Map(entries);
    setTree(composeWorkspaceTree(directories.get("") ?? [], directories));
  }

  function scheduleWorkspaceRefresh() {
    if (workspaceRefreshTimerRef.current) {
      window.clearTimeout(workspaceRefreshTimerRef.current);
    }
    workspaceRefreshTimerRef.current = window.setTimeout(() => {
      workspaceRefreshTimerRef.current = undefined;
      void refreshWorkspaceTree();
    }, 150);
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
    await createWorkspaceFile(path, member.id);
    addAncestorDirectories(loadedDirectoriesRef.current, path);
    await refreshWorkspaceTree();
    await openFile(path);
  }

  async function createFolderFromPrompt() {
    const path = window.prompt("New folder path");
    if (!path || !member) return;
    await createWorkspaceDirectory(path, member.id);
    addAncestorDirectories(loadedDirectoriesRef.current, path);
    await refreshWorkspaceTree();
    await refreshEvents();
  }

  async function renamePathFromPrompt(path: string) {
    const toPath = window.prompt("Rename path", path);
    if (!toPath || toPath === path || !member) return;
    await renameWorkspacePath(path, toPath, member.id);
    loadedDirectoriesRef.current = remapLoadedDirectories(
      loadedDirectoriesRef.current,
      path,
      toPath
    );
    addAncestorDirectories(loadedDirectoriesRef.current, toPath);
    setOpenFiles((files) =>
      files.map((file) =>
        file.path === path || file.path.startsWith(`${path}/`)
          ? { ...file, path: `${toPath}${file.path.slice(path.length)}` }
          : file
      )
    );
    if (activePath === path || activePath?.startsWith(`${path}/`)) {
      const nextPath = `${toPath}${activePath.slice(path.length)}`;
      setActivePath(nextPath);
      socketRef.current?.sendOpenFile(nextPath);
    }
    await refreshWorkspaceTree();
    await refreshEvents();
  }

  async function deletePathWithConfirm(path: string) {
    if (!window.confirm(`Delete ${path}?`) || !member) return;
    await deleteWorkspacePath(path, member.id);
    loadedDirectoriesRef.current = new Set(
      [...loadedDirectoriesRef.current].filter(
        (directory) =>
          directory !== path && !directory.startsWith(`${path}/`)
      )
    );
    closePath(path);
    await refreshWorkspaceTree();
    await refreshEvents();
  }

  async function runSelectedCommand() {
    const command =
      sessionSettings.commandMode === "unrestricted"
        ? commandText.trim()
        : selectedCommand;
    if (!member || !command || !roomId) return;
    setCommandRunning(true);
    try {
      await runQuickCommand(command, member.id);
      await refreshSharedState(roomId);
    } finally {
      setCommandRunning(false);
    }
  }

  async function changeSessionSettings(settings: SessionSettings) {
    if (!member || member.role !== "host" || !hostSessionRef.current) return;
    const response = await updateSessionSettings(
      settings,
      member.id,
      hostSessionRef.current
    );
    setSessionSettings(response.settings);
  }

  function followMember(memberId: string) {
    setFollowingMemberId((current) =>
      current === memberId ? undefined : memberId
    );
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
          canManageFiles={
            member?.role === "host" || sessionSettings.guestCanManageFiles
          }
          onOpenFile={openFile}
          onExpandDirectory={loadDirectory}
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
          memberId={member?.id ?? ""}
          canEdit={
            member?.role === "host" || sessionSettings.guestCanEditFiles
          }
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
          member={member}
          settings={sessionSettings}
          workspaceRoot={workspaceRoot}
          roomId={roomId}
          onSettingsChange={changeSessionSettings}
          followingMemberId={followingMemberId}
          onFollowMember={followMember}
        />
      </aside>
      <section className="terminal-pane">
        <TerminalPanel
          runtimeConfig={sessionSettings}
          canRun={
            sessionSettings.terminalEnabled &&
            (member?.role === "host" || sessionSettings.guestCanRunCommands)
          }
          memberId={member?.id ?? ""}
          isHost={member?.role === "host"}
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
        {followingMemberId ? (
          <span>
            Following {members.find((candidate) => candidate.id === followingMemberId)?.displayName ?? "collaborator"}
          </span>
        ) : null}
      </div>
    </main>
  );
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

async function resolveHostSession() {
  const storageKey = "simplercp.hostSession";
  const params = new URLSearchParams(window.location.search);
  const accessToken = params.get("hostToken");
  if (!accessToken) {
    return window.sessionStorage.getItem(storageKey) ?? undefined;
  }

  params.delete("hostToken");
  const query = params.toString();
  window.history.replaceState(
    {},
    "",
    `${window.location.pathname}${query ? `?${query}` : ""}`
  );
  try {
    const { sessionToken } = await claimHost(accessToken);
    window.sessionStorage.setItem(storageKey, sessionToken);
    return sessionToken;
  } catch {
    window.sessionStorage.removeItem(storageKey);
    window.alert("This Host link is invalid or has expired.");
    return undefined;
  }
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

function setDirectoryChildren(
  nodes: WorkspaceNode[],
  path: string,
  children: WorkspaceNode[]
): WorkspaceNode[] {
  if (!path) return children;
  return nodes.map((node) => {
    if (node.type !== "directory") return node;
    if (node.path === path) return { ...node, children };
    if (!node.children) return node;
    return {
      ...node,
      children: setDirectoryChildren(node.children, path, children)
    };
  });
}

function composeWorkspaceTree(
  nodes: WorkspaceNode[],
  directories: Map<string, WorkspaceNode[]>
): WorkspaceNode[] {
  return nodes.map((node) => {
    if (node.type !== "directory") return node;
    const children = directories.get(node.path);
    return children
      ? { ...node, children: composeWorkspaceTree(children, directories) }
      : node;
  });
}

function addAncestorDirectories(directories: Set<string>, path: string) {
  const parts = path.split("/");
  for (let index = 1; index < parts.length; index += 1) {
    directories.add(parts.slice(0, index).join("/"));
  }
}

function remapLoadedDirectories(
  directories: Set<string>,
  fromPath: string,
  toPath: string
) {
  return new Set(
    [...directories].map((directory) =>
      directory === fromPath || directory.startsWith(`${fromPath}/`)
        ? `${toPath}${directory.slice(fromPath.length)}`
        : directory
    )
  );
}
