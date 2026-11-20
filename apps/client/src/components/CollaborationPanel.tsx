import {
  Activity,
  Bot,
  Download,
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
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { AgentPanel, type AgentDraft } from "./AgentPanel";
import { downloadAgentTrace, retryAgentRun } from "../api";
import { AgentRunProgress } from "./AgentRunProgress";
import { AgentQuestions } from "./AgentQuestions";
import { AgentResponse } from "./AgentResponse";
import { AgentWorkDetails } from "./AgentWorkDetails";
import type {
  AgentRun,
  AgentSession,
  AgentTraceEvent,
  ChatMessage,
  EventRecord,
  RemoteCursor,
  RoomMember,
  WorkspaceNode
} from "../types";
import { formatTime, runStatusText } from "../format";
import { useI18n } from "../i18n";
import { richParts, serverText, type Translate } from "../i18n/messages";

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
  agentTraces,
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
  followingMemberId,
  onFollowMember,
  onOpenFile,
  onError,
  onLoadAgentTrace,
  onCreateTeamAgent,
  onCancelAgentRun
}: {
  members: RoomMember[];
  events: EventRecord[];
  chatMessages: ChatMessage[];
  teamAgents: AgentSession[];
  agentRuns: AgentRun[];
  agentTraces: Record<string, AgentTraceEvent[]>;
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
  followingMemberId?: string;
  onFollowMember(memberId: string): void;
  onOpenFile(path: string): void;
  onError(error: unknown): void;
  onLoadAgentTrace(runId: string): void;
  onCreateTeamAgent(name: string, description?: string): Promise<void>;
  onCancelAgentRun(runId: string): Promise<void>;
}) {
  const { locale, t } = useI18n();
  const [activeTab, setActiveTab] = useState<CollaborationTab>("chat");
  const [agentDrafts, setAgentDrafts] = useState<Record<string, AgentDraft>>({});
  const [selectedAgentSessionId, setSelectedAgentSessionId] = useState<string>();
  const [teamAgentFormOpen, setTeamAgentFormOpen] = useState(false);
  const [teamAgentName, setTeamAgentName] = useState("");
  const [teamAgentDescription, setTeamAgentDescription] = useState("");
  const [unseenMessages, setUnseenMessages] = useState(0);
  const chatTranscriptRef = useRef<HTMLOListElement>(null);
  const stickToLatestRef = useRef(true);
  const previousMessageCountRef = useRef(chatMessages.length);
  const activityItems = useMemo(
    () =>
      events
        .flatMap((event) => {
          const item = formatActivity(t, event, members);
          return item ? [item] : [];
        })
        .slice(-30)
        .reverse(),
    [events, members, t]
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
      <div className="panel-header">{t("collaboration")}</div>
      <nav className="collab-tabs" aria-label={t("collaborationSections")}>
        <button
          className={activeTab === "chat" ? "active" : ""}
          onClick={() => setActiveTab("chat")}
          data-testid="collab-tab-chat"
        >
          <MessageSquareText size={14} />
          {t("chat")}
        </button>
        <button
          className={activeTab === "agent" ? "active" : ""}
          onClick={() => setActiveTab("agent")}
          data-testid="collab-tab-agent"
        >
          <Bot size={14} />
          {t("myAgent")}
        </button>
        <button
          className={activeTab === "project" ? "active" : ""}
          onClick={() => setActiveTab("project")}
          data-testid="collab-tab-project"
        >
          <Settings2 size={14} />
          {t("project")}
        </button>
        <button
          className={activeTab === "team" ? "active" : ""}
          onClick={() => setActiveTab("team")}
          data-testid="collab-tab-team"
        >
          <Users size={14} />
          {t("team")}
        </button>
      </nav>

      <div className="collab-tab-body">
        {activeTab === "chat" ? (
          <section className="collab-section chat-section">
            <div className="team-agent-bar" data-testid="team-agent-bar">
              <strong>{t("teamAgents")}</strong>
              {teamAgents.map((agent) => {
                const active = agentRuns.some(
                  (run) => run.sessionId === agent.id && (run.status === "queued" || run.status === "running")
                );
                return (
                  <span key={agent.id} className="team-agent-status">
                    <Bot size={13} /> @{agent.handle ?? agent.title} · {t(active ? "running" : "idle")}
                  </span>
                );
              })}
              <button type="button" data-testid="team-agent-create" onClick={() => setTeamAgentFormOpen((current) => !current)}>
                <Plus size={13} /> {t("createTeamAgent")}
              </button>
            </div>
            {teamAgentFormOpen ? (
              <div className="team-agent-create">
                <input
                  value={teamAgentName}
                  onChange={(event) => setTeamAgentName(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key !== "Enter" || !teamAgentName.trim()) return;
                    void onCreateTeamAgent(teamAgentName.trim(), teamAgentDescription.trim() || undefined).then(() => {
                      setTeamAgentName("");
                      setTeamAgentDescription("");
                      setTeamAgentFormOpen(false);
                    }).catch(onError);
                  }}
                  placeholder={t("agentName")}
                  data-testid="team-agent-name"
                />
                <input
                  value={teamAgentDescription}
                  onChange={(event) => setTeamAgentDescription(event.target.value)}
                  placeholder={t("optionalDescription")}
                  data-testid="team-agent-description"
                />
                <button
                  type="button"
                  disabled={!teamAgentName.trim()}
                  onClick={() => void onCreateTeamAgent(teamAgentName.trim(), teamAgentDescription.trim() || undefined).then(() => {
                    setTeamAgentName("");
                    setTeamAgentDescription("");
                    setTeamAgentFormOpen(false);
                  }).catch(onError)}
                >{t("create")}</button>
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
                <li className="empty-panel-state">{t("teamAgentHint")}</li>
              ) : (
                chatMessages.map((message) => (
                  <li key={message.id} className={`chat-message chat-message-${message.kind ?? "member"}`}>
                    <span>
                      <strong>
                        {message.kind === "agent" ? <Bot size={13} /> : null}
                        {message.kind === "system" && message.authorName === "System" ? t("system") : message.authorName}
                        {message.authorRole ? ` · ${message.authorRole}` : ""}
                      </strong>
                      <time>{formatTime(locale, message.timestamp)}</time>
                    </span>
                    {message.kind === "system" ? (
                      <p className="chat-system-message">{serverText(t, message.text)}</p>
                    ) : message.kind === "agent" ? (
                      <ChatAgentMessage
                        message={message}
                        run={message.runId ? runsById.get(message.runId) : undefined}
                        trace={message.runId ? agentTraces[message.runId] ?? [] : []}
                        projectId={projectId}
                        showCard={false}
                        memberId={member?.id}
                        onOpenFile={onOpenFile}
                        onError={onError}
                        onLoadAgentTrace={onLoadAgentTrace}
                        interruptedByName={members.find((candidate) => candidate.id === runsById.get(message.runId ?? "")?.interruptedByMemberId)?.displayName}
                        onCancelAgentRun={onCancelAgentRun}
                      />
                    ) : (
                      <>
                        <p>{message.text}</p>
                        {message.runId ? (
                          <ChatAgentMessage
                            message={message}
                            run={runsById.get(message.runId)}
                            trace={agentTraces[message.runId] ?? []}
                            projectId={projectId}
                            showText={false}
                            memberId={member?.id}
                            onOpenFile={onOpenFile}
                            onError={onError}
                            onLoadAgentTrace={onLoadAgentTrace}
                            interruptedByName={members.find((candidate) => candidate.id === runsById.get(message.runId ?? "")?.interruptedByMemberId)?.displayName}
                            onCancelAgentRun={onCancelAgentRun}
                          />
                        ) : null}
                      </>
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
                {unseenMessages === 1 ? t("oneNewMessage") : t("newMessages", { count: unseenMessages })}
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
                placeholder={t("teamChatPlaceholder")}
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
              <small className="chat-command-hint" data-testid="chat-command-hint">
                {richParts(locale, "createSharedAgentHint", {
                  command: <code key="command">/agent new reviewer code reviews</code>,
                  mention: <code key="mention">@reviewer</code>
                })}
              </small>
              <div className="chat-actions">
                <small id="chat-keyboard-hint">
                  {t("chatKeyboardHint")}
                </small>
                <button
                  onClick={onSendChat}
                  disabled={chatSending || chatText.trim().length === 0}
                  data-testid="send-chat"
                >
                  {t(chatSending ? "sending" : "send")}
                </button>
              </div>
            </div>
          </section>
        ) : null}

        {activeTab === "team" ? (
          <section className="collab-section team-section">
            <div className="team-block">
              <h2>{t("people")}</h2>
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
                          <em>{t("openTabs", { count: candidate.connectionCount })}</em>
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
                                ? t("stopFollowingName", { name: candidate.displayName })
                                : t("followName", { name: candidate.displayName })
                            }
                            title={
                              followingMemberId === candidate.id
                                ? t("stopFollowing")
                                : t("followCollaborator")
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
                          ? t("cursorLocation", { path: cursor.path, line: cursor.position.lineNumber, column: cursor.position.column })
                          : candidate.currentFile ?? t(candidate.online ? "browsing" : "offline")}
                      </small>
                    </li>
                  );
                })}
              </ul>
            </div>

            <div className="team-block activity-block">
              <h2>{t("activity")}</h2>
              <ol className="event-list" data-testid="activity-feed">
                {activityItems.length === 0 ? (
                  <li className="empty-panel-state">{t("noActivity")}</li>
                ) : (
                  activityItems.map((item) => (
                    <li key={item.id}>
                      <ActivityIcon kind={item.kind} />
                      {item.path ? (
                        <button
                          className="activity-entry"
                          onClick={() => onOpenFile(item.path ?? "")}
                          title={t("openPath", { path: item.path })}
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
            liveRuns={agentRuns}
            drafts={agentDrafts}
            setDrafts={setAgentDrafts}
            selectedSessionId={selectedAgentSessionId}
            setSelectedSessionId={setSelectedAgentSessionId}
            traces={agentTraces}
            onOpenFile={onOpenFile}
            workspaceTree={workspaceTree}
            onError={onError}
            onLoadTrace={onLoadAgentTrace}
          />
        ) : null}

        {activeTab === "project" ? (
          <section className="collab-section project-details" data-testid="project-panel">
            <h2>{t("project")}</h2>
            <dl className="session-facts">
              <div><dt>{t("room")}</dt><dd>{roomId}</dd></div>
              <div><dt>{t("workspace")}</dt><dd title={workspaceRoot}>{workspaceRoot}</dd></div>
              {member?.profileRole ? <div><dt>{t("yourRole")}</dt><dd>{member.profileRole}</dd></div> : null}
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
  trace,
  projectId,
  showText = true,
  showCard = true,
  onOpenFile,
  onError,
  onLoadAgentTrace,
  interruptedByName,
  onCancelAgentRun,
  memberId
}: {
  message: ChatMessage;
  run?: AgentRun;
  trace: AgentTraceEvent[];
  projectId: string;
  showText?: boolean;
  showCard?: boolean;
  onOpenFile(path: string): void;
  onError(error: unknown): void;
  onLoadAgentTrace(runId: string): void;
  interruptedByName?: string;
  memberId?: string;
  onCancelAgentRun(runId: string): Promise<void>;
}) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [retrying, setRetrying] = useState(false);
  async function stopRun() {
    if (!run || stopping) return;
    setStopping(true);
    try { await onCancelAgentRun(run.id); }
    catch (error) { onError(error); }
    finally { setStopping(false); }
  }
  async function retryRun() {
    if (!run || retrying) return;
    setRetrying(true);
    try { await retryAgentRun(projectId, run.id); }
    catch (error) { onError(error); }
    finally { setRetrying(false); }
  }
  const lines = message.text.split("\n");
  const canExpand = lines.length > 20;
  const visibleText = canExpand && !expanded ? lines.slice(0, 20).join("\n") : message.text;
  const active = run?.status === "queued" || run?.status === "running";
  return (
    <>
      {showText ? <p>{visibleText}</p> : null}
      {showText && canExpand ? (
        <button type="button" className="chat-output-toggle" onClick={() => setExpanded((current) => !current)}>
          {t(expanded ? "collapse" : "showFullResponse")}
        </button>
      ) : null}
      {run && showCard ? (
        <article className="chat-agent-card" data-testid="chat-agent-card">
          {!showText && run.status !== "completed" ? <AgentResponse run={run} /> : null}
          <AgentQuestions projectId={projectId} run={run} memberId={memberId} onError={onError} />
          <AgentRunProgress run={run} memberId={memberId} onCancel={active && !stopping ? () => void stopRun() : undefined} onRetry={run.memberId === memberId && !retrying ? () => void retryRun() : undefined} />
          <div>
            <strong>{t("requestedBy", { name: run.memberName ?? run.memberId })}</strong>
            <span>{run.interruptedByRunId
              ? t("interruptedBy", { name: interruptedByName ?? run.interruptedByMemberId ?? t("collaborator") })
              : runStatusText(t, run.status)}</span>
          </div>
          {run.fileChanges?.length ? (
            <ul>
              {run.fileChanges.map((change) => (
                <li key={change.file}>
                  <button type="button" onClick={() => onOpenFile(change.file)}>{change.file}</button>
                </li>
              ))}
            </ul>
          ) : <small>{t("noFileChangesRecorded")}</small>}
          <AgentWorkDetails run={run} trace={trace} variant="team" onLoadTrace={() => onLoadAgentTrace(run.id)} />
          <div className="chat-agent-card-actions">
            <button
              type="button"
              className="chat-trace-download"
              onClick={() => void downloadAgentTrace(projectId, run.id).catch(onError)}
              title={t("downloadCompleteTrace")}
              aria-label={t("downloadCompleteTrace")}
            >
              <Download size={13} />
            </button>
            {run.status === "queued" || run.status === "running" ? (
              <button type="button" disabled={stopping} onClick={() => void stopRun()}>{t(stopping ? "stopping" : "stopTask")}</button>
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
  t: Translate,
  event: EventRecord,
  members: RoomMember[]
): ActivityItem | null {
  const payload = event.payload ?? {};
  const actor =
    members.find((member) => member.id === event.memberId)?.displayName ??
    stringValue(payload.name) ??
    t("anotherCollaborator");

  switch (event.type) {
    case "room_created":
      return item(event, "general", t("activitySessionOpened", { workspace: stringValue(payload.workspaceName) ?? t("workspace") }));
    case "member_joined":
      return item(event, "join", t("activityJoined", { name: stringValue(payload.name) ?? actor }));
    case "member_rejoined":
      return item(
        event,
        "join",
        t(numberValue(payload.connectionCount) > 1 ? "activityAnotherTab" : "activityRejoined", { name: stringValue(payload.name) ?? actor })
      );
    case "member_online":
      return item(event, "join", t("activityOnline", { name: actor }));
    case "member_offline":
      return item(event, "leave", t("activityLeft", { name: actor }));
    case "file_opened":
      return null;
    case "chat_message_created":
      return item(event, "general", t("activityChat", { name: stringValue(payload.authorName) ?? actor }));
    case "terminal_input":
      return item(event, "general", t("activityTerminal", { name: actor }), { detail: t("terminalInputs", { count: numberValue(payload.count) }) });
    case "file_changed": {
      const path = stringValue(payload.path);
      return item(event, "edit", t("activityEdited", { name: actor, path: path ?? t("unnamedFile") }), {
        detail: formatEditDetail(t, payload),
        path,
        startedAt: stringValue(payload.startedAt),
        finishedAt: stringValue(payload.finishedAt)
      });
    }
    case "session_settings_updated":
      return item(event, "general", t("activitySettings", { name: actor }));
    case "workspace_file_created": {
      const path = stringValue(payload.path);
      return item(event, "create", t("activityCreated", { name: actor, path: path ?? t("unnamedFile") }));
    }
    case "workspace_directory_created":
      return item(event, "create", t("activityFolder", { name: actor, path: stringValue(payload.path) ?? "" }).trim());
    case "workspace_path_renamed": {
      const toPath = stringValue(payload.toPath);
      return item(
        event,
        "rename",
        t("activityRenamed", { name: actor, from: stringValue(payload.fromPath) ?? t("unnamedPath"), to: toPath ?? t("newPath") })
      );
    }
    case "workspace_path_deleted":
      return item(event, "delete", t("activityDeleted", { name: actor, path: stringValue(payload.path) ?? t("unnamedPath") }));
    case "agent_task_started": {
      const prompt = stringValue(payload.promptPreview);
      return item(
        event,
        "agent",
        t("activityAgentStarted", { name: actor }),
        { detail: prompt ?? stringValue(payload.sessionTitle) }
      );
    }
    case "agent_task_completed": {
      const files = fileChanges(payload.files);
      return item(
        event,
        "agent",
        t("activityAgentCompleted", { name: actor }),
        {
          detail: files.length ? formatAgentFiles(t, files) : t("noFilesChanged"),
          path: files[0]?.file
        }
      );
    }
    case "agent_task_failed":
      return item(event, "agent", t("activityAgentFailed", { name: actor }), {
        detail: serverText(t, stringValue(payload.error) ?? "")
      });
    case "agent_task_cancelled": {
      const reason = stringValue(payload.reason);
      return item(event, "agent", t("activityAgentCancelled", { name: actor }), {
        detail: reason === "interrupted" || reason === "cancelled" ? t(reason) : reason
      });
    }
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
  const { locale, t } = useI18n();
  const end = formatTime(locale, item.timestamp, true);
  return (
    <>
      <strong>{item.text}</strong>
      {item.detail ? <small>{item.detail}</small> : null}
      <time>
        {item.startedAt
          ? t("timeRange", { start: formatTime(locale, item.startedAt, true), end })
          : end}
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

function formatAgentFiles(t: Translate, files: AgentActivityFile[]) {
  const additions = files.reduce((total, file) => total + file.additions, 0);
  const deletions = files.reduce((total, file) => total + file.deletions, 0);
  const file = files.length === 1 ? files[0] : undefined;
  return file
    ? t("agentFilesOne", { added: additions, removed: deletions, path: file.file })
    : t("agentFilesMany", { count: files.length, added: additions, removed: deletions });
}

function formatEditDetail(t: Translate, payload: Record<string, unknown>) {
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
  const singleLine = ranges.length === 1 && ranges[0]?.startLine === ranges[0]?.endLine;
  const addedLines = numberValue(payload.addedLines);
  const removedLines = numberValue(payload.removedLines);
  if (addedLines > 0 || removedLines > 0) {
    return t(singleLine ? "editDiffLine" : "editDiffLines", { lines: label, added: addedLines, removed: removedLines });
  }
  const changedLines = ranges.reduce(
    (count, range) => count + range.endLine - range.startLine + 1,
    0
  );
  return t(singleLine ? "editChangedLine" : "editChangedLines", { lines: label, count: changedLines });
}
