import { MessagesSquare, Moon, PanelBottom, PanelRight, Sun } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  createWorkspaceDirectory,
  createWorkspaceFile,
  deleteWorkspacePath,
  getChatMessages,
  getEvents,
  getProject,
  getRoom,
  getWorkspaceDirectory,
  joinRoom,
  readWorkspaceFile,
  renameWorkspacePath,
  sendChatMessage,
  sendConnectionOffline
} from "./api";
import { CollaborationPanel } from "./components/CollaborationPanel";
import { EditorArea, type OpenFile } from "./components/EditorArea";
import { JoinProject, type ProjectIdentity } from "./components/JoinProject";
import { ProjectHome } from "./components/ProjectHome";
import { TerminalPanel } from "./components/TerminalPanel";
import { WorkspaceExplorer } from "./components/WorkspaceExplorer";
import {
  WorkspaceDialog,
  type WorkspaceDialogAction
} from "./components/WorkspaceDialog";
import { mergeFileEditChanges } from "./editActivity";
import {
  connectRoomSocket,
  type ClientSocket,
  type ConnectionState
} from "./socket";
import {
  applyTheme,
  THEME_STORAGE_KEY,
  type ThemeMode
} from "./theme";
import type {
  ChatMessage,
  CursorPosition,
  EditorSelection,
  EventRecord,
  FileEditActivity,
  FileEditChange,
  RemoteCursor,
  RoomMember,
  ProjectRecord,
  WorkspaceChange,
  WorkspaceNode
} from "./types";

interface PendingFileEdit extends FileEditActivity {
  timer: number;
}

const WORKSPACE_NOTICE_DURATION_MS = 4_000;

export function App({ initialTheme }: { initialTheme: ThemeMode }) {
  const [theme, setTheme] = useState(initialTheme);
  const projectMatch = window.location.pathname.match(/^\/projects\/([^/]+)\/?$/);

  function toggleTheme() {
    const nextTheme = theme === "dark" ? "light" : "dark";
    applyTheme(nextTheme);
    window.localStorage.setItem(THEME_STORAGE_KEY, nextTheme);
    setTheme(nextTheme);
  }

  if (!projectMatch) {
    return <ProjectHome theme={theme} onToggleTheme={toggleTheme} />;
  }

  return (
    <ProjectRoute
      projectId={decodeURIComponent(projectMatch[1] ?? "")}
      theme={theme}
      onToggleTheme={toggleTheme}
    />
  );
}

function ProjectRoute({
  projectId,
  theme,
  onToggleTheme
}: {
  projectId: string;
  theme: ThemeMode;
  onToggleTheme(): void;
}) {
  const [project, setProject] = useState<ProjectRecord>();
  const [roomId, setRoomId] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [loadAttempt, setLoadAttempt] = useState(0);
  const params = new URLSearchParams(window.location.search);
  const queryName = params.get("name")?.trim();
  const [identity, setIdentity] = useState<ProjectIdentity | undefined>(
    queryName
      ? { displayName: queryName, role: params.get("role")?.trim() ?? "" }
      : undefined
  );

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    void getProject(projectId)
      .then((result) => {
        if (!active) return;
        setProject(result.project);
        setRoomId(result.roomId);
      })
      .catch((nextError) => {
        if (!active) return;
        setError(
          nextError instanceof Error ? nextError.message : "Project loading failed"
        );
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [loadAttempt, projectId]);

  if (loading) {
    return <main className="route-loading">Loading project</main>;
  }
  if (error || !project || !roomId) {
    return (
      <main className="route-error" data-testid="route-error">
        <h1>Unable to open project</h1>
        <p>{error || "Project not found"}</p>
        <div>
          <a href="/" data-testid="route-error-projects">Projects</a>
          <button
            type="button"
            onClick={() => setLoadAttempt((attempt) => attempt + 1)}
            data-testid="route-error-retry"
          >
            Retry
          </button>
        </div>
      </main>
    );
  }
  if (!identity) {
    return <JoinProject projectName={project.name} onJoin={setIdentity} />;
  }
  return (
    <WorkspacePage
      project={project}
      roomId={roomId}
      identity={identity}
      theme={theme}
      onToggleTheme={onToggleTheme}
    />
  );
}

function WorkspacePage({
  project,
  roomId,
  identity,
  theme,
  onToggleTheme
}: {
  project: ProjectRecord;
  roomId: string;
  identity: ProjectIdentity;
  theme: ThemeMode;
  onToggleTheme(): void;
}) {
  const projectId = project.id;
  const displayName = identity.displayName;
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
  const [chatText, setChatText] = useState("");
  const [chatSending, setChatSending] = useState(false);
  const [connectionState, setConnectionState] =
    useState<ConnectionState>("Connecting");
  const [followingMemberId, setFollowingMemberId] = useState<string>();
  const [workspaceDialog, setWorkspaceDialog] =
    useState<WorkspaceDialogAction>();
  const [workspaceNotice, setWorkspaceNotice] = useState("");
  const [workspaceError, setWorkspaceError] = useState("");
  const [agentRefreshVersion, setAgentRefreshVersion] = useState(0);
  const [saveState, setSaveState] = useState<"Saved" | "Saving" | "Sync failed">(
    "Saved"
  );
  const [collaborationVisible, setCollaborationVisible] = useState(true);
  const [terminalVisible, setTerminalVisible] = useState(true);
  const socketRef = useRef<ClientSocket | null>(null);
  const membersRef = useRef<RoomMember[]>([]);
  const connectionRef = useRef<{ roomId: string; connectionId: string } | null>(
    null
  );
  const bootStartedRef = useRef(false);
  const pendingFileEditsRef = useRef(new Map<string, PendingFileEdit>());
  const pendingSavePathsRef = useRef(new Set<string>());
  const projectDeletedRef = useRef(false);
  const loadedDirectoriesRef = useRef(new Set<string>());
  const workspaceRefreshTimerRef = useRef<number>();
  const agentRefreshTimerRef = useRef<number>();
  const remoteCursors = useMemo(
    () => Object.values(remoteCursorMap),
    [remoteCursorMap]
  );

  useEffect(() => {
    if (bootStartedRef.current) return;
    bootStartedRef.current = true;
    let mounted = true;

    async function boot() {
      const userId = getUserId(displayName);
      const connectionId = getConnectionId();
      const joined = await joinRoom(
        projectId,
        displayName,
        identity.role,
        userId,
        connectionId
      );
      const [room, workspaceTree, eventRecords, messages] =
        await Promise.all([
          getRoom(projectId),
          getWorkspaceDirectory(projectId, ""),
          getEvents(projectId),
          getChatMessages(projectId)
        ]);

      if (!mounted) return;
      membersRef.current = room.members;
      setMember(joined);
      setMembers(room.members);
      setTree(workspaceTree);
      setEvents(eventRecords);
      setChatMessages(messages);

      const connected = connectRoomSocket({
        projectId,
        roomId,
        memberId: joined.id,
        connectionId,
        onStateChange(state) {
          setConnectionState(state);
          if (state !== "Connected" && pendingSavePathsRef.current.size > 0) {
            setSaveState("Sync failed");
          }
          if (state === "Connected") {
            setWorkspaceError("");
            void refreshSharedState().catch(showWorkspaceError);
            void refreshWorkspaceTree().catch(showWorkspaceError);
          }
        },
        onProjectDeleted() {
          projectDeletedRef.current = true;
          setWorkspaceError("This project was deleted.");
        },
        onMessage(message) {
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
            void refreshSharedState().catch(showWorkspaceError);
          }
          if (message.type === "workspace_changed") {
            applyWorkspaceChange(message.change);
            scheduleWorkspaceRefresh();
          }
          if (message.type === "file_saved") {
            pendingSavePathsRef.current.delete(message.path);
            if (pendingSavePathsRef.current.size === 0) setSaveState("Saved");
          }
          if (
            message.type === "agent_run_updated" ||
            message.type === "agent_trace_appended"
          ) {
            scheduleAgentRefresh();
          }
        }
      });
      connectionRef.current = { roomId, connectionId };
      socketRef.current = connected;
      connected.sendReady();
    }

    void boot().catch(showWorkspaceError);
    return () => {
      mounted = false;
      flushAllFileEdits();
      const connection = connectionRef.current;
      if (connection) {
        sendConnectionOffline(projectId, connection.connectionId);
      }
      socketRef.current?.close();
      if (workspaceRefreshTimerRef.current) {
        window.clearTimeout(workspaceRefreshTimerRef.current);
      }
      if (agentRefreshTimerRef.current) {
        window.clearTimeout(agentRefreshTimerRef.current);
      }
    };
  }, [displayName, identity.role, projectId, roomId]);

  useEffect(() => {
    function markOffline() {
      flushAllFileEdits();
      const connection = connectionRef.current;
      if (connection) {
        sendConnectionOffline(projectId, connection.connectionId);
      }
    }
    window.addEventListener("pagehide", markOffline);
    return () => window.removeEventListener("pagehide", markOffline);
  }, [projectId]);

  useEffect(() => {
    if (!roomId) return;
    const timer = window.setInterval(() => {
      void refreshSharedState().catch(showWorkspaceError);
    }, 1500);
    return () => window.clearInterval(timer);
  }, [roomId]);

  useEffect(() => {
    if (!workspaceNotice) return;
    const timer = window.setTimeout(
      () => setWorkspaceNotice(""),
      WORKSPACE_NOTICE_DURATION_MS
    );
    return () => window.clearTimeout(timer);
  }, [workspaceNotice]);

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

  async function refreshSharedState() {
    const [room, eventRecords, messages] = await Promise.all([
      getRoom(projectId),
      getEvents(projectId),
      getChatMessages(projectId)
    ]);
    membersRef.current = room.members;
    setMembers(room.members);
    setEvents(eventRecords);
    setChatMessages(messages);
  }

  async function refreshEvents() {
    setEvents(await getEvents(projectId));
  }

  function showWorkspaceError(error: unknown) {
    if (projectDeletedRef.current) return;
    setWorkspaceError(
      error instanceof Error ? error.message : "Workspace request failed"
    );
  }

  function applyWorkspaceChange(change: WorkspaceChange) {
    if (change.type === "rename") {
      remapOpenPath(change.fromPath, change.path);
      setWorkspaceNotice(`${change.fromPath} was renamed to ${change.path}`);
      return;
    }
    if (change.type === "unlink" || change.type === "unlinkDir") {
      closePath(change.path, false);
      pendingSavePathsRef.current.delete(change.path);
      if (pendingSavePathsRef.current.size === 0) setSaveState("Saved");
      setWorkspaceNotice(`${change.path} was deleted`);
    }
  }

  async function loadDirectory(path: string) {
    loadedDirectoriesRef.current.add(path);
    const children = await getWorkspaceDirectory(projectId, path);
    setTree((nodes) => setDirectoryChildren(nodes, path, children));
  }

  async function refreshWorkspaceTree() {
    const paths = ["", ...loadedDirectoriesRef.current];
    const entries = await Promise.all(
      paths.map(async (path) => [path, await getWorkspaceDirectory(projectId, path)] as const)
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
      void refreshWorkspaceTree().catch(showWorkspaceError);
    }, 150);
  }

  function scheduleAgentRefresh() {
    if (agentRefreshTimerRef.current) {
      window.clearTimeout(agentRefreshTimerRef.current);
    }
    agentRefreshTimerRef.current = window.setTimeout(() => {
      agentRefreshTimerRef.current = undefined;
      setAgentRefreshVersion((version) => version + 1);
    }, 150);
  }

  async function openFile(path: string) {
    if (activePath && activePath !== path) flushFileEdit(activePath);
    if (!openFiles.some((file) => file.path === path)) {
      let result = await readWorkspaceFile(projectId, path);
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
        result = await readWorkspaceFile(projectId, path, true);
      }
      if (result.status !== "text") return;
      setOpenFiles((files) =>
        files.some((file) => file.path === path)
          ? files
          : [...files, { path, content: result.content }]
      );
    }
    setActivePath(path);
    socketRef.current?.sendOpenFile(path);
    await refreshEvents();
  }

  function selectFile(path: string) {
    if (activePath && activePath !== path) flushFileEdit(activePath);
    setActivePath(path);
    socketRef.current?.sendOpenFile(path);
  }

  function reportFileEdit(path: string, change: FileEditChange) {
    pendingSavePathsRef.current.add(path);
    setSaveState("Saving");
    const timestamp = new Date().toISOString();
    const existing = pendingFileEditsRef.current.get(path);
    if (existing) window.clearTimeout(existing.timer);
    const merged = existing
      ? mergeFileEditChanges(existing, change)
      : change;
    const pending: PendingFileEdit = {
      ...merged,
      startedAt: existing?.startedAt ?? timestamp,
      finishedAt: timestamp,
      timer: window.setTimeout(() => flushFileEdit(path), 2_000)
    };
    pendingFileEditsRef.current.set(path, pending);
  }

  function flushFileEdit(path: string) {
    const pending = pendingFileEditsRef.current.get(path);
    if (!pending) return;
    window.clearTimeout(pending.timer);
    pendingFileEditsRef.current.delete(path);
    socketRef.current?.sendFileEdited(path, {
      ranges: pending.ranges,
      addedLines: pending.addedLines,
      removedLines: pending.removedLines,
      startedAt: pending.startedAt,
      finishedAt: pending.finishedAt
    });
  }

  function flushAllFileEdits() {
    for (const path of pendingFileEditsRef.current.keys()) {
      flushFileEdit(path);
    }
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
    if (!text || !member || !roomId || chatSending) return;
    setChatSending(true);
    setWorkspaceError("");
    try {
      await sendChatMessage(projectId, {
        authorId: member.id,
        authorName: member.displayName,
        text
      });
      socketRef.current?.sendChat(text);
      setChatText("");
      await refreshSharedState();
    } catch (error) {
      showWorkspaceError(error);
    } finally {
      setChatSending(false);
    }
  }

  async function submitWorkspaceDialog(path: string) {
    if (!workspaceDialog || !member) return;
    if (workspaceDialog.type === "create-file") {
      await createWorkspaceFile(projectId, path, member.id);
      addAncestorDirectories(loadedDirectoriesRef.current, path);
      await refreshWorkspaceTree();
      await openFile(path);
      return;
    }
    if (workspaceDialog.type === "create-folder") {
      await createWorkspaceDirectory(projectId, path, member.id);
      addAncestorDirectories(loadedDirectoriesRef.current, path);
      await refreshWorkspaceTree();
      await refreshEvents();
      return;
    }
    if (workspaceDialog.type === "rename") {
      if (path === workspaceDialog.path) return;
      flushAllFileEdits();
      await renameWorkspacePath(
        projectId,
        workspaceDialog.path,
        path,
        member.id
      );
      remapOpenPath(workspaceDialog.path, path);
      await refreshWorkspaceTree();
      await refreshEvents();
      return;
    }
    flushAllFileEdits();
    await deleteWorkspacePath(projectId, workspaceDialog.path, member.id);
    loadedDirectoriesRef.current = new Set(
      [...loadedDirectoriesRef.current].filter(
        (directory) =>
          directory !== workspaceDialog.path &&
          !directory.startsWith(`${workspaceDialog.path}/`)
      )
    );
    closePath(workspaceDialog.path);
    await refreshWorkspaceTree();
    await refreshEvents();
  }

  function followMember(memberId: string) {
    setFollowingMemberId((current) =>
      current === memberId ? undefined : memberId
    );
  }

  function remapOpenPath(fromPath: string, toPath: string) {
    loadedDirectoriesRef.current = remapLoadedDirectories(
      loadedDirectoriesRef.current,
      fromPath,
      toPath
    );
    addAncestorDirectories(loadedDirectoriesRef.current, toPath);
    setOpenFiles((files) =>
      files.map((file) =>
        file.path === fromPath || file.path.startsWith(`${fromPath}/`)
          ? { ...file, path: `${toPath}${file.path.slice(fromPath.length)}` }
          : file
      )
    );
    setActivePath((current) => {
      if (current !== fromPath && !current?.startsWith(`${fromPath}/`)) {
        return current;
      }
      const nextPath = `${toPath}${current.slice(fromPath.length)}`;
      socketRef.current?.sendOpenFile(nextPath);
      return nextPath;
    });
  }

  function closePath(path: string, flush = true) {
    for (const pendingPath of pendingFileEditsRef.current.keys()) {
      if (pendingPath === path || pendingPath.startsWith(`${path}/`)) {
        if (flush) flushFileEdit(pendingPath);
        else pendingFileEditsRef.current.delete(pendingPath);
      }
    }
    setOpenFiles((files) => {
      const remaining = files.filter(
        (file) => file.path !== path && !file.path.startsWith(`${path}/`)
      );
      setActivePath((current) => {
        if (current !== path && !current?.startsWith(`${path}/`)) return current;
        const nextPath = remaining.at(-1)?.path;
        if (nextPath) socketRef.current?.sendOpenFile(nextPath);
        return nextPath;
      });
      return remaining;
    });
  }

  function closeFile(path: string) {
    const index = openFiles.findIndex((file) => file.path === path);
    if (index < 0) return;
    flushFileEdit(path);
    const remaining = openFiles.filter((file) => file.path !== path);
    setOpenFiles(remaining);

    if (activePath === path) {
      const next = remaining[Math.min(index, remaining.length - 1)];
      setActivePath(next?.path);
      if (next) socketRef.current?.sendOpenFile(next.path);
    }
  }

  return (
    <main
      className={`app-shell${collaborationVisible ? "" : " collaboration-hidden"}${terminalVisible ? "" : " terminal-hidden"}`}
    >
      {workspaceError ? (
        <div className="workspace-alert" role="alert" data-testid="workspace-error">
          <span>{workspaceError}</span>
          {workspaceError === "This project was deleted." ? (
            <a href="/">Projects</a>
          ) : (
            <button type="button" onClick={() => window.location.reload()}>
              Retry
            </button>
          )}
          <button
            type="button"
            aria-label="Dismiss error"
            onClick={() => setWorkspaceError("")}
          >
            ×
          </button>
        </div>
      ) : null}
      {workspaceNotice ? (
        <div className="workspace-notice" data-testid="workspace-notice">
          <span>{workspaceNotice}</span>
          <button
            type="button"
            aria-label="Dismiss notification"
            onClick={() => setWorkspaceNotice("")}
          >
            ×
          </button>
        </div>
      ) : null}
      <aside className="workspace-pane">
        <WorkspaceExplorer
          tree={tree}
          activePath={activePath}
          workspaceName={project.name}
          canManageFiles={Boolean(member)}
          onOpenFile={(path) => void openFile(path).catch(showWorkspaceError)}
          onExpandDirectory={(path) =>
            void loadDirectory(path).catch(showWorkspaceError)
          }
          onCreateFile={() =>
            setWorkspaceDialog({
              type: "create-file",
              initialPath: activeDirectoryPrefix(activePath)
            })
          }
          onCreateFolder={() =>
            setWorkspaceDialog({
              type: "create-folder",
              initialPath: activeDirectoryPrefix(activePath)
            })
          }
          onRenamePath={(path) => setWorkspaceDialog({ type: "rename", path })}
          onDeletePath={(path) => setWorkspaceDialog({ type: "delete", path })}
        />
      </aside>
      <section className="editor-pane">
        <EditorArea
          openFiles={openFiles}
          activePath={activePath}
          projectId={projectId}
          roomId={roomId}
          memberId={member?.id ?? ""}
          canEdit={Boolean(member)}
          theme={theme}
          remoteCursors={remoteCursors}
          saveState={saveState}
          onSelectFile={selectFile}
          onCloseFile={closeFile}
          onLocalEdit={reportFileEdit}
          onCursorChange={changeCursor}
        />
      </section>
      <aside className="collab-pane" hidden={!collaborationVisible}>
        <CollaborationPanel
          members={members}
          events={events}
          chatMessages={chatMessages}
          remoteCursors={remoteCursors}
          chatText={chatText}
          chatSending={chatSending}
          onChatTextChange={setChatText}
          onSendChat={sendChat}
          member={member}
          projectId={projectId}
          workspaceRoot={project.workspacePath}
          workspaceTree={tree}
          roomId={roomId}
          agentRefreshVersion={agentRefreshVersion}
          followingMemberId={followingMemberId}
          onFollowMember={followMember}
          onOpenFile={(path) => void openFile(path).catch(showWorkspaceError)}
          onError={showWorkspaceError}
        />
      </aside>
      <section className="terminal-pane" hidden={!terminalVisible}>
        <TerminalPanel
          projectId={projectId}
          theme={theme}
          canRun={Boolean(member)}
          memberId={member?.id ?? ""}
        />
      </section>
      <div className="status-bar" data-testid="status-bar">
        <span data-testid="connection-state">{connectionState}</span>
        {connectionState === "Offline" && workspaceError !== "This project was deleted." ? (
          <button
            className="connection-retry"
            type="button"
            onClick={() => socketRef.current?.retry()}
          >
            Reconnect
          </button>
        ) : null}
        <span>Room {roomId || "..."}</span>
        <span>{member?.displayName ?? "Joining"}</span>
        <span>{project.name}</span>
        {followingMemberId ? (
          <span>
            Following {members.find((candidate) => candidate.id === followingMemberId)?.displayName ?? "collaborator"}
          </span>
        ) : null}
        <button
          className="status-tool"
          type="button"
          onClick={() => setTerminalVisible((visible) => !visible)}
          aria-label={`${terminalVisible ? "Hide" : "Show"} terminal`}
          title={`${terminalVisible ? "Hide" : "Show"} terminal`}
          data-testid="toggle-terminal"
        >
          <PanelBottom size={14} />
        </button>
        <button
          className="status-tool"
          type="button"
          onClick={() => setCollaborationVisible((visible) => !visible)}
          aria-label={`${collaborationVisible ? "Hide" : "Show"} collaboration`}
          title={`${collaborationVisible ? "Hide" : "Show"} collaboration`}
          data-testid="toggle-collaboration"
        >
          {collaborationVisible ? (
            <PanelRight size={14} />
          ) : (
            <MessagesSquare size={14} />
          )}
        </button>
        <button
          className="theme-toggle"
          type="button"
          onClick={onToggleTheme}
          aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
          title={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
          data-testid="theme-toggle"
        >
          {theme === "dark" ? <Sun size={14} /> : <Moon size={14} />}
        </button>
      </div>
      {workspaceDialog ? (
        <WorkspaceDialog
          action={workspaceDialog}
          onClose={() => setWorkspaceDialog(undefined)}
          onSubmit={submitWorkspaceDialog}
        />
      ) : null}
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

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

function activeDirectoryPrefix(path: string | undefined) {
  if (!path?.includes("/")) return "";
  return `${path.slice(0, path.lastIndexOf("/") + 1)}`;
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
