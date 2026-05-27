import { useEffect, useMemo, useState } from "react";
import {
  getEvents,
  getHealth,
  getRoom,
  getWorkspaceTree,
  joinRoom,
  readWorkspaceFile,
  writeWorkspaceFile
} from "./api";
import { CollaborationPanel } from "./components/CollaborationPanel";
import { EditorArea, type OpenFile } from "./components/EditorArea";
import { TerminalPanel } from "./components/TerminalPanel";
import { WorkspaceExplorer } from "./components/WorkspaceExplorer";
import { connectRoomSocket, type ClientSocket } from "./socket";
import type { EventRecord, RoomMember, WorkspaceNode } from "./types";

export function App() {
  const [roomId, setRoomId] = useState("");
  const [member, setMember] = useState<RoomMember | null>(null);
  const [members, setMembers] = useState<RoomMember[]>([]);
  const [tree, setTree] = useState<WorkspaceNode[]>([]);
  const [openFiles, setOpenFiles] = useState<OpenFile[]>([]);
  const [activePath, setActivePath] = useState<string>();
  const [events, setEvents] = useState<EventRecord[]>([]);
  const [chatText, setChatText] = useState("");
  const [terminalLines] = useState<string[]>([]);
  const [socket, setSocket] = useState<ClientSocket | null>(null);

  const displayName = useMemo(
    () =>
      new URLSearchParams(window.location.search).get("name") ??
      `User-${Math.floor(Math.random() * 1000)}`,
    []
  );

  useEffect(() => {
    let mounted = true;
    async function boot() {
      const health = await getHealth();
      const joined = await joinRoom(health.roomId, displayName);
      const [room, workspaceTree, eventRecords] = await Promise.all([
        getRoom(health.roomId),
        getWorkspaceTree(),
        getEvents()
      ]);

      if (!mounted) return;
      setRoomId(health.roomId);
      setMember(joined);
      setMembers(room.members);
      setTree(workspaceTree);
      setEvents(eventRecords);

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

  async function refreshEvents() {
    setEvents(await getEvents());
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
          chatText={chatText}
          onChatTextChange={setChatText}
          onSendChat={sendChat}
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
