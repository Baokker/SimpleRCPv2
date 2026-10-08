import { MessagesSquare, Moon, PanelBottom, PanelRight, Sun } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react";
import {
  createWorkspaceDirectory,
  createWorkspaceFile,
  createTeamAgent,
  cancelAgentRun,
  deleteWorkspacePath,
  getChatMessages,
  getEvents,
  getRoom,
  getAgentTrace,
  getAgentRuns,
  getTeamAgents,
  getWorkspaceDirectory,
  joinRoom,
  readWorkspaceFile,
  renameWorkspacePath,
  sendChatMessage,
  sendConnectionOffline,
  getKnowledgeCards,
  getKnowledgeGuide,
  getKnowledgeTimeline,
  createKnowledgeCard,
  generateKnowledgeDemo,
  updateKnowledgeCard,
  confirmKnowledgeCard,
  archiveKnowledgeCard,
  reanchorKnowledgeCard,
  getKnowledgeInbox,
  getPendingKnowledgeTeamCards,
  markKnowledgeWarningsRead
} from "./api";
import { pendingKnowledgeSeen } from "./knowledgePresentation";
import { CollaborationPanel } from "./components/CollaborationPanel";
import { EditorArea, type OpenFile } from "./components/EditorArea";
import {
  JoinProject,
  type ProjectIdentity
} from "./components/JoinProject";
import { ProjectHome } from "./components/ProjectHome";
import { TerminalPanel } from "./components/TerminalPanel";
import { WorkspaceExplorer } from "./components/WorkspaceExplorer";
import {
  WorkspaceDialog,
  type WorkspaceDialogAction
} from "./components/WorkspaceDialog";
import { mergeFileEditChanges } from "./editActivity";
import { useProjectRoute } from "./hooks/useProjectRoute";
import { useWorkspaceNotifications } from "./hooks/useWorkspaceNotifications";
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
import {
  activeDirectoryPrefix,
  addAncestorDirectories,
  composeWorkspaceTree,
  remapLoadedDirectories,
  setDirectoryChildren
} from "./workspaceTree";
import type {
  AgentRun,
  AgentSession,
  AgentTraceEvent,
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
  WorkspaceNode,
  KnowledgeAnchorResolution,
  KnowledgeCard,
  KnowledgeGuideItem,
  KnowledgeTimelineItem
} from "./types";

type ResizeTarget = "workspace" | "collaboration" | "terminal";

const WORKSPACE_WIDTH_KEY = "simplercp.layout.workspaceWidth";
const COLLABORATION_WIDTH_KEY = "simplercp.layout.collaborationWidth";
const TERMINAL_HEIGHT_KEY = "simplercp.layout.terminalHeight";

interface PendingFileEdit extends FileEditActivity {
  timer: number;
}

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
  const {
    project,
    roomId,
    participants,
    terminalEnabled,
    knowledgeEnabled,
    identity,
    loading,
    error,
    setIdentity,
    retry
  } = useProjectRoute(projectId);

  if (loading) {
    return <main className="route-loading">Loading project</main>;
  }
  if (error || !project || (identity && !roomId)) {
    return (
      <main className="route-error" data-testid="route-error">
        <h1>Unable to open project</h1>
        <p>{error || "Project not found"}</p>
        <div>
          <a href="/" data-testid="route-error-projects">Projects</a>
          <button
            type="button"
            onClick={retry}
            data-testid="route-error-retry"
          >
            Retry
          </button>
        </div>
      </main>
    );
  }
  if (!identity) {
    return (
      <JoinProject
        projectName={project.name}
        projectId={project.id}
        participants={participants}
        onJoin={setIdentity}
      />
    );
  }
  return (
    <WorkspacePage
      project={project}
      roomId={roomId}
      identity={identity}
      terminalEnabled={terminalEnabled}
      knowledgeEnabled={knowledgeEnabled}
      theme={theme}
      onToggleTheme={onToggleTheme}
    />
  );
}

function WorkspacePage({
  project,
  roomId,
  identity,
  terminalEnabled,
  knowledgeEnabled,
  theme,
  onToggleTheme
}: {
  project: ProjectRecord;
  roomId: string;
  identity: ProjectIdentity;
  terminalEnabled: boolean;
  knowledgeEnabled: boolean;
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
  const [teamAgents, setTeamAgents] = useState<AgentSession[]>([]);
  const [agentRuns, setAgentRuns] = useState<AgentRun[]>([]);
  const [agentTraces, setAgentTraces] = useState<Record<string, AgentTraceEvent[]>>({});
  const [knowledgeUpdateRuns, setKnowledgeUpdateRuns] = useState<Record<string, string[]>>({});
  const [knowledgeCards, setKnowledgeCards] = useState<KnowledgeCard[]>([]);
  const [knowledgeRefreshVersion, setKnowledgeRefreshVersion] = useState(0);
  const [knowledgeUnread, setKnowledgeUnread] = useState(0);
  const activeKnowledgeMemberIdRef = useRef<string>();
  const [knowledgeWarning, setKnowledgeWarning] = useState<{ cardId: string; file: string; warningId?: string }>();
  const [knowledgeResolutions, setKnowledgeResolutions] = useState<KnowledgeAnchorResolution[]>([]);
  const [knowledgeGuide, setKnowledgeGuide] = useState<KnowledgeGuideItem[]>([]);
  const [knowledgeTimeline, setKnowledgeTimeline] = useState<KnowledgeTimelineItem[]>([]);
  const [knowledgePinSelection, setKnowledgePinSelection] = useState<{ file: string; selection: { startLineNumber: number; startColumn: number; endLineNumber: number; endColumn: number } }>();
  const [knowledgeCurrentSelection, setKnowledgeCurrentSelection] = useState<{ file: string; selection: { startLineNumber: number; startColumn: number; endLineNumber: number; endColumn: number } }>();
  const activeKnowledgePathRef = useRef(activePath);
  activeKnowledgePathRef.current = activePath;
  const knowledgeRequestVersionRef = useRef(0);
  const loadedAgentTraceIdsRef = useRef(new Set<string>());
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
  const {
    workspaceNotice,
    workspaceError,
    showWorkspaceNotice,
    clearWorkspaceNotice,
    showWorkspaceError,
    clearWorkspaceError,
    showProjectDeleted,
    projectDeleted
  } = useWorkspaceNotifications();
  const [agentRefreshVersion, setAgentRefreshVersion] = useState(0);
  const [saveState, setSaveState] = useState<"Saved" | "Saving" | "Sync failed">(
    "Saved"
  );
  const [collaborationVisible, setCollaborationVisible] = useState(true);
  useEffect(() => {
    const openKnowledge = () => setCollaborationVisible(true);
    window.addEventListener("knowledge-open-card", openKnowledge);
    return () => window.removeEventListener("knowledge-open-card", openKnowledge);
  }, []);
  const [terminalVisible, setTerminalVisible] = useState(terminalEnabled);
  const [workspaceWidth, setWorkspaceWidth] = useState(() => readLayoutDimension(WORKSPACE_WIDTH_KEY, 252, 180, 420));
  const [collaborationWidth, setCollaborationWidth] = useState(() => readLayoutDimension(COLLABORATION_WIDTH_KEY, 380, 280, 560));
  const [terminalHeight, setTerminalHeight] = useState(() => readLayoutDimension(TERMINAL_HEIGHT_KEY, 188, 120, 460));
  const socketRef = useRef<ClientSocket | null>(null);
  const membersRef = useRef<RoomMember[]>([]);
  const connectionRef = useRef<{ roomId: string; connectionId: string } | null>(
    null
  );
  const bootStartedRef = useRef(false);
  const pendingFileEditsRef = useRef(new Map<string, PendingFileEdit>());
  const pendingSavePathsRef = useRef(new Set<string>());
  const loadedDirectoriesRef = useRef(new Set<string>());
  const workspaceRefreshTimerRef = useRef<number>();
  const agentRefreshTimerRef = useRef<number>();
  const knowledgeRefreshTimerRef = useRef<number>();
  const remoteCursors = useMemo(
    () => Object.values(remoteCursorMap),
    [remoteCursorMap]
  );

  useEffect(() => {
    if (bootStartedRef.current) return;
    bootStartedRef.current = true;
    let mounted = true;

    async function boot() {
      const connectionId = window.crypto.randomUUID();
      const joined = await joinRoom(
        projectId,
        displayName,
        identity.role,
        identity.memberId,
        connectionId
      );
      const [room, workspaceTree, eventRecords, messages, agents, runs] =
        await Promise.all([
          getRoom(projectId),
          getWorkspaceDirectory(projectId, ""),
          getEvents(projectId),
          getChatMessages(projectId),
          getTeamAgents(projectId),
          getAgentRuns(projectId)
        ]);
      const chatRunIds = messages.flatMap((message) => message.runId ? [message.runId] : []).slice(-20);
      const relevantRuns = runs.filter((run) => run.status === "queued" || run.status === "running" || chatRunIds.includes(run.id));
      const traceEntries = await fetchAgentTraces(projectId, relevantRuns);

      if (!mounted) return;
      membersRef.current = room.members;
      setMember(joined.member);
      activeKnowledgeMemberIdRef.current = joined.member.id;
      setMembers(room.members);
      setTree(workspaceTree);
      setEvents(eventRecords);
      setChatMessages(messages);
      setTeamAgents(agents);
      setAgentRuns(runs);
      setAgentTraces(traceEntries);
      for (const run of relevantRuns) loadedAgentTraceIdsRef.current.add(run.id);

      const connected = connectRoomSocket({
        projectId,
        roomId,
        memberId: joined.member.id,
        connectionId,
        onStateChange(state) {
          setConnectionState(state);
          if (state !== "Connected" && pendingSavePathsRef.current.size > 0) {
            setSaveState("Sync failed");
          }
          if (state === "Connected") {
            clearWorkspaceError();
            void refreshSharedState().catch(showWorkspaceError);
            void refreshWorkspaceTree().catch(showWorkspaceError);
            scheduleKnowledgeRefresh();
          }
        },
        onProjectDeleted() {
          showProjectDeleted();
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
          if (
            message.type === "cursor_change" &&
            message.memberId !== joined.member.id
          ) {
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
          if (message.type === "chat_message_created") {
            setChatMessages((current) => {
              const index = current.findIndex((item) => item.id === message.message.id);
              if (index < 0) return [...current, message.message];
              const next = [...current];
              next[index] = message.message;
              return next;
            });
          }
          if (message.type === "team_agents_changed") {
            setTeamAgents(message.agents);
          }
          if (message.type === "event") {
            setEvents((current) => current.some((event) => event.id === message.event.id)
              ? current
              : [...current, message.event]);
          }
          if (message.type === "workspace_changed") {
            applyWorkspaceChange(message.change);
            scheduleWorkspaceRefresh();
          }
          if (message.type === "file_saved") {
            pendingSavePathsRef.current.delete(message.path);
            if (pendingSavePathsRef.current.size === 0) setSaveState("Saved");
            if (knowledgeEnabled) scheduleKnowledgeRefresh();
          }
          if (message.type === "knowledge_changed") {
            scheduleKnowledgeRefresh();
          }
          if (message.type === "knowledge_suggestion") {
            setKnowledgeRefreshVersion(version => version + 1);
            scheduleKnowledgeRefresh();
            if (message.popup) showWorkspaceNotice("有新的知识建议，请查看待处理。");
          }
          if (message.type === "knowledge_risk_warning") {
            setKnowledgeRefreshVersion(version => version + 1);
            scheduleKnowledgeRefresh();
            if (message.popup) setKnowledgeWarning({ cardId: message.cardId, file: message.file, warningId: message.warningId });
          }
          if (message.type === "knowledge_anchor_needs_review") {
            setKnowledgeRefreshVersion(version => version + 1);
            showWorkspaceNotice(message.status === "orphaned" ? "知识卡片锚点已孤立，请重新锚定。" : "知识卡片锚点需要复核。");
          }
          if (message.type === "knowledge_update_available") {
            setKnowledgeRefreshVersion(version => version + 1);
            setKnowledgeUpdateRuns(current => ({
              ...current,
              [message.runId]: [...new Set([...(current[message.runId] ?? []), message.cardId])]
            }));
            showWorkspaceNotice("有新的知识卡片可供当前 Agent 任务参考。");
          }
          if (message.type === "agent_run_updated") {
            setAgentRuns((current) => {
              const index = current.findIndex((run) => run.id === message.run.id);
              if (index < 0) return [message.run, ...current];
              const next = [...current];
              next[index] = message.run;
              return next;
            });
            scheduleAgentRefresh();
          }
          if (message.type === "agent_trace_appended") {
            setAgentTraces((current) => ({
              ...current,
              [message.runId]: mergeTraceEvents(current[message.runId] ?? [], [message.event])
            }));
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
      knowledgeRequestVersionRef.current += 1;
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
      if (knowledgeRefreshTimerRef.current) {
        window.clearTimeout(knowledgeRefreshTimerRef.current);
      }
    };
  }, [displayName, identity.role, projectId, roomId]);

  useEffect(() => {
    window.localStorage.setItem(WORKSPACE_WIDTH_KEY, String(workspaceWidth));
  }, [workspaceWidth]);
  useEffect(() => {
    window.localStorage.setItem(COLLABORATION_WIDTH_KEY, String(collaborationWidth));
  }, [collaborationWidth]);
  useEffect(() => {
    window.localStorage.setItem(TERMINAL_HEIGHT_KEY, String(terminalHeight));
  }, [terminalHeight]);
  function startResize(target: ResizeTarget, event: ReactPointerEvent<HTMLDivElement>) {
    event.preventDefault();
    const startX = event.clientX;
    const startY = event.clientY;
    const initial = { workspaceWidth, collaborationWidth, terminalHeight };
    document.body.dataset.resizing = target;
    const move = (moveEvent: PointerEvent) => {
      if (target === "workspace") setWorkspaceWidth(clampLayoutDimension(initial.workspaceWidth + moveEvent.clientX - startX, 180, 420));
      if (target === "collaboration") setCollaborationWidth(clampLayoutDimension(initial.collaborationWidth - (moveEvent.clientX - startX), 280, 560));
      if (target === "terminal") setTerminalHeight(clampLayoutDimension(initial.terminalHeight - (moveEvent.clientY - startY), 120, 460));
    };
    const stop = () => {
      document.body.removeAttribute("data-resizing");
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop, { once: true });
  }

  const shellStyle = {
    "--workspace-pane-width": `${workspaceWidth}px`,
    "--collaboration-pane-width": `${collaborationWidth}px`,
    "--terminal-pane-height": `${terminalHeight}px`
  } as CSSProperties;

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
    if (!knowledgeEnabled || !member) {
      setKnowledgeCards([]);
      setKnowledgeResolutions([]);
      setKnowledgeGuide([]);
      setKnowledgeTimeline([]);
      setKnowledgeCurrentSelection(undefined);
      return;
    }
    setKnowledgeResolutions([]);
    setKnowledgeCurrentSelection(undefined);
    void refreshKnowledgeState().catch(showWorkspaceError);
  }, [activePath, knowledgeEnabled, member?.id]);

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
    const [room, eventRecords, messages, agents, runs] = await Promise.all([
      getRoom(projectId),
      getEvents(projectId),
      getChatMessages(projectId),
      getTeamAgents(projectId),
      getAgentRuns(projectId)
    ]);
    membersRef.current = room.members;
    setMembers(room.members);
    setEvents(eventRecords);
    setChatMessages(messages);
    setTeamAgents(agents);
    setAgentRuns(runs);
  }

  async function refreshAgentState() {
    const runs = await getAgentRuns(projectId);
    setAgentRuns(runs);
  }

  async function loadAgentTrace(runId: string) {
    if (loadedAgentTraceIdsRef.current.has(runId)) return;
    loadedAgentTraceIdsRef.current.add(runId);
    try {
      const events = await getAgentTrace(projectId, runId);
      setAgentTraces((current) => ({
        ...current,
        [runId]: mergeTraceEvents(current[runId] ?? [], events)
      }));
    } catch (error) {
      loadedAgentTraceIdsRef.current.delete(runId);
      throw error;
    }
  }

  async function refreshEvents() {
    setEvents(await getEvents(projectId));
  }

  function applyWorkspaceChange(change: WorkspaceChange) {
    if (change.type === "rename") {
      remapOpenPath(change.fromPath, change.path);
      showWorkspaceNotice(`${change.fromPath} was renamed to ${change.path}`);
      return;
    }
    if (change.type === "unlink" || change.type === "unlinkDir") {
      closePath(change.path, false);
      pendingSavePathsRef.current.delete(change.path);
      if (pendingSavePathsRef.current.size === 0) setSaveState("Saved");
      showWorkspaceNotice(`${change.path} was deleted`);
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
      void refreshAgentState().catch(showWorkspaceError);
      setAgentRefreshVersion((version) => version + 1);
    }, 150);
  }

  function scheduleKnowledgeRefresh() {
    if (!knowledgeEnabled) return;
    if (knowledgeRefreshTimerRef.current) window.clearTimeout(knowledgeRefreshTimerRef.current);
    knowledgeRefreshTimerRef.current = window.setTimeout(() => {
      knowledgeRefreshTimerRef.current = undefined;
      void refreshKnowledgeState().catch(showWorkspaceError);
    }, 180);
  }

  useEffect(() => {
    if (!knowledgeEnabled) return;
    const refresh = () => scheduleKnowledgeRefresh();
    window.addEventListener("knowledge-pending-read", refresh);
    return () => window.removeEventListener("knowledge-pending-read", refresh);
  }, [knowledgeEnabled, projectId]);

  async function refreshKnowledgeState() {
    if (!knowledgeEnabled) return;
    const viewerMemberId = activeKnowledgeMemberIdRef.current;
    const path = activeKnowledgePathRef.current;
    const requestVersion = ++knowledgeRequestVersionRef.current;
    const [cards, fileCards, guide, timeline, inbox, pending] = await Promise.all([
      getKnowledgeCards(projectId),
      path ? getKnowledgeCards(projectId, path) : Promise.resolve({ cards: [], resolutions: [] }),
      getKnowledgeGuide(projectId, path),
      getKnowledgeTimeline(projectId, path),
      getKnowledgeInbox(projectId),
      getPendingKnowledgeTeamCards(projectId)
    ]);
    if (requestVersion !== knowledgeRequestVersionRef.current || path !== activeKnowledgePathRef.current) return;
    setKnowledgeCards(cards.cards);
    setKnowledgeResolutions(fileCards.resolutions);
    setKnowledgeGuide(guide.items);
    setKnowledgeTimeline(timeline.items);
    setKnowledgeUnread(inbox.suggestions.filter(item => !viewerMemberId || !item.seenBy?.includes(viewerMemberId)).length + inbox.warnings.filter(item => !item.seen).length + pending.cards.filter(card => !viewerMemberId || !pendingKnowledgeSeen(projectId, viewerMemberId, card)).length);
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
    setKnowledgeCurrentSelection({
      file: path,
      selection: {
        startLineNumber: selection.startLineNumber,
        startColumn: selection.startColumn,
        endLineNumber: selection.endLineNumber,
        endColumn: selection.endColumn
      }
    });
    socketRef.current?.sendCursorChange(path, position, selection);
  }

  function pinKnowledge(file: string, selection: { startLineNumber: number; startColumn: number; endLineNumber: number; endColumn: number }) {
    if (!knowledgeEnabled) return;
    setCollaborationVisible(true);
    setKnowledgePinSelection({ file, selection });
    setKnowledgeCurrentSelection({ file, selection });
  }

  async function savePinnedKnowledge(input: { type: "decision" | "constraint" | "risk" | "context" | "negative" | "tutorial"; title: string; summary: string; content: string; tags: string[]; scope: "personal" | "team" }) {
    const result = await createKnowledgeCard(projectId, { ...input, anchors: knowledgePinSelection ? [knowledgePinSelection] : undefined });
    setKnowledgeCards((current) => [result.card, ...current]);
    setKnowledgePinSelection(undefined);
    scheduleKnowledgeRefresh();
  }

  async function updateKnowledge(id: string, input: import("./types").KnowledgeCardInput) {
    await updateKnowledgeCard(projectId, id, { ...input });
    await refreshKnowledgeState();
  }

  async function confirmKnowledge(id: string, edited?: boolean, durationMs?: number, patch?: import("./types").KnowledgeCardInput) {
    await confirmKnowledgeCard(projectId, id, edited, durationMs, patch);
    await refreshKnowledgeState();
  }

  async function archiveKnowledge(id: string) {
    await archiveKnowledgeCard(projectId, id);
    await refreshKnowledgeState();
  }

  async function reanchorKnowledge(id: string, anchorIndex: number, selection: { startLineNumber: number; startColumn: number; endLineNumber: number; endColumn: number }) {
    await reanchorKnowledgeCard(projectId, id, anchorIndex, selection);
    await refreshKnowledgeState();
  }

  async function openKnowledgeAnchor(path: string, range?: { startLine: number; startColumn: number; endLine: number; endColumn: number }) {
    await openFile(path);
    if (!range) return;
    const normalizedPath = path.replace(/\\/g, "/").replace(/^\/+/, "");
    const reveal = (attempt: number) => {
      const editor = window.__simplercpEditors?.[path];
      const modelPath = editor?.getModel()?.uri.path.replace(/^\/+/, "");
      if (!editor || !modelPath || (modelPath !== normalizedPath && !modelPath.endsWith(`/${normalizedPath}`))) {
        if (attempt < 30) window.requestAnimationFrame(() => reveal(attempt + 1));
        return;
      }
      const selection = {
        startLineNumber: range.startLine,
        startColumn: range.startColumn,
        endLineNumber: range.endLine,
        endColumn: range.endColumn
      };
      editor.setSelection(selection);
      editor.revealRangeInCenter(selection);
    };
    window.requestAnimationFrame(() => reveal(0));
  }

  async function sendChat() {
    const text = chatText.trim();
    if (!text || !member || !roomId || chatSending) return;
    setChatSending(true);
    clearWorkspaceError();
    try {
      const command = text.match(/^\/agent\s+new\s+(.+)$/i);
      if (command?.[1]) {
        const [name, ...description] = command[1].trim().split(/\s+/);
        const response = await createTeamAgent(projectId, {
          name: name ?? "",
          description: description.join(" ") || undefined
        });
        setTeamAgents((current) => [response.agent, ...current.filter((agent) => agent.id !== response.agent.id)]);
      } else {
        await sendChatMessage(projectId, { text });
      }
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
      style={shellStyle}
    >
      {workspaceError ? (
        <div className="workspace-alert" role="alert" data-testid="workspace-error">
          <span>{workspaceError}</span>
          {projectDeleted ? (
            <a href="/">Projects</a>
          ) : (
            <button type="button" onClick={() => window.location.reload()}>
              Retry
            </button>
          )}
          <button
            type="button"
            aria-label="Dismiss error"
            onClick={clearWorkspaceError}
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
            onClick={clearWorkspaceNotice}
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
          onPinKnowledge={pinKnowledge}
          onReanchorKnowledge={(id, index, selection) => reanchorKnowledge(id, index, selection).catch(showWorkspaceError)}
          knowledgeEnabled={knowledgeEnabled}
          knowledgeResolutions={knowledgeResolutions}
          knowledgeCards={knowledgeCards}
        />
      </section>
      <aside className="collab-pane" hidden={!collaborationVisible}>
        <CollaborationPanel
          members={members}
          events={events}
          chatMessages={chatMessages}
          teamAgents={teamAgents}
          agentRuns={agentRuns}
          agentTraces={agentTraces}
          knowledgeUpdateRuns={knowledgeUpdateRuns}
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
          onOpenKnowledgeAnchor={(path, range) => void openKnowledgeAnchor(path, range).catch(showWorkspaceError)}
          onError={showWorkspaceError}
          onLoadAgentTrace={(runId) => void loadAgentTrace(runId).catch(showWorkspaceError)}
          onCreateTeamAgent={async (name, description) => {
            const response = await createTeamAgent(projectId, { name, description });
            setTeamAgents((current) => [response.agent, ...current.filter((agent) => agent.id !== response.agent.id)]);
          }}
          onCancelAgentRun={async (runId) => {
            const response = await cancelAgentRun(projectId, runId);
            setAgentRuns((current) => current.map((run) => run.id === runId ? response.run : run));
            void refreshAgentState().catch(showWorkspaceError);
          }}
          knowledgeEnabled={knowledgeEnabled}
          activePath={activePath}
          knowledgeRefreshVersion={knowledgeRefreshVersion}
          knowledgeUnread={knowledgeUnread}
          knowledgeCards={knowledgeCards}
          knowledgeResolutions={knowledgeResolutions}
          knowledgeGuide={knowledgeGuide}
          knowledgeTimeline={knowledgeTimeline}
          knowledgePinSelection={knowledgePinSelection}
          knowledgeCurrentSelection={knowledgeCurrentSelection}
          onCreateKnowledgeCard={savePinnedKnowledge}
          onUpdateKnowledgeCard={updateKnowledge}
          onConfirmKnowledgeCard={confirmKnowledge}
          onRefreshKnowledge={refreshKnowledgeState}
          onArchiveKnowledgeCard={archiveKnowledge}
          onReanchorKnowledgeCard={reanchorKnowledge}
          onClearKnowledgePinSelection={() => setKnowledgePinSelection(undefined)}
          onGenerateKnowledgeDemo={async () => {
            await generateKnowledgeDemo(projectId);
            await refreshKnowledgeState();
          }}
        />
      </aside>
      {knowledgeWarning ? <div className="knowledge-warning workspace-dialog-actions" role="status" data-testid="knowledge-risk-warning">
        <span>风险提醒：{knowledgeCards.find(card => card.id === knowledgeWarning.cardId)?.title ?? knowledgeWarning.file}</span>
        <button onClick={() => { const card = knowledgeCards.find(candidate => candidate.id === knowledgeWarning.cardId); if (card) window.dispatchEvent(new CustomEvent("knowledge-open-card", { detail: card.id })); if (knowledgeWarning.warningId) void markKnowledgeWarningsRead(projectId, [knowledgeWarning.warningId]).catch(showWorkspaceError); setKnowledgeWarning(undefined); }}>打开卡片</button>
        <button onClick={() => setKnowledgeWarning(undefined)}>关闭</button>
      </div> : null}
      {terminalEnabled ? (
        <section className="terminal-pane" hidden={!terminalVisible}>
          <TerminalPanel
            projectId={projectId}
            theme={theme}
            canRun={Boolean(member)}
            memberId={member?.id ?? ""}
          />
        </section>
      ) : null}
      <div className="status-bar" data-testid="status-bar">
        <span data-testid="connection-state">{connectionState}</span>
        {connectionState === "Offline" && !projectDeleted ? (
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
        {terminalEnabled ? (
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
        ) : null}
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
      <div className="resize-handle resize-handle-workspace" role="separator" aria-orientation="vertical" aria-label="Resize workspace explorer" onPointerDown={(event) => startResize("workspace", event)} />
      {collaborationVisible ? (
        <div className="resize-handle resize-handle-collaboration" role="separator" aria-orientation="vertical" aria-label="Resize collaboration panel" onPointerDown={(event) => startResize("collaboration", event)} />
      ) : null}
      {terminalVisible && terminalEnabled ? (
        <div className={`resize-handle resize-handle-terminal${collaborationVisible ? "" : " collaboration-hidden"}`} role="separator" aria-orientation="horizontal" aria-label="Resize terminal panel" onPointerDown={(event) => startResize("terminal", event)} />
      ) : null}
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

function readLayoutDimension(key: string, fallback: number, minimum: number, maximum: number) {
  const stored = window.localStorage.getItem(key);
  if (stored === null) return fallback;
  const value = Number(stored);
  return Number.isFinite(value) ? clampLayoutDimension(value, minimum, maximum) : fallback;
}

function clampLayoutDimension(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

async function fetchAgentTraces(projectId: string, runs: AgentRun[]) {
  const entries = await Promise.all(
    runs.map(async (run) => [run.id, await getAgentTrace(projectId, run.id)] as const)
  );
  return Object.fromEntries(entries) as Record<string, AgentTraceEvent[]>;
}

function mergeTraceEvents(
  current: AgentTraceEvent[],
  incoming: AgentTraceEvent[]
) {
  const bySequence = new Map(current.map((event) => [event.sequence, event]));
  for (const event of incoming) bySequence.set(event.sequence, event);
  return [...bySequence.values()].sort((left, right) => left.sequence - right.sequence);
}
