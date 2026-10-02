import {
  Activity,
  Bot,
  FilePenLine,
  FilePlus2,
  Eye,
  EyeOff,
  FolderPlus,
  LogIn,
  LogOut,
  MessageSquareText,
  Plus,
  Pencil,
  Settings2,
  Trash2,
  Users
} from "lucide-react";
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { AgentPanel } from "./AgentPanel";
import type {
  AgentRun,
  AgentSession,
  ChatMessage,
  EventRecord,
  RemoteCursor,
  RoomMember,
  WorkspaceNode
} from "../types";
import { formatTime } from "../format";

type CollaborationTab = "chat" | "agent" | "team" | "project";
type ActivityKind =
  | "join"
  | "leave"
  | "edit"
  | "create"
  | "rename"
  | "delete"
  | "agent"
  | "general";

interface ActivityItem {
  id: string;
  kind: ActivityKind;
  text: string;
  detail?: string;
  path?: string;
  startedAt?: string;
  timestamp: string;
}

export function CollaborationPanel({
  members,
  events,
  chatMessages,
  teamAgents,
  agentRuns,
  remoteCursors,
  chatText,
  chatSending,
  onChatTextChange,
  onSendChat,
  member,
  projectId,
  workspaceRoot,
  workspaceTree,
  roomId,
  agentRefreshVersion,
  followingMemberId,
  onFollowMember,
  onOpenFile,
  onError,
  onCreateTeamAgent,
  onCancelAgentRun
}: {
  members: RoomMember[];
  events: EventRecord[];
  chatMessages: ChatMessage[];
  teamAgents: AgentSession[];
  agentRuns: AgentRun[];
  remoteCursors: RemoteCursor[];
  chatText: string;
  chatSending: boolean;
  onChatTextChange(value: string): void;
  onSendChat(): void;
  member: RoomMember | null;
  projectId: string;
  workspaceRoot: string;
  workspaceTree: WorkspaceNode[];
  roomId: string;
  agentRefreshVersion: number;
  followingMemberId?: string;
  onFollowMember(memberId: string): void;
  onOpenFile(path: string): void;
  onError(error: unknown): void;
  onCreateTeamAgent(name: string): Promise<void>;
  onCancelAgentRun(runId: string): Promise<void>;
}) {
  const [activeTab, setActiveTab] = useState<CollaborationTab>("chat");
  const [teamAgentFormOpen, setTeamAgentFormOpen] = useState(false);
  const [teamAgentName, setTeamAgentName] = useState("");
  const [unseenMessages, setUnseenMessages] = useState(0);
  const chatTranscriptRef = useRef<HTMLOListElement>(null);
  const stickToLatestRef = useRef(true);
  const previousMessageCountRef = useRef(chatMessages.length);
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
  const mentionQuery = chatText.match(/(?:^|\s)@([a-z0-9-]*)$/i)?.[1]?.toLowerCase();
  const mentionCandidates = useMemo(() => [
    ...teamAgents
      .filter((agent): agent is AgentSession & { handle: string } => Boolean(agent.handle))
      .map((agent) => ({ id: agent.id, handle: agent.handle, name: agent.handle, team: true })),
    ...members.map((candidate) => ({
      id: candidate.id,
      handle: memberHandle(candidate.displayName),
      name: candidate.displayName,
      team: false
    }))
  ], [members, teamAgents]);
  const visibleMentionCandidates = mentionQuery === undefined
    ? []
    : mentionCandidates.filter((candidate) => candidate.handle.startsWith(mentionQuery));
  const runsById = useMemo(() => new Map(agentRuns.map((run) => [run.id, run])), [agentRuns]);

  useLayoutEffect(() => {
    const transcript = chatTranscriptRef.current;
    const added = Math.max(
      0,
      chatMessages.length - previousMessageCountRef.current
    );
    previousMessageCountRef.current = chatMessages.length;
    if (!transcript) return;
    if (stickToLatestRef.current) {
      transcript.scrollTop = transcript.scrollHeight;
      setUnseenMessages(0);
    } else if (added > 0) {
      setUnseenMessages((count) => count + added);
    }
  }, [chatMessages]);

  function showLatestMessages() {
    const transcript = chatTranscriptRef.current;
    if (!transcript) return;
    transcript.scrollTop = transcript.scrollHeight;
    stickToLatestRef.current = true;
    setUnseenMessages(0);
  }

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
          className={activeTab === "agent" ? "active" : ""}
          onClick={() => setActiveTab("agent")}
          data-testid="collab-tab-agent"
        >
          <Bot size={14} />
          My Agent
        </button>
        <button
          className={activeTab === "project" ? "active" : ""}
          onClick={() => setActiveTab("project")}
          data-testid="collab-tab-project"
        >
          <Settings2 size={14} />
          Project
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
            <div className="team-agent-bar" data-testid="team-agent-bar">
              <strong>Team Agents</strong>
              {teamAgents.map((agent) => {
                const active = agentRuns.some(
                  (run) => run.sessionId === agent.id && (run.status === "queued" || run.status === "running")
                );
                return (
                  <span key={agent.id} className="team-agent-status">
                    <Bot size={13} /> @{agent.handle ?? agent.title} · {active ? "Running" : "Idle"}
                  </span>
                );
              })}
              <button type="button" data-testid="team-agent-create" onClick={() => setTeamAgentFormOpen((current) => !current)}>
                <Plus size={13} /> Agent
              </button>
            </div>
            {teamAgentFormOpen ? (
              <div className="team-agent-create">
                <input
                  value={teamAgentName}
                  onChange={(event) => setTeamAgentName(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key !== "Enter" || !teamAgentName.trim()) return;
                    void onCreateTeamAgent(teamAgentName.trim()).then(() => {
                      setTeamAgentName("");
                      setTeamAgentFormOpen(false);
                    }).catch(onError);
                  }}
                  placeholder="Agent name"
                  data-testid="team-agent-name"
                />
                <button
                  type="button"
                  disabled={!teamAgentName.trim()}
                  onClick={() => void onCreateTeamAgent(teamAgentName.trim()).then(() => {
                    setTeamAgentName("");
                    setTeamAgentFormOpen(false);
                  }).catch(onError)}
                >Create</button>
              </div>
            ) : null}
            <ol
              ref={chatTranscriptRef}
              className="chat-transcript"
              onScroll={(event) => {
                const transcript = event.currentTarget;
                stickToLatestRef.current =
                  transcript.scrollHeight - transcript.scrollTop - transcript.clientHeight < 24;
                if (stickToLatestRef.current) setUnseenMessages(0);
              }}
              data-testid="chat-transcript"
            >
              {chatMessages.length === 0 ? (
                <li className="empty-panel-state">Mention a team Agent in Chat to assign work. Everyone can see progress and continue directing it.</li>
              ) : (
                chatMessages.map((message) => (
                  <li key={message.id} className={`chat-message chat-message-${message.kind ?? "member"}`}>
                    <span>
                      <strong>
                        {message.kind === "agent" ? <Bot size={13} /> : null}
                        {message.authorName}
                        {message.authorRole ? ` · ${message.authorRole}` : ""}
                      </strong>
                      <time>{formatTime(message.timestamp)}</time>
                    </span>
                    {message.kind === "system" ? (
                      <p className="chat-system-message">{message.text}</p>
                    ) : message.kind === "agent" ? (
                      <ChatAgentMessage
                        message={message}
                        run={message.runId ? runsById.get(message.runId) : undefined}
                        onOpenFile={onOpenFile}
                        onCancelAgentRun={onCancelAgentRun}
                      />
                    ) : (
                      <p>{message.text}</p>
                    )}
                  </li>
                ))
              )}
            </ol>
            {unseenMessages > 0 ? (
              <button
                className="new-messages"
                type="button"
                onClick={showLatestMessages}
              >
                {unseenMessages} new {unseenMessages === 1 ? "message" : "messages"}
              </button>
            ) : null}
            <div className="chat-box" data-testid="chat-composer">
              <textarea
                value={chatText}
                onChange={(event) => onChatTextChange(event.target.value)}
                onKeyDown={(event) => {
                  if (
                    event.key === "Enter" &&
                    !event.shiftKey &&
                    !event.nativeEvent.isComposing
                  ) {
                    event.preventDefault();
                    onSendChat();
                  }
                }}
                placeholder="Message the team, or @agent to give the shared agent a task"
                aria-describedby="chat-keyboard-hint"
                data-testid="chat-input"
              />
              {visibleMentionCandidates.length > 0 ? (
                <ul className="mention-candidates" data-testid="mention-candidates">
                  {visibleMentionCandidates.map((candidate) => (
                    <li key={`${candidate.team ? "team" : "member"}-${candidate.id}`}>
                      <button
                        type="button"
                        onClick={() => {
                          const prefix = chatText.slice(0, chatText.length - (mentionQuery?.length ?? 0) - 1);
                          onChatTextChange(`${prefix}@${candidate.handle} `);
                        }}
                      >
                        {candidate.team ? <Bot size={13} /> : <Users size={13} />} @{candidate.handle} · {candidate.name}
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
              <div className="chat-actions">
                <small id="chat-keyboard-hint">
                  Enter to send / Shift + Enter for new line
                </small>
                <button
                  onClick={onSendChat}
                  disabled={chatSending || chatText.trim().length === 0}
                  data-testid="send-chat"
                >
                  {chatSending ? "Sending" : "Send"}
                </button>
              </div>
            </div>
          </section>
        ) : null}

        {activeTab === "team" ? (
          <section className="collab-section team-section">
            <div className="team-block">
              <h2>People</h2>
              <ul className="member-list" data-testid="member-list">
                {members.map((candidate) => {
                  const cursor = remoteCursors.find(
                    (remoteCursor) => remoteCursor.memberId === candidate.id
                  );
                  return (
                    <li key={candidate.id}>
                      <span>
                        <i className={candidate.online ? "status-dot online" : "status-dot"} />
                        <strong>{candidate.displayName}</strong>
                        {candidate.profileRole ? <em>{candidate.profileRole}</em> : null}
                        {candidate.connectionCount > 1 ? (
                          <em>{candidate.connectionCount} tabs</em>
                        ) : null}
                        {candidate.id !== member?.id ? (
                          <button
                            className={
                              followingMemberId === candidate.id
                                ? "member-follow active"
                                : "member-follow"
                            }
                            aria-label={
                              followingMemberId === candidate.id
                                ? `Stop following ${candidate.displayName}`
                                : `Follow ${candidate.displayName}`
                            }
                            title={
                              followingMemberId === candidate.id
                                ? "Stop following"
                                : "Follow collaborator"
                            }
                            onClick={() => onFollowMember(candidate.id)}
                            data-testid={`follow-member-${candidate.displayName}`}
                          >
                            {followingMemberId === candidate.id ? (
                              <EyeOff size={13} />
                            ) : (
                              <Eye size={13} />
                            )}
                          </button>
                        ) : null}
                      </span>
                      <small>
                        {cursor
                          ? `${cursor.path} · Ln ${cursor.position.lineNumber}, Col ${cursor.position.column}`
                          : candidate.currentFile ?? (candidate.online ? "Browsing" : "Offline")}
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
                      {item.path ? (
                        <button
                          className="activity-entry"
                          onClick={() => onOpenFile(item.path ?? "")}
                          title={`Open ${item.path}`}
                        >
                          <ActivityText item={item} />
                        </button>
                      ) : (
                        <span className="activity-entry">
                          <ActivityText item={item} />
                        </span>
                      )}
                    </li>
                  ))
                )}
              </ol>
            </div>
          </section>
        ) : null}

        {activeTab === "agent" ? (
          <AgentPanel
            projectId={projectId}
            member={member}
            members={members}
            refreshVersion={agentRefreshVersion}
            onOpenFile={onOpenFile}
            workspaceTree={workspaceTree}
            onError={onError}
          />
        ) : null}

        {activeTab === "project" ? (
          <section className="collab-section project-details" data-testid="project-panel">
            <h2>Project</h2>
            <dl className="session-facts">
              <div><dt>Room</dt><dd>{roomId}</dd></div>
              <div><dt>Workspace</dt><dd title={workspaceRoot}>{workspaceRoot}</dd></div>
              {member?.profileRole ? <div><dt>Your role</dt><dd>{member.profileRole}</dd></div> : null}
            </dl>
          </section>
        ) : null}
      </div>
    </div>
  );
}

function ChatAgentMessage({
  message,
  run,
  onOpenFile,
  onCancelAgentRun
}: {
  message: ChatMessage;
  run?: AgentRun;
  onOpenFile(path: string): void;
  onCancelAgentRun(runId: string): Promise<void>;
}) {
  const [expanded, setExpanded] = useState(false);
  const lines = message.text.split("\n");
  const canExpand = lines.length > 20;
  const visibleText = canExpand && !expanded ? lines.slice(0, 20).join("\n") : message.text;
  return (
    <>
      <p>{visibleText}</p>
      {canExpand ? (
        <button type="button" className="chat-output-toggle" onClick={() => setExpanded((current) => !current)}>
          {expanded ? "Collapse" : "Show full response"}
        </button>
      ) : null}
      {run ? (
        <article className="chat-agent-card" data-testid="chat-agent-card">
          <div><strong>Requested by {run.memberName ?? run.memberId}</strong><span>{run.status}</span></div>
          {run.fileChanges?.length ? (
            <ul>
              {run.fileChanges.map((change) => (
                <li key={change.file}>
                  <button type="button" onClick={() => onOpenFile(change.file)}>{change.file}</button>
                </li>
              ))}
            </ul>
          ) : <small>No file changes recorded.</small>}
          <div className="chat-agent-card-actions">
            <details>
              <summary>View trace</summary>
              <small>Open My Agent to inspect the complete trace.</small>
            </details>
            {run.status === "queued" || run.status === "running" ? (
              <button type="button" onClick={() => void onCancelAgentRun(run.id)}>Stop</button>
            ) : null}
          </div>
        </article>
      ) : null}
    </>
  );
}

function memberHandle(name: string) {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 32) || "member";
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
      return null;
    case "chat_message_created":
      return item(event, "general", `${stringValue(payload.authorName) ?? actor} sent a chat message`);
    case "terminal_input":
      return item(event, "general", `${actor} used the terminal`, { detail: `${numberValue(payload.count)} inputs` });
    case "file_changed": {
      const path = stringValue(payload.path);
      return item(event, "edit", `${actor} edited ${path ?? "a file"}`, {
        detail: formatEditDetail(payload),
        path,
        startedAt: stringValue(payload.startedAt),
        finishedAt: stringValue(payload.finishedAt)
      });
    }
    case "session_settings_updated":
      return item(event, "general", `${actor} updated session settings`);
    case "workspace_file_created": {
      const path = stringValue(payload.path);
      return item(event, "create", `${actor} created ${path ?? "a file"}`);
    }
    case "workspace_directory_created":
      return item(event, "create", `${actor} created folder ${stringValue(payload.path) ?? ""}`.trim());
    case "workspace_path_renamed": {
      const toPath = stringValue(payload.toPath);
      return item(
        event,
        "rename",
        `${actor} renamed ${stringValue(payload.fromPath) ?? "a path"} to ${toPath ?? "a new path"}`
      );
    }
    case "workspace_path_deleted":
      return item(event, "delete", `${actor} deleted ${stringValue(payload.path) ?? "a path"}`);
    case "agent_task_started": {
      const prompt = stringValue(payload.promptPreview);
      return item(
        event,
        "agent",
        `${actor} asked OpenCode to work on this project`,
        { detail: prompt ? `“${prompt}”` : stringValue(payload.sessionTitle) }
      );
    }
    case "agent_task_completed": {
      const files = fileChanges(payload.files);
      return item(
        event,
        "agent",
        `${actor}'s Agent task completed`,
        {
          detail: files.length ? formatAgentFiles(files) : "No files changed",
          path: files[0]?.file
        }
      );
    }
    case "agent_task_failed":
      return item(event, "agent", `${actor}'s Agent task failed`, {
        detail: stringValue(payload.error)
      });
    case "agent_task_cancelled":
      return item(event, "agent", `${actor}'s Agent task was cancelled`, {
        detail: stringValue(payload.reason)
      });
    default:
      return null;
  }
}

function item(
  event: EventRecord,
  kind: ActivityKind,
  text: string,
  options: {
    detail?: string;
    path?: string;
    startedAt?: string;
    finishedAt?: string;
  } = {}
): ActivityItem {
  return {
    id: event.id,
    kind,
    text,
    detail: options.detail,
    path: options.path,
    startedAt: options.startedAt,
    timestamp: options.finishedAt ?? event.timestamp
  };
}

function ActivityText({ item }: { item: ActivityItem }) {
  return (
    <>
      <strong>{item.text}</strong>
      {item.detail ? <small>{item.detail}</small> : null}
      <time>
        {item.startedAt
          ? `${formatTime(item.startedAt, true)}-${formatTime(item.timestamp, true)}`
          : formatTime(item.timestamp, true)}
      </time>
    </>
  );
}

function ActivityIcon({ kind }: { kind: ActivityKind }) {
  const props = { size: 14, "aria-hidden": true };
  if (kind === "join") return <LogIn {...props} />;
  if (kind === "leave") return <LogOut {...props} />;
  if (kind === "edit") return <FilePenLine {...props} />;
  if (kind === "create") return <FilePlus2 {...props} />;
  if (kind === "rename") return <Pencil {...props} />;
  if (kind === "delete") return <Trash2 {...props} />;
  if (kind === "agent") return <Bot {...props} />;
  if (kind === "general") return <Activity {...props} />;
  return <FolderPlus {...props} />;
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value : undefined;
}

function numberValue(value: unknown) {
  return typeof value === "number" ? value : 0;
}

interface AgentActivityFile {
  file: string;
  additions: number;
  deletions: number;
}

function fileChanges(value: unknown): AgentActivityFile[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const file = entry as Record<string, unknown>;
    const path = stringValue(file.file);
    if (!path) return [];
    return [{
      file: path,
      additions: numberValue(file.additions),
      deletions: numberValue(file.deletions)
    }];
  });
}

function formatAgentFiles(files: AgentActivityFile[]) {
  const additions = files.reduce((total, file) => total + file.additions, 0);
  const deletions = files.reduce((total, file) => total + file.deletions, 0);
  const summary = `${files.length} ${files.length === 1 ? "file" : "files"} changed · +${additions} / -${deletions}`;
  return files.length === 1 ? `${summary} · ${files[0]?.file}` : summary;
}

function formatEditDetail(payload: Record<string, unknown>) {
  if (!Array.isArray(payload.ranges)) return undefined;
  const ranges = payload.ranges.flatMap((value) => {
    if (!value || typeof value !== "object") return [];
    const range = value as Record<string, unknown>;
    const startLine = numberValue(range.startLine);
    const endLine = numberValue(range.endLine);
    if (startLine < 1 || endLine < startLine) return [];
    return [{ startLine, endLine }];
  });
  if (ranges.length === 0) return undefined;
  const label = ranges
    .map((range) =>
      range.startLine === range.endLine
        ? String(range.startLine)
        : `${range.startLine}-${range.endLine}`
    )
    .join(", ");
  const prefix = ranges.length === 1 && ranges[0]?.startLine === ranges[0]?.endLine
    ? "Line"
    : "Lines";
  const addedLines = numberValue(payload.addedLines);
  const removedLines = numberValue(payload.removedLines);
  if (addedLines > 0 || removedLines > 0) {
    return `${prefix} ${label} · +${addedLines} / -${removedLines}`;
  }
  const changedLines = ranges.reduce(
    (count, range) => count + range.endLine - range.startLine + 1,
    0
  );
  return `${prefix} ${label} · ${changedLines} ${changedLines === 1 ? "line" : "lines"} changed`;
}
