import { useEffect, useMemo, useRef, useState } from "react";
import {
  getAgentRuns,
  createWorkspaceDirectory,
  createWorkspaceFile,
  createTask,
  deleteWorkspacePath,
  getChatMessages,
  getEvents,
  getHealth,
  getRoom,
  getRuntimeConfig,
  getScenarios,
  getTasks,
  getTimeline,
  getWorkspaceTree,
  joinRoom,
  readWorkspaceFile,
  renameWorkspacePath,
  runScenario,
  runConfiguredAgent,
  runMockAgent,
  runQuickCommand,
  sendConnectionOffline,
  sendChatMessage,
  writeWorkspaceFile
} from "./api";
import { CollaborationPanel } from "./components/CollaborationPanel";
import { EditorArea, type OpenFile } from "./components/EditorArea";
import { TerminalPanel } from "./components/TerminalPanel";
import { WorkspaceExplorer } from "./components/WorkspaceExplorer";
import { connectRoomSocket, type ClientSocket } from "./socket";
import type {
  AgentRun,
  ChatMessage,
  EventRecord,
  RoomMember,
  RuntimeConfig,
  ScenarioSummary,
  TaskRecord,
  TimelineItem,
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
  const [tasks, setTasks] = useState<TaskRecord[]>([]);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [agentRuns, setAgentRuns] = useState<AgentRun[]>([]);
  const [timeline, setTimeline] = useState<TimelineItem[]>([]);
  const [scenarios, setScenarios] = useState<ScenarioSummary[]>([]);
  const [selectedScenario, setSelectedScenario] = useState("");
  const [runtimeConfig, setRuntimeConfig] = useState<RuntimeConfig>({
    commandMode: "restricted",
    commands: [],
    agentProvider: "mock",
    agentConfigured: true,
    agentName: "MockAgent",
    agentMentionAliases: ["MockAgent"]
  });
  const [chatText, setChatText] = useState("");
  const [terminalLines, setTerminalLines] = useState<string[]>([]);
  const [selectedCommand, setSelectedCommand] = useState("");
  const [commandText, setCommandText] = useState("");
  const [workspaceName, setWorkspaceName] = useState("");
  const [commandRunning, setCommandRunning] = useState(false);
  const [connectionState, setConnectionState] = useState("Connecting");
  const [socket, setSocket] = useState<ClientSocket | null>(null);
  const connectionRef = useRef<{ roomId: string; connectionId: string } | null>(
    null
  );
  const bootStartedRef = useRef(false);

  const displayName = useMemo(
    () =>
      new URLSearchParams(window.location.search).get("name") ??
      `User-${Math.floor(Math.random() * 1000)}`,
    []
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
        "human",
        connectionId,
        userId,
        connectionId
      );
      const [
        room,
        workspaceTree,
        eventRecords,
        taskRecords,
        runtime,
        messages,
        runs,
        timelineItems,
        scenarioRecords
      ] = await Promise.all([
        getRoom(health.roomId),
        getWorkspaceTree(),
        getEvents(),
        getTasks(health.roomId),
        getRuntimeConfig(),
        getChatMessages(health.roomId),
        getAgentRuns(health.roomId),
        getTimeline(health.roomId),
        getScenarios()
      ]);

      if (!mounted) return;
      setRoomId(health.roomId);
      setMember(joined);
      setMembers(room.members);
      setWorkspaceName(room.workspaceName);
      setTree(workspaceTree);
      setEvents(eventRecords);
      setTasks(taskRecords);
      setRuntimeConfig(runtime);
      setChatMessages(messages);
      setAgentRuns(runs);
      setTimeline(timelineItems);
      setScenarios(scenarioRecords);
      setSelectedScenario(scenarioRecords[0]?.id ?? "");
      setSelectedCommand(runtime.commands[0] ?? "");
      setCommandText(runtime.commands[0] ?? "");

      const connected = connectRoomSocket({
        roomId: health.roomId,
        memberId: joined.id,
        connectionId,
        onMessage(message) {
          setConnectionState("Connected");
          if (message.type === "presence") {
            setMembers(message.members);
          }
          if (message.type === "file_change" && message.memberId !== joined.id) {
            setOpenFiles((files) =>
              files.map((file) =>
                file.path === message.path
                  ? { ...file, content: message.content }
                  : file
              )
            );
          }
          if (message.type === "chat_message") {
            void refreshCollaboration();
          }
          if (message.type === "workspace_tree_changed") {
            void refreshWorkspace();
          }
        }
      });
      connectionRef.current = { roomId: health.roomId, connectionId };
      connected.sendReady();
      setSocket(connected);
    }

    void boot();
    return () => {
      mounted = false;
      const connection = connectionRef.current;
      if (connection) {
        sendConnectionOffline(connection.roomId, connection.connectionId);
      }
    };
  }, [displayName]);

  useEffect(() => {
    return () => {
      const connection = connectionRef.current;
      if (connection) {
        sendConnectionOffline(connection.roomId, connection.connectionId);
      }
      socket?.close();
    };
  }, [socket]);

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
      void refreshTasksAndEvents();
    }, 1500);
    return () => window.clearInterval(timer);
  }, [roomId]);

  async function refreshEvents() {
    setEvents(await getEvents());
  }

  async function refreshTasksAndEvents() {
    await refreshCollaboration();
  }

  async function refreshCollaboration() {
    if (!roomId) return;
    const [
      room,
      taskRecords,
      eventRecords,
      workspaceTree,
      messages,
      runs,
      timelineItems
    ] = await Promise.all([
      getRoom(roomId),
      getTasks(roomId),
      getEvents(),
      getWorkspaceTree(),
      getChatMessages(roomId),
      getAgentRuns(roomId),
      getTimeline(roomId)
    ]);
    setMembers(room.members);
    setTasks(taskRecords);
    setEvents(eventRecords);
    setTree(workspaceTree);
    setChatMessages(messages);
    setAgentRuns(runs);
    setTimeline(timelineItems);
    setTerminalLines(terminalLinesFromEvents(eventRecords));
  }

  async function refreshWorkspace() {
    setTree(await getWorkspaceTree());
    if (activePath) {
      try {
        const content = await readWorkspaceFile(activePath);
        setOpenFiles((files) =>
          files.map((file) => (file.path === activePath ? { ...file, content } : file))
        );
      } catch {
        closePath(activePath);
      }
    }
  }

  async function openFile(path: string) {
    const existing = openFiles.find((file) => file.path === path);
    if (!existing) {
      const content = await readWorkspaceFile(path);
      setOpenFiles((files) => [...files, { path, content }]);
    }
    setActivePath(path);
    socket?.sendOpenFile(path);
    await refreshEvents();
  }

  function selectFile(path: string) {
    setActivePath(path);
    socket?.sendOpenFile(path);
  }

  async function changeFile(path: string, content: string) {
    setOpenFiles((files) =>
      files.map((file) => (file.path === path ? { ...file, content } : file))
    );
    socket?.sendFileChange(path, content);
    await writeWorkspaceFile(path, content);
  }

  async function sendChat() {
    const text = chatText.trim();
    if (!text || !member || !roomId) return;
    const authorName = member.displayName ?? member.name;
    await sendChatMessage(roomId, {
      authorId: member.id,
      authorName,
      authorKind: member.kind,
      text
    });
    socket?.sendChat(text);
    setChatText("");
    await refreshCollaboration();
  }

  async function createMockAgentTask() {
    if (!member || !roomId) return;
    const agentName = "MockAgent";
    const agentMember =
      members.find((candidate) => candidate.name === agentName) ??
      (await joinRoom(
        roomId,
        agentName,
        "agent",
        "agent:mock",
        "agent:mock",
        "agent:mock",
        "mock"
      ));

    await createTask({
      roomId,
      title: "MockAgent update greeting",
      description: "Update src/hello.ts and run npm test.",
      creatorId: member.id,
      assigneeId: agentMember.id,
      editablePaths: ["src/**"],
      commandWhitelist: ["npm test"],
      acceptanceTarget: "npm test passes"
    });
    const room = await getRoom(roomId);
    setMembers(room.members);
    await refreshTasksAndEvents();
  }

  async function runMockAgentForTask(taskId: string) {
    const task = tasks.find((candidate) => candidate.id === taskId);
    if (!task) return;
    const report = await runMockAgent(taskId, task.assigneeId);
    setTerminalLines((lines) => [...lines, report.summary]);
    await refreshTasksAndEvents();
    const workspaceTree = await getWorkspaceTree();
    setTree(workspaceTree);
    if (activePath) {
      const content = await readWorkspaceFile(activePath);
      setOpenFiles((files) =>
        files.map((file) => (file.path === activePath ? { ...file, content } : file))
      );
    }
  }

  async function runConfiguredAgentForTask(taskId: string) {
    const task = tasks.find((candidate) => candidate.id === taskId);
    if (!task) return;
    const report = await runConfiguredAgent(taskId, task.assigneeId);
    setTerminalLines((lines) => [...lines, report.summary]);
    await refreshTasksAndEvents();
    await refreshWorkspace();
  }

  async function createFileFromPrompt() {
    const path = window.prompt("New file path");
    if (!path) return;
    const nextTree = await createWorkspaceFile(path, "");
    setTree(nextTree);
    await openFile(path);
    await refreshEvents();
  }

  async function createFolderFromPrompt() {
    const path = window.prompt("New folder path");
    if (!path) return;
    setTree(await createWorkspaceDirectory(path));
    await refreshEvents();
  }

  async function renamePathFromPrompt(path: string) {
    const toPath = window.prompt("Rename path", path);
    if (!toPath || toPath === path) return;
    setTree(await renameWorkspacePath(path, toPath));
    setOpenFiles((files) =>
      files.map((file) =>
        file.path === path ? { ...file, path: toPath } : file
      )
    );
    if (activePath === path) {
      setActivePath(toPath);
    }
    await refreshEvents();
  }

  async function deletePathWithConfirm(path: string) {
    if (!window.confirm(`Delete ${path}?`)) return;
    setTree(await deleteWorkspacePath(path));
    closePath(path);
    await refreshEvents();
  }

  async function runSelectedCommand() {
    const command =
      runtimeConfig.commandMode === "unrestricted"
        ? commandText.trim()
        : selectedCommand;
    if (!member || !command) return;
    setCommandRunning(true);
    try {
      const run = await runQuickCommand(command, member.id);
      setTerminalLines((lines) => [
        ...lines,
        `$ ${command}`,
        run.output.trimEnd(),
        `exit ${run.exitCode}`
      ]);
      await refreshTasksAndEvents();
    } finally {
      setCommandRunning(false);
    }
  }

  async function runSelectedScenario() {
    if (!selectedScenario) return;
    const result = await runScenario(selectedScenario);
    setTimeline(result.timeline);
    setChatMessages(result.messages);
    setAgentRuns(result.runs);
    await refreshTasksAndEvents();
    await refreshWorkspace();
  }

  function closePath(path: string) {
    setOpenFiles((files) =>
      files.filter((file) => file.path !== path && !file.path.startsWith(`${path}/`))
    );
    if (activePath === path || activePath?.startsWith(`${path}/`)) {
      setActivePath(undefined);
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
          onSelectFile={selectFile}
          onChangeFile={changeFile}
        />
      </section>
      <aside className="collab-pane">
        <CollaborationPanel
          members={members}
          events={events}
          tasks={tasks}
          chatMessages={chatMessages}
          agentRuns={agentRuns}
          timeline={timeline}
          scenarios={scenarios}
          selectedScenario={selectedScenario}
          chatText={chatText}
          runtimeConfig={runtimeConfig}
          onChatTextChange={setChatText}
          onSendChat={sendChat}
          onSelectedScenarioChange={setSelectedScenario}
          onRunScenario={runSelectedScenario}
          onCreateMockAgentTask={createMockAgentTask}
          onRunMockAgent={runMockAgentForTask}
          onRunConfiguredAgent={runConfiguredAgentForTask}
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
        <span>{member?.displayName ?? member?.name ?? "Joining"}</span>
        <span>{workspaceName || "Workspace"}</span>
      </div>
    </main>
  );
}

function terminalLinesFromEvents(events: EventRecord[]) {
  return events.flatMap((event) => {
    if (event.type === "command_output") {
      const payload = event.payload as { output?: unknown } | undefined;
      return [String(payload?.output ?? "")];
    }
    if (event.type === "agent_reported") {
      const payload = event.payload as { summary?: unknown } | undefined;
      return [String(payload?.summary ?? "")];
    }
    return [];
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
