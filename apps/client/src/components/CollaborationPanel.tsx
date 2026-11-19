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
  ShieldAlert,
  Trash2,
  Users
} from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { AgentPanel, type AgentDraft } from "./AgentPanel";
import { downloadAgentTrace, getServerInfo, getConflictGuardState, sendConflictPairChat } from "../api";
import { ConflictGuardPanel } from "./ConflictGuardPanel";
import { conflictActionCount } from "../conflictGuardPresentation";
import type { ConflictGuardState } from "../conflictGuardTypes";
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
import { formatTime } from "../format";

type CollaborationTab = "chat" | "agent" | "team" | "project" | "conflict";
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
  onOpenSymbol,
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
  onOpenSymbol(file: string, line: number): void;
  onError(error: unknown): void;
  onLoadAgentTrace(runId: string): void;
  onCreateTeamAgent(name: string, description?: string): Promise<void>;
  onCancelAgentRun(runId: string): Promise<void>;
}) {
  const [activeTab, setActiveTab] = useState<CollaborationTab>("chat");
  const [agentDrafts, setAgentDrafts] = useState<Record<string, AgentDraft>>({});
  const [selectedAgentSessionId, setSelectedAgentSessionId] = useState<string>();
  const [conflictState, setConflictState] = useState<ConflictGuardState>();
  const errorHandler = useRef(onError);
  errorHandler.current = onError;
  useEffect(() => {
    setConflictState(undefined);
    if (!member) return;
    let active = true;
    let timer: number | undefined;
    async function refresh() {
      try {
        const state = await getConflictGuardState(projectId);
        if (active) setConflictState(state);
      } catch (error) {
        if (active) errorHandler.current(error);
      } finally {
        if (active) timer = window.setTimeout(() => { void refresh(); }, 1_000);
      }
    }
    void getServerInfo().then((info) => {
      if (!active || info.features.conflictGuard === "off") {
        if (active) setConflictState(undefined);
        return;
      }
      return refresh();
    }).catch((error) => errorHandler.current(error));
    return () => { active = false; if (timer !== undefined) window.clearTimeout(timer); };
  }, [projectId, member?.id]);
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
  const conflictCount = conflictState ? conflictActionCount(conflictState, member?.id) : 0;

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
      <div className="panel-header">协作</div>
      <nav className="collab-tabs" aria-label="协作分区">
        <button
          className={activeTab === "chat" ? "active" : ""}
          onClick={() => setActiveTab("chat")}
          data-testid="collab-tab-chat"
        >
          <MessageSquareText size={14} />
          聊天
        </button>
        <button
          className={activeTab === "agent" ? "active" : ""}
          onClick={() => setActiveTab("agent")}
          data-testid="collab-tab-agent"
        >
          <Bot size={14} />
          我的 Agent
        </button>
        <button
          className={activeTab === "project" ? "active" : ""}
          onClick={() => setActiveTab("project")}
          data-testid="collab-tab-project"
        >
          <Settings2 size={14} />
          项目
        </button>
        <button
          className={activeTab === "team" ? "active" : ""}
          onClick={() => setActiveTab("team")}
          data-testid="collab-tab-team"
        >
          <Users size={14} />
          团队
        </button>
        {conflictState ? <button className={activeTab === "conflict" ? "active" : ""} onClick={() => setActiveTab("conflict")} data-testid="collab-tab-conflict"><ShieldAlert size={14} aria-hidden="true" />冲突预防{conflictCount > 0 ? <span className="collab-tab-count" data-testid="conflict-tab-count" aria-label={`${conflictCount} 个待处理冲突`}>{conflictCount}</span> : null}</button> : null}
      </nav>

      <div className="collab-tab-body">
        {activeTab === "conflict" && conflictState ? <ConflictGuardPanel key={`${projectId}:${member?.id}`} state={conflictState} projectId={projectId} members={members} memberId={member?.id} onOpenSymbol={onOpenSymbol} onError={onError} onChat={(text, pairId) => { void sendConflictPairChat(projectId, pairId, text).catch(onError); setActiveTab("chat"); }} /> : null}
        {activeTab === "chat" ? (
          <section className="collab-section chat-section">
            <div className="team-agent-bar" data-testid="team-agent-bar">
              <strong>团队 Agent</strong>
              {teamAgents.map((agent) => {
                const active = agentRuns.some(
                  (run) => run.sessionId === agent.id && (run.status === "queued" || run.status === "running")
                );
                return (
                  <span key={agent.id} className="team-agent-status">
                    <Bot size={13} /> @{agent.handle ?? agent.title} · {active ? "运行中" : "空闲"}
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
                    void onCreateTeamAgent(teamAgentName.trim(), teamAgentDescription.trim() || undefined).then(() => {
                      setTeamAgentName("");
                      setTeamAgentDescription("");
                      setTeamAgentFormOpen(false);
                    }).catch(onError);
                  }}
                  placeholder="Agent 名称"
                  data-testid="team-agent-name"
                />
                <input
                  value={teamAgentDescription}
                  onChange={(event) => setTeamAgentDescription(event.target.value)}
                  placeholder="说明（可选）"
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
                >创建</button>
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
                <li className="empty-panel-state">在聊天里 @ 团队 Agent 来分配任务，所有人都能看到进度并继续指挥。</li>
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
                placeholder="给团队发消息，或用 @Agent 名称给共享 Agent 派任务"
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
                用 <code>/agent new reviewer code reviews</code> 创建共享 Agent，然后在聊天里用 <code>@reviewer</code> 指挥它。
              </small>
              <div className="chat-actions">
                <small id="chat-keyboard-hint">
                  Enter to send / Shift + Enter for new line
                </small>
                <button
                  onClick={onSendChat}
                  disabled={chatSending || chatText.trim().length === 0}
                  data-testid="send-chat"
                >
                  {chatSending ? "发送中" : "发送"}
                </button>
              </div>
            </div>
          </section>
        ) : null}

        {activeTab === "team" ? (
          <section className="collab-section team-section">
            <div className="team-block">
              <h2>成员</h2>
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
                                ? `停止跟随 ${candidate.displayName}`
                                : `跟随 ${candidate.displayName}`
                            }
                            title={
                              followingMemberId === candidate.id
                                ? "停止跟随"
                                : "跟随这位协作者"
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
                          ? `${cursor.path} · 第 ${cursor.position.lineNumber} 行，第 ${cursor.position.column} 列`
                          : candidate.currentFile ?? (candidate.online ? "浏览中" : "离线")}
                      </small>
                    </li>
                  );
                })}
              </ul>
            </div>

            <div className="team-block activity-block">
              <h2>动态</h2>
              <ol className="event-list" data-testid="activity-feed">
                {activityItems.length === 0 ? (
                  <li className="empty-panel-state">暂无动态。</li>
                ) : (
                  activityItems.map((item) => (
                    <li key={item.id}>
                      <ActivityIcon kind={item.kind} />
                      {item.path ? (
                        <button
                          className="activity-entry"
                          onClick={() => onOpenFile(item.path ?? "")}
                          title={`打开 ${item.path}`}
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
            <h2>项目</h2>
            <dl className="session-facts">
              <div><dt>房间</dt><dd>{roomId}</dd></div>
              <div><dt>工作区</dt><dd title={workspaceRoot}>{workspaceRoot}</dd></div>
              {member?.profileRole ? <div><dt>你的角色</dt><dd>{member.profileRole}</dd></div> : null}
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
  const [expanded, setExpanded] = useState(false);
  const lines = message.text.split("\n");
  const canExpand = lines.length > 20;
  const visibleText = canExpand && !expanded ? lines.slice(0, 20).join("\n") : message.text;
  const active = run?.status === "queued" || run?.status === "running";
  return (
    <>
      {showText ? <p>{visibleText}</p> : null}
      {showText && canExpand ? (
        <button type="button" className="chat-output-toggle" onClick={() => setExpanded((current) => !current)}>
          {expanded ? "收起" : "显示完整回复"}
        </button>
      ) : null}
      {run && showCard ? (
        <article className="chat-agent-card" data-testid="chat-agent-card">
          {!showText && run.status !== "completed" ? <AgentResponse run={run} /> : null}
          <AgentQuestions projectId={projectId} run={run} memberId={memberId} onError={onError} />
          <AgentRunProgress run={run} memberId={memberId} onCancel={active ? () => void onCancelAgentRun(run.id).catch(onError) : undefined} />
          <div><strong>发起人 {run.memberName ?? run.memberId}</strong><span>{run.interruptedByRunId ? `被 ${interruptedByName ?? run.interruptedByMemberId} 打断` : agentRunStatusText(run.status)}</span></div>
          {run.fileChanges?.length ? (
            <ul>
              {run.fileChanges.map((change) => (
                <li key={change.file}>
                  <button type="button" onClick={() => onOpenFile(change.file)}>{change.file}</button>
                </li>
              ))}
            </ul>
          ) : <small>这个 Agent 没有记录到文件修改。</small>}
          <AgentWorkDetails run={run} trace={trace} variant="team" onLoadTrace={() => onLoadAgentTrace(run.id)} />
          <div className="chat-agent-card-actions">
            <button
              type="button"
              className="chat-trace-download"
              onClick={() => void downloadAgentTrace(projectId, run.id).catch(onError)}
              title="下载完整轨迹"
              aria-label="下载完整轨迹"
            >
              <Download size={13} />
            </button>
            {run.status === "queued" || run.status === "running" ? (
              <button type="button" onClick={() => void onCancelAgentRun(run.id).catch(onError)}>停止</button>
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
    "一位协作者";

  switch (event.type) {
    case "room_created":
      return item(event, "general", `打开了会话 ${stringValue(payload.workspaceName) ?? "工作区"}`);
    case "member_joined":
      return item(event, "join", `${stringValue(payload.name) ?? actor} 加入了会话`);
    case "member_rejoined":
      return item(
        event,
        "join",
        numberValue(payload.connectionCount) > 1
          ? `${stringValue(payload.name) ?? actor} 打开了另一个标签页`
          : `${stringValue(payload.name) ?? actor} 重新加入了会话`
      );
    case "member_online":
      return item(event, "join", `${actor} 上线了`);
    case "member_offline":
      return item(event, "leave", `${actor} 离开了会话`);
    case "file_opened":
      return null;
    case "chat_message_created":
      return item(event, "general", `${stringValue(payload.authorName) ?? actor} 发送了一条消息`);
    case "terminal_input":
      return item(event, "general", `${actor} 在终端中输入`, { detail: `${numberValue(payload.count)} 次输入` });
    case "file_changed": {
      const path = stringValue(payload.path);
      return item(event, "edit", `${actor} 编辑了 ${path ?? "一个文件"}`, {
        detail: formatEditDetail(payload),
        path,
        startedAt: stringValue(payload.startedAt),
        finishedAt: stringValue(payload.finishedAt)
      });
    }
    case "session_settings_updated":
      return item(event, "general", `${actor} 更新了会话设置`);
    case "workspace_file_created": {
      const path = stringValue(payload.path);
      return item(event, "create", `${actor} 新建了 ${path ?? "一个文件"}`);
    }
    case "workspace_directory_created":
      return item(event, "create", `${actor} 新建了文件夹 ${stringValue(payload.path) ?? ""}`.trim());
    case "workspace_path_renamed": {
      const toPath = stringValue(payload.toPath);
      return item(
        event,
        "rename",
        `${actor} 把 ${stringValue(payload.fromPath) ?? "一个路径"} 重命名为 ${toPath ?? "新路径"}`
      );
    }
    case "workspace_path_deleted":
      return item(event, "delete", `${actor} 删除了 ${stringValue(payload.path) ?? "一个路径"}`);
    case "agent_task_started": {
      const prompt = stringValue(payload.promptPreview);
      return item(
        event,
        "agent",
        `${actor} 给 Agent 派发了任务`,
        { detail: prompt ? `“${prompt}”` : stringValue(payload.sessionTitle) }
      );
    }
    case "agent_task_completed": {
      const files = fileChanges(payload.files);
      return item(
        event,
        "agent",
        `${actor} 的 Agent 任务已完成`,
        {
          detail: files.length ? formatAgentFiles(files) : "没有修改文件",
          path: files[0]?.file
        }
      );
    }
    case "agent_task_failed":
      return item(event, "agent", `${actor} 的 Agent 任务失败`, {
        detail: stringValue(payload.error)
      });
    case "agent_task_cancelled":
      return item(event, "agent", `${actor} 的 Agent 任务已取消`, {
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

function agentRunStatusText(status: string) {
  return ({ queued: "排队中", running: "运行中", completed: "已完成", failed: "失败", cancelled: "已取消", interrupted: "已打断" } as Record<string, string>)[status] ?? status;
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
  const summary = `修改 ${files.length} 个文件 · +${additions} / -${deletions}`;
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
    ? "第"
    : "第";
  const addedLines = numberValue(payload.addedLines);
  const removedLines = numberValue(payload.removedLines);
  if (addedLines > 0 || removedLines > 0) {
    return `${prefix} ${label} 行 · +${addedLines} / -${removedLines}`;
  }
  const changedLines = ranges.reduce(
    (count, range) => count + range.endLine - range.startLine + 1,
    0
  );
  return `${prefix} ${label} 行 · 改动 ${changedLines} 行`;
}
