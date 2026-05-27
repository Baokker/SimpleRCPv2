import { useEffect, useMemo, useRef, useState } from "react";
import {
  createTask,
  getEvents,
  getHealth,
  getRoom,
  getTasks,
  getWorkspaceTree,
  joinRoom,
  readWorkspaceFile,
  runMockAgent,
  writeWorkspaceFile
} from "./api";
import { CollaborationPanel } from "./components/CollaborationPanel";
import { EditorArea, type OpenFile } from "./components/EditorArea";
import { TerminalPanel } from "./components/TerminalPanel";
import { WorkspaceExplorer } from "./components/WorkspaceExplorer";
import { connectRoomSocket, type ClientSocket } from "./socket";
import type { EventRecord, RoomMember, TaskRecord, WorkspaceNode } from "./types";

export function App() {
  const [roomId, setRoomId] = useState("");
  const [member, setMember] = useState<RoomMember | null>(null);
  const [members, setMembers] = useState<RoomMember[]>([]);
  const [tree, setTree] = useState<WorkspaceNode[]>([]);
  const [openFiles, setOpenFiles] = useState<OpenFile[]>([]);
  const [activePath, setActivePath] = useState<string>();
  const [events, setEvents] = useState<EventRecord[]>([]);
  const [tasks, setTasks] = useState<TaskRecord[]>([]);
  const [chatText, setChatText] = useState("");
  const [terminalLines, setTerminalLines] = useState<string[]>([]);
  const [socket, setSocket] = useState<ClientSocket | null>(null);
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
      const joined = await joinRoom(health.roomId, displayName);
      const [room, workspaceTree, eventRecords, taskRecords] = await Promise.all([
        getRoom(health.roomId),
        getWorkspaceTree(),
        getEvents(),
        getTasks(health.roomId)
      ]);

      if (!mounted) return;
      setRoomId(health.roomId);
      setMember(joined);
      setMembers(room.members);
      setTree(workspaceTree);
      setEvents(eventRecords);
      setTasks(taskRecords);

      const connected = connectRoomSocket({
        roomId: health.roomId,
        memberId: joined.id,
        onMessage(message) {
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
            void refreshEvents();
          }
        }
      });
      setSocket(connected);
    }

    void boot();
    return () => {
      mounted = false;
    };
  }, [displayName]);

  useEffect(() => {
    return () => socket?.close();
  }, [socket]);

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
    if (!roomId) return;
    const [room, taskRecords, eventRecords] = await Promise.all([
      getRoom(roomId),
      getTasks(roomId),
      getEvents()
    ]);
    setMembers(room.members);
    setTasks(taskRecords);
    setEvents(eventRecords);
    setTerminalLines(terminalLinesFromEvents(eventRecords));
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
    if (!text) return;
    socket?.sendChat(text);
    setChatText("");
    await refreshEvents();
  }

  async function createMockAgentTask() {
    if (!member || !roomId) return;
    const agentName = "MockAgent";
    const agentMember =
      members.find((candidate) => candidate.name === agentName) ??
      (await joinRoom(roomId, agentName, "agent"));

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

  return (
    <main className="app-shell">
      <aside className="workspace-pane">
        <WorkspaceExplorer
          tree={tree}
          activePath={activePath}
          onOpenFile={openFile}
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
          chatText={chatText}
          onChatTextChange={setChatText}
          onSendChat={sendChat}
          onCreateMockAgentTask={createMockAgentTask}
          onRunMockAgent={runMockAgentForTask}
        />
      </aside>
      <section className="terminal-pane">
        <TerminalPanel lines={terminalLines} />
      </section>
      <div className="room-badge" data-testid="room-badge">
        Room {roomId} · {member?.name ?? "Joining"}
      </div>
    </main>
  );
}
