import {
  Bot,
  CircleStop,
  FileCode2,
  LoaderCircle,
  Paperclip,
  Plus,
  Send,
  X
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import {
  cancelAgentRun,
  createAgentSession,
  createAgentSessionRun,
  deleteAgentSession,
  downloadAgentTrace,
  getAgentSessions,
  getAgentStatus,
  previewAgentKnowledge,
  getWorkspaceDirectory,
  readWorkspaceFile,
  retryAgentRun
} from "../api";
import { AgentKnowledgeSummary } from "./AgentKnowledgeSummary";
import type {
  AgentPromptContext,
  AgentRun,
  AgentRuntimeStatus,
  AgentSession,
  AgentTraceEvent,
  KnowledgeCard,
  RoomMember,
  WorkspaceNode
} from "../types";
import { formatTime, runStatusText, runtimeText } from "../format";
import { useI18n } from "../i18n";
import { messageError, type Translate } from "../i18n/messages";
import { AgentRunProgress, AgentRunStatus } from "./AgentRunProgress";
import { AgentQuestions } from "./AgentQuestions";
import { AgentResponse } from "./AgentResponse";
import { AgentWorkDetails } from "./AgentWorkDetails";
import { L } from "../i18n/legacy";

const ACTIVE_STATUSES = new Set<AgentRun["status"]>(["queued", "running"]);

export interface AgentDraft { prompt: string; contexts: AgentPromptContext[] }

export function AgentPanel({
  projectId,
  member,
  knowledgeEnabled,
  knowledgeCards,
  knowledgeUpdateRuns,
  members,
  workspaceTree,
  liveRuns,
  drafts,
  setDrafts,
  selectedSessionId,
  setSelectedSessionId,
  traces,
  onLoadTrace,
  onOpenFile,
  onError
}: {
  projectId: string;
  member: RoomMember | null;
  knowledgeEnabled: boolean;
  knowledgeCards: KnowledgeCard[];
  knowledgeUpdateRuns: Record<string, string[]>;
  members: RoomMember[];
  workspaceTree: WorkspaceNode[];
  liveRuns: AgentRun[];
  drafts: Record<string, AgentDraft>;
  setDrafts: Dispatch<SetStateAction<Record<string, AgentDraft>>>;
  selectedSessionId?: string;
  setSelectedSessionId: Dispatch<SetStateAction<string | undefined>>;
  traces: Record<string, AgentTraceEvent[]>;
  onLoadTrace(runId: string): void;
  onOpenFile(path: string): void;
  onError(error: unknown): void;
}) {
  const { locale, t } = useI18n();
  const [runtime, setRuntime] = useState<AgentRuntimeStatus>();
  const [runs, setRuns] = useState<AgentRun[]>([]);
  const [sessions, setSessions] = useState<AgentSession[]>([]);
  const sessionsRef = useRef(sessions);
  sessionsRef.current = sessions;
  const draftKey = `${projectId}:${member?.id ?? ""}:${selectedSessionId ?? "new"}`;
  const draft = drafts[draftKey];
  const prompt = draft?.prompt ?? "";
  const contexts = draft?.contexts ?? [];
  const selectedSessionRef = useRef(selectedSessionId);
  selectedSessionRef.current = selectedSessionId;
  const [contextMenuOpen, setContextMenuOpen] = useState(false);
  const [contextFiles, setContextFiles] = useState<string[]>([]);
  const [contextLoading, setContextLoading] = useState(false);
  const [sessionFormOpen, setSessionFormOpen] = useState(false);
  const [sessionTitle, setSessionTitle] = useState("");
  const [sessionCreating, setSessionCreating] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [knowledgePreview, setKnowledgePreview] = useState<Array<{ id: string; title: string; score: number; chars: number }>>([]);
  const [reviewKnowledge, setReviewKnowledge] = useState<Array<{ id: string; title: string }>>([]);
  const [excludedKnowledge, setExcludedKnowledge] = useState<Set<string>>(new Set());
  const transcriptRef = useRef<HTMLOListElement>(null);
  const followTranscriptRef = useRef(true);
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  const selectedSession = sessions.find((session) => session.id === selectedSessionId);
  const sessionRuns = useMemo(
    () => runs
      .filter((run) => run.sessionId === selectedSessionId)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt)),
    [runs, selectedSessionId]
  );
  const queuedRuns = useMemo(
    () => runs
      .filter((run) => run.status === "queued")
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt)),
    [runs]
  );
  const projectFiles = contextFiles.length ? contextFiles : flattenFiles(workspaceTree);
  const runningRuns = runs.filter((run) => run.status === "running" && run.memberId === member?.id && sessions.some((session) => session.id === run.sessionId));
  const activeSessionIds = useMemo(() => new Set(runs.filter((run) => run.status === "running").map((run) => run.sessionId)), [runs]);
  const sessionRunIds = sessionRuns.map((run) => run.id).join(",");

  useEffect(() => {
    if (!member) return;
    setRuns((current) => {
      const visible = (run: AgentRun) => run.memberId === member.id && sessions.some((session) => session.id === run.sessionId);
      const byId = new Map(current.filter(visible).map((run) => [run.id, run]));
      for (const run of liveRuns.filter(visible)) byId.set(run.id, run);
      return [...byId.values()];
    });
  }, [liveRuns, sessions, member?.id]);

  useEffect(() => {
    let active = true;
    if (!member) {
      setSessions([]);
      setRuns([]);
      setSelectedSessionId(undefined);
      return;
    }
    void Promise.all([
      getAgentStatus(),
      getAgentSessions(projectId)
    ]).then(([nextRuntime, nextSessions]) => {
      if (!active) return;
      setRuntime(nextRuntime);
      setSessions(nextSessions);
      setSelectedSessionId((current) =>
        current && nextSessions.some((session) => session.id === current)
          ? current
          : nextSessions[0]?.id
      );
    }).catch((error) => onErrorRef.current(error));
    return () => { active = false; };
  }, [member?.id, projectId]);

  useEffect(() => {
    if (!member) return;
    let active = true;
    async function refresh() {
      const nextSessions = await getAgentSessions(projectId);
      if (!active) return;
      setSessions(nextSessions);
      setSelectedSessionId((current) => current && nextSessions.some((session) => session.id === current) ? current : nextSessions[0]?.id);
    }
    void refresh().catch((error) => onErrorRef.current(error));
    const timer = window.setInterval(
      () => void refresh().catch((error) => onErrorRef.current(error)),
      5_000
    );
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [member?.id, projectId]);

  useEffect(() => {
    followTranscriptRef.current = true;
    setContextMenuOpen(false);
    setExcludedKnowledge(new Set());
    setKnowledgePreview([]);
  }, [selectedSessionId]);

  useEffect(() => {
    const transcript = transcriptRef.current;
    if (transcript && followTranscriptRef.current) transcript.scrollTop = transcript.scrollHeight;
  }, [sessionRuns, traces, selectedSessionId]);

  useEffect(() => {
    if (!selectedSessionId) return;
    for (const runId of sessionRunIds.split(",").filter(Boolean)) onLoadTrace(runId);
  }, [selectedSessionId, sessionRunIds, onLoadTrace]);

  useEffect(() => {
    if (!knowledgeEnabled || !member || !prompt.trim()) { setKnowledgePreview([]); setReviewKnowledge([]); return; }
    let active = true;
    const timer = window.setTimeout(() => {
      void previewAgentKnowledge(projectId, {
        prompt,
        contexts,
        knowledge: { excludeCardIds: [...excludedKnowledge] }
      }).then((result) => {
        if (!active) return;
        setReviewKnowledge(result.reviewCards ?? []);
        setKnowledgePreview(current => [
          ...result.records,
          ...current.filter(card => excludedKnowledge.has(card.id) && !result.records.some(record => record.id === card.id))
        ]);
      }).catch((error) => { if (active) onErrorRef.current(error); });
    }, 250);
    return () => { active = false; window.clearTimeout(timer); };
  }, [knowledgeEnabled, member?.id, projectId, prompt, contexts, excludedKnowledge, knowledgeCards]);

  async function createSession() {
    if (!member || sessionCreating) return;
    setSessionCreating(true);
    try {
      const response = await createAgentSession(projectId, {
        title: sessionTitle.trim() || t("newAgentSession")
      });
      setSessions((current) => [response.session, ...current]);
      setSelectedSessionId(response.session.id);
      setSessionTitle("");
      setSessionFormOpen(false);
    } catch (error) {
      onErrorRef.current(error);
    } finally {
      setSessionCreating(false);
    }
  }

  async function submitRun() {
    const text = prompt.trim();
    if (!text || !member || submitting) return;
    setSubmitting(true);
    let submittedKey = draftKey;
    const submittedDraft = draft ?? { prompt, contexts };
    try {
      let session = selectedSession;
      if (!session) {
        const response = await createAgentSession(projectId, {
          title: text.slice(0, 80)
        });
        session = response.session;
        setSessions((current) => [response.session, ...current]);
        submittedKey = `${projectId}:${member.id}:${response.session.id}`;
        setDrafts((current) => {
          const next = { ...current, [submittedKey]: current[draftKey] ?? submittedDraft };
          delete next[draftKey];
          return next;
        });
        if (selectedSessionRef.current === selectedSessionId) setSelectedSessionId(response.session.id);
      }
      const response = await createAgentSessionRun(projectId, session.id, {
        prompt: text,
        contexts,
        knowledge: { excludeCardIds: [...excludedKnowledge] }
      });
      setRuns((current) => [response.run, ...current.filter((run) => run.id !== response.run.id)]);
      setDrafts((current) => current[submittedKey] === submittedDraft ? { ...current, [submittedKey]: { prompt: "", contexts: [] } } : current);
      if (selectedSessionRef.current === session.id) setContextMenuOpen(false);
      setKnowledgePreview([]);
      setExcludedKnowledge(new Set());
    } catch (error) {
      onErrorRef.current(error);
    } finally {
      setSubmitting(false);
    }
  }

  function toggleContext(path: string) {
    setDrafts((current) => {
      const context = current[draftKey]?.contexts ?? [];
      return { ...current, [draftKey]: { prompt: current[draftKey]?.prompt ?? "", contexts: context.some((entry) => entry.path === path) ? context.filter((entry) => entry.path !== path) : [...context, { type: "file", path }] } };
    });
  }

  async function toggleContextMenu() {
    const nextOpen = !contextMenuOpen;
    setContextMenuOpen(nextOpen);
    if (!nextOpen || contextFiles.length > 0 || contextLoading) return;
    setContextLoading(true);
    try {
      setContextFiles(await listProjectFiles(projectId, ""));
    } catch (error) {
      onErrorRef.current(error);
    } finally {
      setContextLoading(false);
    }
  }

  async function selectContext(path: string) {
    try {
      const result = await readWorkspaceFile(projectId, path);
      if (result.status !== "text") {
        throw messageError("contextTextOnly");
      }
      toggleContext(path);
      setContextMenuOpen(false);
    } catch (error) {
      onErrorRef.current(error);
    }
  }

  async function cancelRun(run: AgentRun) {
    if (!member) return;
    try {
      const response = await cancelAgentRun(projectId, run.id);
      setRuns((current) => current.map((item) => item.id === run.id ? response.run : item));
    } catch (error) {
      onErrorRef.current(error);
    }
  }

  async function retryRun(run: AgentRun) {
    if (!run.sessionId || !run.failure?.retryable) return;
    try { const response = await retryAgentRun(projectId, run.id); setRuns((current) => [response.run, ...current]); }
    catch (error) { onErrorRef.current(error); }
  }

  async function deleteSession(session: AgentSession) {
    if (!window.confirm(t("confirmDeleteSession", { name: session.title }))) return;
    try {
      await deleteAgentSession(projectId, session.id);
      setSessions((current) => current.filter((entry) => entry.id !== session.id));
      setRuns((current) => current.filter((run) => run.sessionId !== session.id));
      setDrafts((current) => { const next = { ...current }; delete next[`${projectId}:${member?.id ?? ""}:${session.id}`]; return next; });
      setSelectedSessionId((current) => current === session.id ? sessionsRef.current.find((entry) => entry.id !== session.id)?.id : current);
    } catch (error) { onErrorRef.current(error); }
  }

  const runtimeLabel = runtime ? runtimeText(t, runtime.state) : t("checkingOpenCode");

  return (
    <section className="collab-section agent-section">
      <p className="my-agent-hint" data-testid="my-agent-hint">{t("personalAgentHint")}</p>
      <header className="agent-runtime">
        <span className={`agent-runtime-dot ${runtime?.state ?? "checking"}`} aria-hidden="true" />
        <div>
          <strong data-testid="agent-runtime-status">{runtimeLabel}</strong>
          <small>{runtime?.model ?? t("loadingModel")}</small>
          {runtime?.modelChangePending ? <small>{t("modelChangePending")}</small> : null}
        </div>
      </header>

      {runningRuns.filter((run) => run.sessionId === selectedSessionId).map((run) => <div key={run.id}><AgentQuestions projectId={projectId} run={run} memberId={member?.id} onError={onError} /><AgentRunProgress run={run} memberId={member?.id} config={runtime?.activityConfig} onCancel={() => void cancelRun(run)} /></div>)}

      {runningRuns.length > 0 ? (
        <div className="agent-active-runs" data-testid="agent-active-runs">
          <strong>{t("activeTasks")}</strong>
          <ul>
            {runningRuns.map((run) => (
              <li key={run.id}>
                <span className="agent-active-run-label"><strong>{runMemberName(t, run, members)}</strong><span>{sessions.find((session) => session.id === run.sessionId)?.title ?? t("agentSession")}</span><AgentRunStatus run={run} memberId={member?.id} /></span>
                <time>{formatTime(locale, run.startedAt ?? run.createdAt)}</time>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="agent-session-tabs" role="tablist" aria-label={t("agentSessions")}>
        {sessions.map((session) => (
          <div key={session.id} className="agent-session-tab">
          <button
            type="button"
            role="tab"
            aria-selected={session.id === selectedSessionId}
            className={session.id === selectedSessionId ? "active" : ""}
            onClick={() => setSelectedSessionId(session.id)}
            title={session.title}
          >
            {session.title}
          </button>
          <button type="button" className="agent-session-close" aria-label={t("deleteNamedSession", { name: session.title })} title={t("deleteSession")} onClick={() => void deleteSession(session)}><X size={12} /></button>
          </div>
        ))}
        <button
          type="button"
          className="agent-session-add"
          aria-label={t("newSession")}
          title={t("newSession")}
          onClick={() => setSessionFormOpen((current) => !current)}
          data-testid="agent-new-session"
        >
          <Plus size={15} />
        </button>
      </div>

      {sessionFormOpen ? (
        <div className="agent-session-create">
          <input
            value={sessionTitle}
            onChange={(event) => setSessionTitle(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.nativeEvent.isComposing) void createSession();
            }}
            placeholder={t("sessionTitle")}
            data-testid="agent-session-title"
            autoFocus
          />
          <button type="button" onClick={() => void createSession()} disabled={!member || sessionCreating}>
            {t(sessionCreating ? "creating" : "create")}
          </button>
        </div>
      ) : null}

      <ol className="agent-message-list" ref={transcriptRef} onScroll={(event) => { const list = event.currentTarget; followTranscriptRef.current = list.scrollHeight - list.scrollTop - list.clientHeight < 80; }} data-testid="agent-message-list">
        {sessionRuns.length === 0 ? (
          <li className="empty-panel-state">{t("askAgentToWork")}</li>
        ) : sessionRuns.map((run) => (
          <li key={run.id} className="agent-turn">
            <article className="agent-user-message">
              <header>
                <strong>{runMemberName(t, run, members)}</strong>
                <time>{formatTime(locale, run.startedAt ?? run.createdAt)}</time>
              </header>
              <small>{sessions.find((session) => session.id === run.sessionId)?.title ?? t("agentSession")}</small>
              <p>{run.prompt}</p>
              {run.contexts?.length ? (
                <ul className="agent-message-contexts">
                  {run.contexts.map((context) => (
                    <li key={context.path}><FileCode2 size={12} /> {context.path}</li>
                  ))}
                </ul>
              ) : null}
            </article>
            <AgentMessage
              projectId={projectId}
              run={run}
              trace={traces[run.id] ?? []}
              knowledgeCards={knowledgeCards}
              knowledgeUpdateCardIds={knowledgeUpdateRuns[run.id] ?? []}
              onLoadTrace={() => onLoadTrace(run.id)}
              queuedRuns={queuedRuns}
              activeSessionIds={activeSessionIds}
              activityConfig={runtime?.activityConfig}
              onRetry={() => void retryRun(run)}
              canCancel={Boolean(member)}
              onCancel={() => void cancelRun(run)}
              onOpenFile={onOpenFile}
              onError={onErrorRef.current}
            />
          </li>
        ))}
      </ol>

      <div className="agent-composer">
        {reviewKnowledge.length ? <div className="agent-knowledge-preview" data-testid="agent-knowledge-needs-review"><p>{L("有")} {reviewKnowledge.length} {L("张相关卡片待复核，未提供给 Agent")}</p><div className="workspace-dialog-actions">{reviewKnowledge.map(card => <button key={card.id} onClick={() => window.dispatchEvent(new CustomEvent("knowledge-open-card", { detail: card.id }))}>{L("复核「")}{card.title}」</button>)}</div></div> : null}
        {knowledgePreview.length ? (
          <div className="agent-knowledge-preview" data-testid="agent-knowledge-preview">
            <header><strong>{L("将参考的知识")}</strong><span className="ui-badge">{knowledgePreview.filter(card => !excludedKnowledge.has(card.id)).length} {L("条已选")}</span></header>
            <p>{L("取消勾选后，这条知识不会提供给本次任务。")}</p>
            <ul>
              {knowledgePreview.map((card) => (
                <li key={card.id}>
                  <label>
                    <input
                      type="checkbox"
                      disabled={submitting}
                      checked={!excludedKnowledge.has(card.id)}
                      onChange={() => setExcludedKnowledge((current) => {
                        const next = new Set(current);
                        if (next.has(card.id)) next.delete(card.id); else next.add(card.id);
                        return next;
                      })}
                    />
                    <span className="agent-knowledge-preview-title">{card.title}</span>
                    <small>{card.chars} {L("字符")}</small>
                  </label>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {contexts.length ? (
          <ul className="agent-context-chips">
            {contexts.map((context) => (
              <li key={context.path} data-testid={`agent-context-chip-${context.path}`}>
                <FileCode2 size={12} />
                <span title={context.path}>{context.path}</span>
                <button
                  type="button"
                  aria-label={t("removePath", { path: context.path })}
                  data-testid={`agent-context-remove-${context.path}`}
                  onClick={() => toggleContext(context.path)}
                >
                  <X size={12} />
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        <textarea
          value={prompt}
          onChange={(event) => { const value = event.target.value; setDrafts((current) => ({ ...current, [draftKey]: { prompt: value, contexts: current[draftKey]?.contexts ?? [] } })); }}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              void submitRun();
            }
          }}
          placeholder={t("personalAgentPlaceholder")}
          data-testid="agent-prompt"
        />
        {runningRuns.some((run) => run.sessionId === selectedSessionId) ? <small className="agent-interrupt-hint">{t("interruptHint")}</small> : null}
        <div className="agent-composer-toolbar">
          <div className="agent-context-picker">
            <button
              type="button"
              aria-label={t("addProjectFile")}
              title={t("addProjectFile")}
              onClick={() => void toggleContextMenu()}
              data-testid="agent-add-context"
            >
              <Paperclip size={15} />
            </button>
            {contextMenuOpen ? (
              <div className="agent-context-menu">
                <strong>{t("addProjectFile")}</strong>
                <ul>
                  {contextLoading ? <li className="agent-context-loading">{t("loadingFiles")}</li> : null}
                  {projectFiles.map((path) => (
                    <li key={path}>
                      <button
                        type="button"
                        className={contexts.some((context) => context.path === path) ? "selected" : ""}
                        onClick={() => void selectContext(path)}
                        data-testid={`agent-context-option-${path}`}
                      >
                        <FileCode2 size={13} /> <span>{path}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
          <small className="composer-keyboard-hint"><span>{t("enterToSend")}</span><span>{t("shiftEnterForNewLine")}</span></small>
          <button
            type="button"
            className="agent-send-button"
            aria-label={t("sendToAgent")}
            title={t("sendToAgent")}
            onClick={() => void submitRun()}
            disabled={submitting || !member || !prompt.trim() || runtime?.state !== "ready" || !runtime.apiKeyConfigured}
            data-testid="agent-run-submit"
          >
            {submitting ? <LoaderCircle className="agent-trace-spinner" size={15} /> : <Send size={15} />}
          </button>
        </div>
      </div>
    </section>
  );
}

function AgentMessage({
  projectId,
  run,
  trace,
  knowledgeCards,
  knowledgeUpdateCardIds,
  onLoadTrace,
  queuedRuns,
  activeSessionIds,
  canCancel,
  onCancel,
  onOpenFile,
  onError,
  activityConfig,
  onRetry
}: {
  projectId: string;
  run: AgentRun;
  trace: AgentTraceEvent[];
  knowledgeCards: KnowledgeCard[];
  knowledgeUpdateCardIds: string[];
  onLoadTrace(): void;
  queuedRuns: AgentRun[];
  activeSessionIds: Set<string | undefined>;
  canCancel: boolean;
  onCancel(): void;
  onOpenFile(path: string): void;
  onError(error: unknown): void;
  activityConfig?: AgentRuntimeStatus["activityConfig"];
  onRetry(): void;
}) {
  const { t } = useI18n();
  return (
    <article className="agent-assistant-message" data-testid="agent-selected-run">
      <header>
        <span className="agent-avatar"><Bot size={14} /></span>
        <div>
          <strong>OpenCode</strong>
          <div className="agent-run-metadata"><span className={`ui-badge run-status-${run.status}`}>{runStatusLabel(t, run, queuedRuns, activeSessionIds)}</span><span className="agent-run-model">{t("model")} <strong>{run.model}</strong></span></div>
        </div>
        {ACTIVE_STATUSES.has(run.status) && canCancel ? (
          <button type="button" className="agent-cancel-button" onClick={onCancel} title={t("cancelRun")} aria-label={t("cancelRun")}>
            <CircleStop size={14} />
          </button>
        ) : null}
      </header>

      {run.status !== "running" ? <AgentRunProgress run={run} config={activityConfig} onRetry={onRetry} /> : null}
      <AgentResponse run={run} />
      <AgentWorkDetails run={run} trace={trace} onLoadTrace={onLoadTrace} onDownload={() => void downloadAgentTrace(projectId, run.id).catch(onError)} />
      <AgentKnowledgeSummary trace={trace} cards={knowledgeCards} updateCardIds={knowledgeUpdateCardIds} testIdPrefix="agent" onOpenFile={onOpenFile} />
      {run.fileChanges?.length ? (
        <ul className="agent-file-changes">
          {run.fileChanges.map((change) => (
            <li key={change.file}>
              <button type="button" onClick={() => onOpenFile(change.file)}>
                <FileCode2 size={13} />
                <span>{change.file}</span>
                <small className="file-change-counts"><span className="ui-badge success">{L("新增 {0} 行", change.additions)}</span><span className="ui-badge error">{L("删除 {0} 行", change.deletions)}</span></small>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </article>
  );
}

function flattenFiles(nodes: WorkspaceNode[]): string[] {
  return nodes.flatMap((node) => node.type === "file"
    ? [node.path]
    : flattenFiles(node.children ?? []));
}

async function listProjectFiles(projectId: string, directoryPath: string): Promise<string[]> {
  const nodes = await getWorkspaceDirectory(projectId, directoryPath);
  const nested = await Promise.all(nodes.map((node) => node.type === "file"
    ? Promise.resolve([node.path])
    : listProjectFiles(projectId, node.path)));
  return nested.flat();
}

function runMemberName(t: Translate, run: AgentRun, members: RoomMember[]) {
  return run.memberName ?? members.find((member) => member.id === run.memberId)?.displayName ?? t("member");
}

function runStatusLabel(t: Translate, run: AgentRun, queuedRuns: AgentRun[], activeSessionIds: Set<string | undefined>) {
  if (run.interruptedByRunId) return t("interrupted");
  if (run.status !== "queued") return runStatusText(t, run.status);
  if (activeSessionIds.has(run.sessionId) || queuedRuns.some((candidate) => candidate.id !== run.id && candidate.sessionId === run.sessionId && candidate.createdAt < run.createdAt)) {
    return t("waitingPreviousTask");
  }
  const position = queuedRuns.findIndex((candidate) => candidate.id === run.id) + 1;
  return position > 0 ? t("waitingSlotPosition", { position }) : t("waitingSlot");
}
