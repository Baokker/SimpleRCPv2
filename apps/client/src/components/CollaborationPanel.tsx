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
  Pencil,
  Settings2,
  Trash2,
  Users
} from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { AgentPanel } from "./AgentPanel";
import type {
  ChatMessage,
  EventRecord,
  RemoteCursor,
  RoomMember,
  WorkspaceNode
} from "../types";
import { formatTime } from "../format";
import { getGuardRoles, setTerminalControl, updateMyRole, replyGuardApproval, type GuardScenarioRole } from "../api";
import type { GuardApproval } from "../types";

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
  guardApprovals = [],
  onApprovalResolved,
  controlHolderMemberId,
  onControlState
}: {
  members: RoomMember[];
  events: EventRecord[];
  chatMessages: ChatMessage[];
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
  guardApprovals?: GuardApproval[];
  onApprovalResolved?(): void;
  controlHolderMemberId?: string | null;
  onControlState?(holderMemberId: string | null): void;
}) {
  const [activeTab, setActiveTab] = useState<CollaborationTab>("chat");
  const [unseenMessages, setUnseenMessages] = useState(0);
  const [scenarioRoles, setScenarioRoles] = useState<GuardScenarioRole[]>([]);
  useEffect(() => { void getGuardRoles().then((result) => setScenarioRoles(result.scenarios)); }, []);
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
          Agent
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
                <li className="empty-panel-state">No messages yet.</li>
              ) : (
                chatMessages.map((message) => (
                  <li key={message.id} className="chat-message">
                    <span>
                      <strong>
                        {message.authorName}
                        {message.authorRole ? ` · ${message.authorRole}` : ""}
                      </strong>
                      <time>{formatTime(message.timestamp)}</time>
                    </span>
                    <p>{message.text}</p>
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
                placeholder="Message collaborators"
                aria-describedby="chat-keyboard-hint"
                data-testid="chat-input"
              />
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
                        {candidate.id === member?.id ? (
                          <label className="member-role-editor"><select aria-label="Your role" value={candidate.profileRole ?? ""} onChange={(event) => void updateMyRole(projectId, event.target.value).catch(onError)}><option value="">Unassigned (collaborator)</option>{groupRoles(scenarioRoles).map(([scenario, entries]) => <optgroup key={scenario} label={scenario}>{entries.map((entry) => <option key={entry.role} value={entry.role}>{entry.role} ({entry.level})</option>)}</optgroup>)}</select></label>
                        ) : <em>{candidate.profileRole || "unassigned"}</em>}
                        {candidate.id !== member?.id ? candidate.profileRole ? <em>({scenarioRoles.find((role) => role.role === candidate.profileRole)?.level ?? "collaborator"})</em> : <em>(collaborator)</em> : null}
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
                        {member && scenarioRoles.some((role) => role.role === (member.profileRole ?? "") && role.level === "owner") ? (
                          <button type="button" className="member-control" onClick={() => void setTerminalControl(projectId, controlHolderMemberId === candidate.id ? null : candidate.id).then((state) => onControlState?.(state.holderMemberId)).catch(onError)}>
                            {controlHolderMemberId === candidate.id ? "Revoke control" : "Grant interactive control"}
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
              {guardApprovals.filter((approval) => approval.approverIds.includes(member?.id ?? "")).map((approval) => (
                <div key={approval.id} className="guard-approval-card"><strong>{approval.request.source} approval</strong><code>{approval.request.command ?? approval.request.paths?.join(", ")}</code><small>{approval.decision.matchedRules.join(", ")}</small><div><button type="button" onClick={() => void replyGuardApproval(projectId, approval.id, true).then(() => onApprovalResolved?.()).catch(onError)}>Approve</button><button type="button" onClick={() => void replyGuardApproval(projectId, approval.id, false).then(() => onApprovalResolved?.()).catch(onError)}>Reject</button></div></div>
              ))}
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
    case "guard_action":
      return item(event, "general", `${actor}'s terminal or Agent request was ${stringValue(payload.action) ?? "checked"}`, {
        detail: stringValue(payload.command) ?? (Array.isArray(payload.paths) ? payload.paths.join(", ") : undefined)
      });
    case "guard_approval":
      return item(event, "general", `${actor}'s request was ${payload.approved ? "approved" : "rejected"}`, {
        detail: stringValue(payload.command) ?? (Array.isArray(payload.paths) ? payload.paths.join(", ") : undefined)
      });
    case "terminal_control_granted":
      return item(event, "general", `${actor} received interactive terminal control`);
    case "terminal_control_revoked":
    case "terminal_control_expired":
      return item(event, "general", `${actor}'s interactive terminal control ended`);
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

function groupRoles(entries: GuardScenarioRole[]) {
  const groups = new Map<string, GuardScenarioRole[]>();
  for (const entry of entries) {
    groups.set(entry.scenario, [...(groups.get(entry.scenario) ?? []), entry]);
  }
  return [...groups.entries()];
}
