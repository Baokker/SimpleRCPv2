import {
  Activity,
  FileCode2,
  FilePenLine,
  FilePlus2,
  FolderPlus,
  LogIn,
  LogOut,
  MessageSquareText,
  Pencil,
  SquareTerminal,
  Trash2,
  Users
} from "lucide-react";
import { useMemo, useState } from "react";
import type {
  ChatMessage,
  EventRecord,
  RemoteCursor,
  RoomMember
} from "../types";

type CollaborationTab = "chat" | "team";
type ActivityKind =
  | "join"
  | "leave"
  | "chat"
  | "open"
  | "edit"
  | "command"
  | "create"
  | "rename"
  | "delete"
  | "general";

interface ActivityItem {
  id: string;
  kind: ActivityKind;
  text: string;
  timestamp: string;
}

export function CollaborationPanel({
  members,
  events,
  chatMessages,
  remoteCursors,
  chatText,
  onChatTextChange,
  onSendChat
}: {
  members: RoomMember[];
  events: EventRecord[];
  chatMessages: ChatMessage[];
  remoteCursors: RemoteCursor[];
  chatText: string;
  onChatTextChange(value: string): void;
  onSendChat(): void;
}) {
  const [activeTab, setActiveTab] = useState<CollaborationTab>("chat");
  const activityItems = useMemo(
    () =>
      events
        .flatMap((event) => {
          const item = formatActivity(event, members);
          return item ? [item] : [];
        })
        .slice(-30)
        .reverse(),
    [events, members]
  );

  return (
    <div className="panel collab-panel">
      <div className="panel-header">Collaboration</div>
      <nav className="collab-tabs" aria-label="Collaboration sections">
        <button
          className={activeTab === "chat" ? "active" : ""}
          onClick={() => setActiveTab("chat")}
          data-testid="collab-tab-chat"
        >
          <MessageSquareText size={14} />
          Chat
        </button>
        <button
          className={activeTab === "team" ? "active" : ""}
          onClick={() => setActiveTab("team")}
          data-testid="collab-tab-team"
        >
          <Users size={14} />
          Team
        </button>
      </nav>

      <div className="collab-tab-body">
        {activeTab === "chat" ? (
          <section className="collab-section chat-section">
            <ol className="chat-transcript" data-testid="chat-transcript">
              {chatMessages.length === 0 ? (
                <li className="empty-panel-state">No messages yet.</li>
              ) : (
                chatMessages.map((message) => (
                  <li key={message.id} className="chat-message">
                    <span>
                      <strong>{message.authorName}</strong>
                      <time>{formatTime(message.timestamp)}</time>
                    </span>
                    <p>{message.text}</p>
                  </li>
                ))
              )}
            </ol>
            <div className="chat-box" data-testid="chat-composer">
              <textarea
                value={chatText}
                onChange={(event) => onChatTextChange(event.target.value)}
                placeholder="Message collaborators"
                data-testid="chat-input"
              />
              <button onClick={onSendChat} data-testid="send-chat">
                Send
              </button>
            </div>
          </section>
        ) : null}

        {activeTab === "team" ? (
          <section className="collab-section team-section">
            <div className="team-block">
              <h2>People</h2>
              <ul className="member-list" data-testid="member-list">
                {members.map((member) => {
                  const cursor = remoteCursors.find(
                    (candidate) => candidate.memberId === member.id
                  );
                  return (
                    <li key={member.id}>
                      <span>
                        <i className={member.online ? "status-dot online" : "status-dot"} />
                        <strong>{member.displayName}</strong>
                        {member.connectionCount > 1 ? (
                          <em>{member.connectionCount} tabs</em>
                        ) : null}
                      </span>
                      <small>
                        {cursor
                          ? `${cursor.path} · Ln ${cursor.position.lineNumber}, Col ${cursor.position.column}`
                          : member.currentFile ?? (member.online ? "Browsing" : "Offline")}
                      </small>
                    </li>
                  );
                })}
              </ul>
            </div>

            <div className="team-block activity-block">
              <h2>Activity</h2>
              <ol className="event-list" data-testid="activity-feed">
                {activityItems.length === 0 ? (
                  <li className="empty-panel-state">No activity yet.</li>
                ) : (
                  activityItems.map((item) => (
                    <li key={item.id}>
                      <ActivityIcon kind={item.kind} />
                      <span>
                        <strong>{item.text}</strong>
                        <time>{formatTime(item.timestamp)}</time>
                      </span>
                    </li>
                  ))
                )}
              </ol>
            </div>
          </section>
        ) : null}
      </div>
    </div>
  );
}

function formatActivity(
  event: EventRecord,
  members: RoomMember[]
): ActivityItem | null {
  const payload = event.payload ?? {};
  const actor =
    members.find((member) => member.id === event.memberId)?.displayName ??
    stringValue(payload.name) ??
    "A collaborator";

  switch (event.type) {
    case "room_created":
      return item(event, "general", `Session opened for ${stringValue(payload.workspaceName) ?? "workspace"}`);
    case "member_joined":
      return item(event, "join", `${stringValue(payload.name) ?? actor} joined the session`);
    case "member_rejoined":
      return item(
        event,
        "join",
        numberValue(payload.connectionCount) > 1
          ? `${stringValue(payload.name) ?? actor} opened another tab`
          : `${stringValue(payload.name) ?? actor} rejoined the session`
      );
    case "member_online":
      return item(event, "join", `${actor} came online`);
    case "member_offline":
      return item(event, "leave", `${actor} left the session`);
    case "file_opened":
      return item(event, "open", `${actor} opened ${stringValue(payload.path) ?? "a file"}`);
    case "file_changed":
      return item(event, "edit", `${actor} edited ${stringValue(payload.path) ?? "a file"}`);
    case "chat_message_created":
      return item(
        event,
        "chat",
        `${stringValue(payload.authorName) ?? actor}: ${truncate(stringValue(payload.text) ?? "sent a message")}`
      );
    case "command_started":
      return item(event, "command", `${actor} ran ${stringValue(payload.command) ?? "a command"}`);
    case "command_completed":
      return item(
        event,
        "command",
        `${actor}'s command finished with exit ${numberValue(payload.exitCode)}`
      );
    case "workspace_file_created":
      return item(event, "create", `${actor} created ${stringValue(payload.path) ?? "a file"}`);
    case "workspace_directory_created":
      return item(event, "create", `${actor} created folder ${stringValue(payload.path) ?? ""}`.trim());
    case "workspace_path_renamed":
      return item(
        event,
        "rename",
        `${actor} renamed ${stringValue(payload.fromPath) ?? "a path"} to ${stringValue(payload.toPath) ?? "a new path"}`
      );
    case "workspace_path_deleted":
      return item(event, "delete", `${actor} deleted ${stringValue(payload.path) ?? "a path"}`);
    default:
      return null;
  }
}

function item(
  event: EventRecord,
  kind: ActivityKind,
  text: string
): ActivityItem {
  return { id: event.id, kind, text, timestamp: event.timestamp };
}

function ActivityIcon({ kind }: { kind: ActivityKind }) {
  const props = { size: 14, "aria-hidden": true };
  if (kind === "join") return <LogIn {...props} />;
  if (kind === "leave") return <LogOut {...props} />;
  if (kind === "chat") return <MessageSquareText {...props} />;
  if (kind === "open") return <FileCode2 {...props} />;
  if (kind === "edit") return <FilePenLine {...props} />;
  if (kind === "command") return <SquareTerminal {...props} />;
  if (kind === "create") return <FilePlus2 {...props} />;
  if (kind === "rename") return <Pencil {...props} />;
  if (kind === "delete") return <Trash2 {...props} />;
  if (kind === "general") return <Activity {...props} />;
  return <FolderPlus {...props} />;
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value : undefined;
}

function numberValue(value: unknown) {
  return typeof value === "number" ? value : 0;
}

function truncate(value: string) {
  return value.length > 90 ? `${value.slice(0, 87)}...` : value;
}

function formatTime(timestamp: string) {
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  }).format(new Date(timestamp));
}
