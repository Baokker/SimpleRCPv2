import { OTHERS_CHANGED_NOTE, splitAgentChanges } from "../agentFiles";
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
import { downloadAgentTrace, restoreGuardSnapshot, retryAgentRun } from "../api";
import { AgentRunProgress } from "./AgentRunProgress";
import { AgentQuestions } from "./AgentQuestions";
import { AgentResponse } from "./AgentResponse";
import { AgentWorkDetails } from "./AgentWorkDetails";
import { GuardApprovalActions } from "./GuardApprovalActions";
import { guardActionWord, guardLevelText, guardReasonText, guardRecommendationText, guardRiskText } from "../guardText";
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
import { setTerminalControl, updateMyRole, updateMemberRole, replyGuardApproval, withdrawGuardApproval, type GuardScenarioRole } from "../api";
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
  snapshotId?: string;
  snapshotMemberId?: string;
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
  guardApprovals = [],
  scenarioRoles = [],
  unreadApprovalCount = 0,
  llmJudging = false,
  onApprovalSeen,
  onApprovalResolved,
  controlHolderMemberId,
  onControlState,
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
  guardApprovals?: GuardApproval[];
  scenarioRoles?: GuardScenarioRole[];
  unreadApprovalCount?: number;
  llmJudging?: boolean;
  onApprovalSeen?(approvalId: string): void;
  onApprovalResolved?(): void;
  controlHolderMemberId?: string | null;
  onControlState?(holderMemberId: string | null): void;
  onLoadAgentTrace(runId: string): void;
  onCreateTeamAgent(name: string, description?: string): Promise<void>;
  onCancelAgentRun(runId: string): Promise<void>;
}) {
  const [activeTab, setActiveTab] = useState<CollaborationTab>("chat");
  const [agentDrafts, setAgentDrafts] = useState<Record<string, AgentDraft>>({});
  const [selectedAgentSessionId, setSelectedAgentSessionId] = useState<string>();
  const [teamAgentFormOpen, setTeamAgentFormOpen] = useState(false);
  const [teamAgentName, setTeamAgentName] = useState("");
  const [teamAgentDescription, setTeamAgentDescription] = useState("");
  const [unseenMessages, setUnseenMessages] = useState(0);
  const [replyingApprovalId, setReplyingApprovalId] = useState<string>();
  const [restoringSnapshotId, setRestoringSnapshotId] = useState<string>();
  const restoredSnapshotIds = useMemo(
    () => new Set(events.filter((event) => event.type === "guard_snapshot_restored").map((event) => String(event.payload?.snapshotId ?? ""))),
    [events]
  );
  const [clock, setClock] = useState(() => Date.now());
  function selectTab(tab: CollaborationTab) {
    setActiveTab(tab);
  }
  function changeRole(role: string) {
    const selected = scenarioRoles.find((entry) => entry.role === role);
    if (selected?.level === "owner" && !owner && !window.confirm("Set your role to owner? This grants project control and approval rights.")) return;
    void updateMyRole(projectId, role).catch(onError);
  }
  function grantRole(memberId: string, role: string) {
    void updateMemberRole(projectId, memberId, role).catch(onError);
  }
  const levelOf = (role: string | undefined) => scenarioRoles.find((entry) => entry.role === role)?.level ?? (LEVEL_ORDER.includes(role as GuardScenarioRole["level"]) ? role as GuardScenarioRole["level"] : "collaborator");
  const otherOwnerPresent = members.some((candidate) => candidate.id !== member?.id && levelOf(candidate.profileRole) === "owner");
  // Mirrors the server rule: without another owner, any role may be claimed; otherwise only equal or lower levels.
  const canSelfAssign = (role: string) => !otherOwnerPresent || LEVEL_ORDER.indexOf(levelOf(role)) <= LEVEL_ORDER.indexOf(levelOf(member?.profileRole));
  function roleOptions(isAllowed: (role: string) => boolean) {
    return <><option value="" disabled={!isAllowed("")}>Unassigned (collaborator)</option>{groupRoles(scenarioRoles).map(([scenario, entries]) => <optgroup key={scenario} label={entries[0]?.scenarioDisplayName ?? scenario}>{entries.map((entry) => <option key={entry.role} value={entry.role} disabled={!isAllowed(entry.role)}>{entry.displayName} — {entry.level}</option>)}</optgroup>)}</>;
  }
  const chatTranscriptRef = useRef<HTMLOListElement>(null);
  const stickToLatestRef = useRef(true);
  const previousMessageCountRef = useRef(chatMessages.length);
  const owner = scenarioRoles.some((role) => role.role === member?.profileRole && role.level === "owner");
  const visibleApprovals = useMemo(() => guardApprovals.filter((approval) => approval.noApprover && approval.request.memberId === member?.id || approval.approverIds.includes(member?.id ?? "") || (owner && approval.decision.approvers === "owners")), [guardApprovals, member?.id, owner]);
  useEffect(() => {
    if (activeTab !== "team") return;
    for (const approval of visibleApprovals) onApprovalSeen?.(approval.id);
  }, [activeTab, onApprovalSeen, visibleApprovals]);
  useEffect(() => {
    if (visibleApprovals.length === 0) return;
    const timer = window.setInterval(() => setClock(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [visibleApprovals.length]);
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
          onClick={() => selectTab("chat")}
          data-testid="collab-tab-chat"
        >
          <MessageSquareText size={14} />
          Chat
        </button>
        <button
          className={activeTab === "agent" ? "active" : ""}
          onClick={() => selectTab("agent")}
          data-testid="collab-tab-agent"
        >
          <Bot size={14} />
          My Agent
        </button>
        <button
          className={activeTab === "project" ? "active" : ""}
          onClick={() => selectTab("project")}
          data-testid="collab-tab-project"
        >
          <Settings2 size={14} />
          Project
        </button>
        <button
          className={activeTab === "team" ? "active" : ""}
          onClick={() => selectTab("team")}
          data-testid="collab-tab-team"
        >
          <Users size={14} />
          Team
          {unreadApprovalCount > 0 ? <span className="collab-tab-badge" aria-label={`${unreadApprovalCount} pending approvals`}>{unreadApprovalCount > 99 ? "99+" : unreadApprovalCount}</span> : null}
        </button>
      </nav>
      {activeTab !== "team" && visibleApprovals.length > 0 ? (
        // Approvals expire after a timeout, so they stay visible while another tab is open.
        <button type="button" className="collab-approval-banner" onClick={() => selectTab("team")} data-testid="collab-approval-banner">
          有 {visibleApprovals.length} 条审批等你处理，点这里到 Team 标签页批准或拒绝。
        </button>
      ) : null}

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
                    void onCreateTeamAgent(teamAgentName.trim(), teamAgentDescription.trim() || undefined).then(() => {
                      setTeamAgentName("");
                      setTeamAgentDescription("");
                      setTeamAgentFormOpen(false);
                    }).catch(onError);
                  }}
                  placeholder="Agent name"
                  data-testid="team-agent-name"
                />
                <input
                  value={teamAgentDescription}
                  onChange={(event) => setTeamAgentDescription(event.target.value)}
                  placeholder="Description (optional)"
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
              <small className="chat-command-hint" data-testid="chat-command-hint">
                Create a shared Agent with <code>/agent new reviewer code reviews</code>, then mention <code>@reviewer</code> in Chat.
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
                          <label className="member-role-editor" title={otherOwnerPresent ? "Higher roles are granted by an owner" : undefined}><select aria-label="Your role" value={candidate.profileRole ?? ""} onChange={(event) => changeRole(event.target.value)}>{roleOptions(canSelfAssign)}</select></label>
                        ) : owner ? (
                          <label className="member-role-editor"><select aria-label={`Role of ${candidate.displayName}`} value={candidate.profileRole ?? ""} onChange={(event) => grantRole(candidate.id, event.target.value)}>{roleOptions(() => true)}</select></label>
                        ) : <em>{scenarioRoles.find((role) => role.role === candidate.profileRole)?.displayName ?? candidate.profileRole ?? "Unassigned"}</em>}
                        {candidate.id !== member?.id && !owner ? candidate.profileRole ? <em>({scenarioRoles.find((role) => role.role === candidate.profileRole)?.level ?? "collaborator"})</em> : <em>(collaborator)</em> : null}
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
                        {member && scenarioRoles.some((role) => role.role === (member.profileRole ?? "") && role.level === "owner") && (candidate.online || candidate.id === member.id) && (!controlHolderMemberId || controlHolderMemberId === candidate.id || candidate.id === member.id) ? (
                          <button type="button" className="member-control" onClick={() => void setTerminalControl(projectId, controlHolderMemberId === candidate.id ? null : candidate.id).then((state) => onControlState?.(state.holderMemberId)).catch(onError)}>
                            {controlHolderMemberId === candidate.id ? "Revoke control" : candidate.id === member.id ? "Take control" : "Grant interactive control"}
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
              {llmJudging ? <div className="guard-llm-status" role="status"><span className="guard-llm-spinner" />模型正在判断一条需要审批的请求……</div> : null}
              {visibleApprovals.map((approval) => {
                const llm = approval.decision.llm;
                const requester = members.find((candidate) => candidate.id === approval.request.memberId);
                const requesterRole = scenarioRoles.find((role) => role.role === requester?.profileRole)?.level ?? "collaborator";
                const remaining = approval.expiresAt ? Math.max(0, Math.ceil((Date.parse(approval.expiresAt) - clock) / 1000)) : undefined;
                const reason = humanGuardReason(approval.decision.matchedRules, approval.decision.action);
                return (
                  <div key={approval.id} className="guard-approval-card">
                    <strong>{approval.request.memberId === member?.id ? (approval.decision.approvers === "owners" && !approval.approverIds.includes(member?.id ?? "") ? "你的请求正在等待负责人审批" : approval.request.source === "agent" ? "请确认你的 Agent 要执行的操作" : "请确认你自己的命令") : `${requester?.displayName ?? approval.request.memberId}（${guardLevelText(requesterRole)}）请求执行：`}</strong>
                    {approval.request.agentHandle ? <span>通过 @{approval.request.agentHandle}</span> : approval.request.source === "agent" ? <span>由 {requester?.displayName ?? "成员"} 的 Agent 发起</span> : <span>在共享终端中输入</span>}
                    <code>{approval.request.command ?? approval.request.paths?.join(", ")}</code>
                    <small title={approval.decision.matchedRules.join(", ")}>{reason}{remaining !== undefined ? ` · 剩余 ${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, "0")}` : ""}</small>
                    {llm ? (
                      <div className="guard-llm-result">
                        <strong>模型判断风险{guardRiskText(llm.risk)} · {guardRecommendationText(llm.risk)}</strong>
                        <span>置信度 {Math.round(llm.confidence * 100)}%</span>
                        <p>{llm.reason}</p>
                        <small>{llm.applied ? `已自动${approval.decision.action === "deny" ? "拒绝" : "批准"}` : "仅供参考，仍需由人决定"}</small>
                      </div>
                    ) : approval.decision.llmUnavailable ? <div className="guard-llm-status">模型暂时无法判断，这条请求等待人工审批。</div> : null}
                    {approval.noApprover ? <small>没有负责人在线，请让负责人加入。</small> : null}
                    <GuardApprovalActions
                      approval={approval}
                      memberId={member?.id}
                      disabled={replyingApprovalId === approval.id}
                      onReply={(approve) => {
                        setReplyingApprovalId(approval.id);
                        void replyGuardApproval(projectId, approval.id, approve).then(() => onApprovalResolved?.()).catch(onError).finally(() => setReplyingApprovalId(undefined));
                      }}
                      onWithdraw={() => {
                        setReplyingApprovalId(approval.id);
                        void withdrawGuardApproval(projectId, approval.id).then(() => onApprovalResolved?.()).catch(onError).finally(() => setReplyingApprovalId(undefined));
                      }}
                    />
                  </div>
                );
              })}
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
                      {item.snapshotId && !restoredSnapshotIds.has(item.snapshotId) && (owner || item.snapshotMemberId === member?.id) ? (
                        <button
                          type="button"
                          className="member-control activity-undo"
                          data-testid={`undo-snapshot-${item.snapshotId}`}
                          disabled={restoringSnapshotId === item.snapshotId}
                          onClick={() => {
                            const snapshotId = item.snapshotId!;
                            setRestoringSnapshotId(snapshotId);
                            void restoreGuardSnapshot(projectId, snapshotId).catch(onError).finally(() => setRestoringSnapshotId(undefined));
                          }}
                        >
                          Undo
                        </button>
                      ) : null}
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
          {expanded ? "Collapse" : "Show full response"}
        </button>
      ) : null}
      {run && showCard ? (
        <article className="chat-agent-card" data-testid="chat-agent-card">
          {!showText && run.status !== "completed" ? <AgentResponse run={run} /> : null}
          <AgentQuestions projectId={projectId} run={run} memberId={memberId} onError={onError} />
          <AgentRunProgress run={run} memberId={memberId} onCancel={active && !stopping ? () => void stopRun() : undefined} onRetry={run.memberId === memberId && !retrying ? () => void retryRun() : undefined} />
          <div><strong>Requested by {run.memberName ?? run.memberId}</strong><span>{run.interruptedByRunId ? `Interrupted by ${interruptedByName ?? run.interruptedByMemberId}` : run.status}</span></div>
          {splitAgentChanges(run.fileChanges).own.length ? (
            <ul>
              {splitAgentChanges(run.fileChanges).own.map((change) => (
                <li key={change.file}>
                  <button type="button" onClick={() => onOpenFile(change.file)}>{change.file}</button>
                </li>
              ))}
            </ul>
          ) : <small>这个 Agent 没有记录到文件修改。</small>}
          {splitAgentChanges(run.fileChanges).others.length ? (
            <>
              <small className="agent-file-others">{OTHERS_CHANGED_NOTE}</small>
              <ul>
                {splitAgentChanges(run.fileChanges).others.map((change) => (
                  <li key={change.file}>
                    <button type="button" onClick={() => onOpenFile(change.file)}>{change.file}</button>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
          <AgentWorkDetails run={run} trace={trace} variant="team" onLoadTrace={() => onLoadAgentTrace(run.id)} />
          <div className="chat-agent-card-actions">
            <button
              type="button"
              className="chat-trace-download"
              onClick={() => void downloadAgentTrace(projectId, run.id).catch(onError)}
              title="Download complete trace"
              aria-label="Download complete trace"
            >
              <Download size={13} />
            </button>
            {run.status === "queued" || run.status === "running" ? (
              <button type="button" disabled={stopping} onClick={() => void stopRun()}>{stopping ? "正在停止" : "停止任务"}</button>
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
    case "guard_action":
      return item(event, "general", guardActionText(actor, payload), {
        detail: formatGuardActionDetail(payload)
      });
    case "guard_snapshot":
      return {
        ...item(event, "general", `${actor} 的${payload.source === "agent" ? " Agent 修改" : "命令"}已先保存快照再执行，可以撤销`, {
          detail: stringValue(payload.command) ?? (Array.isArray(payload.paths) ? payload.paths.join(", ") : undefined)
        }),
        snapshotId: stringValue(payload.snapshotId),
        snapshotMemberId: event.memberId
      };
    case "guard_snapshot_restored":
      return item(event, "general", `${actor} 撤销了一次快照前的修改`, { detail: stringValue(payload.command) });
    case "guard_llm_judging":
      return item(event, "general", `模型正在判断 ${actor} 的请求`, {
        detail: stringValue(payload.command) ?? (Array.isArray(payload.paths) ? payload.paths.join(", ") : undefined)
      });
    case "guard_llm_result": {
      const model = payload.llm;
      if (!model || typeof model !== "object") return null;
      const judgment = model as Record<string, unknown>;
      const risk = stringValue(judgment.risk) ?? "unknown";
      const confidence = typeof judgment.confidence === "number" ? `置信度 ${Math.round(judgment.confidence * 100)}%` : undefined;
      const reason = stringValue(judgment.reason);
      const applied = judgment.applied === true;
      const followup = applied
        ? `已自动${payload.action === "deny" ? "拒绝" : "批准"}`
        : "仍需由人决定";
      return item(event, "general", `模型对 ${actor} 的请求${guardRecommendationText(risk)}`, {
        detail: [stringValue(payload.command) ?? (Array.isArray(payload.paths) ? payload.paths.join(", ") : undefined), `风险${guardRiskText(risk)}`, confidence, reason, followup].filter(Boolean).join(" · ")
      });
    }
    case "guard_llm_unavailable":
      return item(event, "general", `模型无法判断 ${actor} 的请求`, {
        detail: "仍需由人审批"
      });
    case "guard_approval":
      return item(event, "general", `${actor} 的请求${payload.outcome === "timeout" ? "审批超时" : payload.outcome === "withdrawn" ? "已撤回" : payload.approved ? "已批准" : "已拒绝"}`, {
        detail: formatGuardApprovalDetail(payload)
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
      const { own, others } = splitAgentChanges(fileChanges(payload.files));
      const othersNote = others.length ? ` · 另有 ${others.length} 个文件同期他人也改过` : "";
      return item(
        event,
        "agent",
        `${actor}'s Agent task completed`,
        {
          detail: `${own.length ? formatAgentFiles(own) : "No files changed"}${othersNote}`,
          path: own[0]?.file ?? others[0]?.file
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

function humanGuardReason(rules: string[], action?: GuardApproval["decision"]["action"]) {
  return guardReasonText(rules, action === "deny");
}

function guardActionText(actor: string, payload: Record<string, unknown>) {
  const llm = payload.llm;
  if (llm && typeof llm === "object" && "applied" in llm && llm.applied === true) {
    return `模型已自动${payload.action === "deny" ? "拒绝" : "批准"} ${actor} 的请求`;
  }
  if (payload.remembered === true) return `${actor} 的同一类命令此前已批准，这次直接执行`;
  const rules = Array.isArray(payload.matchedRules) ? payload.matchedRules.filter((rule): rule is string => typeof rule === "string") : [];
  if (rules.includes("owner.self-command")) return `${actor} 以负责人身份执行了自己的命令${payload.action === "allow_snapshot" ? "，已先保存快照" : ""}`;
  const where = payload.source === "agent" ? "的 Agent 请求" : "的终端命令";
  return `${actor}${where}${guardActionWord(stringValue(payload.action))}`;
}

function formatGuardActionDetail(payload: Record<string, unknown>) {
  const command = stringValue(payload.command) ?? (Array.isArray(payload.paths) ? payload.paths.join(", ") : undefined);
  const llm = payload.llm;
  if (!llm || typeof llm !== "object") return command;
  const model = llm as Record<string, unknown>;
  const risk = stringValue(model.risk);
  const confidence = typeof model.confidence === "number" ? `置信度 ${Math.round(model.confidence * 100)}%` : undefined;
  const reason = stringValue(model.reason);
  return [command, risk ? `风险${guardRiskText(risk)}` : undefined, confidence, reason].filter(Boolean).join(" · ");
}

function formatGuardApprovalDetail(payload: Record<string, unknown>) {
  const command = stringValue(payload.command) ?? (Array.isArray(payload.paths) ? payload.paths.join(", ") : undefined);
  const model = payload.llm;
  if (!model || typeof model !== "object") return command;
  const judgment = model as Record<string, unknown>;
  const risk = stringValue(judgment.risk);
  const confidence = typeof judgment.confidence === "number" ? `置信度 ${Math.round(judgment.confidence * 100)}%` : undefined;
  const reason = stringValue(judgment.reason);
  return [command, risk ? `模型${guardRecommendationText(risk)}（风险${guardRiskText(risk)}）` : undefined, confidence, reason].filter(Boolean).join(" · ");
}

function numberValue(value: unknown) {
  return typeof value === "number" ? value : 0;
}

interface AgentActivityFile {
  file: string;
  additions: number;
  deletions: number;
  attribution?: string;
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
      deletions: numberValue(file.deletions),
      attribution: stringValue(file.attribution)
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

const LEVEL_ORDER: GuardScenarioRole["level"][] = ["observer", "student", "collaborator", "trusted", "owner"];

function groupRoles(entries: GuardScenarioRole[]) {
  const groups = new Map<string, GuardScenarioRole[]>();
  for (const entry of entries) {
    groups.set(entry.scenario, [...(groups.get(entry.scenario) ?? []), entry]);
  }
  return [...groups.entries()];
}
