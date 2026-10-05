import {
  Activity,
  AlertCircle,
  Bot,
  CheckCircle2,
  ChevronDown,
  CircleStop,
  Download,
  FileCode2,
  LoaderCircle,
  Paperclip,
  Plus,
  Send,
  X
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  cancelAgentRun,
  createAgentSession,
  createAgentSessionRun,
  downloadAgentTrace,
  getAgentRuns,
  getAgentSessions,
  getAgentStatus,
  previewAgentKnowledge,
  getWorkspaceDirectory,
  readWorkspaceFile
} from "../api";
import { presentTrace } from "../agentTracePresentation";
import type {
  AgentPromptContext,
  AgentRun,
  AgentRuntimeStatus,
  AgentSession,
  AgentTraceEvent,
  RoomMember,
  WorkspaceNode
} from "../types";
import { formatTime, titleCase } from "../format";

const ACTIVE_STATUSES = new Set<AgentRun["status"]>(["queued", "running"]);

export function AgentPanel({
  projectId,
  member,
  knowledgeEnabled,
  knowledgeUpdateRuns,
  members,
  workspaceTree,
  refreshVersion,
  traces,
  onLoadTrace,
  onOpenFile,
  onError
}: {
  projectId: string;
  member: RoomMember | null;
  knowledgeEnabled: boolean;
  knowledgeUpdateRuns: Record<string, string[]>;
  members: RoomMember[];
  workspaceTree: WorkspaceNode[];
  refreshVersion: number;
  traces: Record<string, AgentTraceEvent[]>;
  onLoadTrace(runId: string): void;
  onOpenFile(path: string): void;
  onError(error: unknown): void;
}) {
  const [runtime, setRuntime] = useState<AgentRuntimeStatus>();
  const [runs, setRuns] = useState<AgentRun[]>([]);
  const [sessions, setSessions] = useState<AgentSession[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string>();
  const [prompt, setPrompt] = useState("");
  const [contexts, setContexts] = useState<AgentPromptContext[]>([]);
  const [contextMenuOpen, setContextMenuOpen] = useState(false);
  const [contextFiles, setContextFiles] = useState<string[]>([]);
  const [contextLoading, setContextLoading] = useState(false);
  const [sessionFormOpen, setSessionFormOpen] = useState(false);
  const [sessionTitle, setSessionTitle] = useState("");
  const [sessionCreating, setSessionCreating] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [knowledgePreview, setKnowledgePreview] = useState<Array<{ id: string; title: string; score: number; chars: number }>>([]);
  const [excludedKnowledge, setExcludedKnowledge] = useState<Set<string>>(new Set());
  const transcriptRef = useRef<HTMLOListElement>(null);
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
  const sessionRunIds = sessionRuns.map((run) => run.id).join(",");

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
      getAgentSessions(projectId),
      getAgentRuns(projectId),
    ]).then(([nextRuntime, nextSessions, nextRuns]) => {
      if (!active) return;
      setRuntime(nextRuntime);
      setSessions(nextSessions);
      setRuns(nextRuns);
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
      const [nextRuns, nextSessions] = await Promise.all([
        getAgentRuns(projectId),
        getAgentSessions(projectId)
      ]);
      if (!active) return;
      setRuns(nextRuns);
      setSessions(nextSessions);
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
  }, [member?.id, projectId, refreshVersion]);

  useEffect(() => {
    const transcript = transcriptRef.current;
    if (transcript) transcript.scrollTop = transcript.scrollHeight;
  }, [sessionRuns.length, sessionRuns.at(-1)?.status]);

  useEffect(() => {
    if (!selectedSessionId) return;
    for (const runId of sessionRunIds.split(",").filter(Boolean)) onLoadTrace(runId);
  }, [selectedSessionId, sessionRunIds, onLoadTrace]);

  useEffect(() => {
    if (!knowledgeEnabled || !member || !prompt.trim()) { setKnowledgePreview([]); return; }
    const timer = window.setTimeout(() => {
      void previewAgentKnowledge(projectId, {
        prompt,
        contexts,
        knowledge: { excludeCardIds: [...excludedKnowledge] }
      }).then((result) => setKnowledgePreview(result.records)).catch((error) => onErrorRef.current(error));
    }, 250);
    return () => window.clearTimeout(timer);
  }, [knowledgeEnabled, member?.id, projectId, prompt, contexts, excludedKnowledge]);

  async function createSession() {
    if (!member || sessionCreating) return;
    setSessionCreating(true);
    try {
      const response = await createAgentSession(projectId, {
        title: sessionTitle.trim() || "New Agent session"
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
    try {
      let session = selectedSession;
      if (!session) {
        const response = await createAgentSession(projectId, {
          title: text.slice(0, 80)
        });
        session = response.session;
        setSessions((current) => [response.session, ...current]);
        setSelectedSessionId(response.session.id);
      }
      const response = await createAgentSessionRun(projectId, session.id, {
        prompt: text,
        contexts,
        knowledge: { excludeCardIds: [...excludedKnowledge] }
      });
      setRuns((current) => [response.run, ...current]);
      setPrompt("");
      setContexts([]);
      setContextMenuOpen(false);
      setKnowledgePreview([]);
      setExcludedKnowledge(new Set());
    } catch (error) {
      onErrorRef.current(error);
    } finally {
      setSubmitting(false);
    }
  }

  function toggleContext(path: string) {
    setContexts((current) => current.some((context) => context.path === path)
      ? current.filter((context) => context.path !== path)
      : [...current, { type: "file", path }]);
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
        throw new Error("Agent context accepts text files smaller than 1 MB");
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

  const runtimeLabel = runtime ? `OpenCode ${titleCase(runtime.state)}` : "Checking OpenCode";

  return (
    <section className="collab-section agent-section">
      <p className="my-agent-hint" data-testid="my-agent-hint">These are your own Agent sessions. To direct the shared agent together, mention @agent in Chat.</p>
      <header className="agent-runtime">
        <span className={`agent-runtime-dot ${runtime?.state ?? "checking"}`} aria-hidden="true" />
        <div>
          <strong data-testid="agent-runtime-status">{runtimeLabel}</strong>
          <small>{runtime?.model ?? "Loading model"}</small>
        </div>
      </header>

      <div className="agent-session-tabs" role="tablist" aria-label="Agent sessions">
        {sessions.map((session) => (
          <button
            key={session.id}
            type="button"
            role="tab"
            aria-selected={session.id === selectedSessionId}
            className={session.id === selectedSessionId ? "active" : ""}
            onClick={() => setSelectedSessionId(session.id)}
            title={session.title}
          >
            {session.title}
          </button>
        ))}
        <button
          type="button"
          className="agent-session-add"
          aria-label="New session"
          title="New session"
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
              if (event.key === "Enter") void createSession();
            }}
            placeholder="Session title"
            data-testid="agent-session-title"
            autoFocus
          />
          <button type="button" onClick={() => void createSession()} disabled={!member || sessionCreating}>
            {sessionCreating ? "Creating" : "Create"}
          </button>
        </div>
      ) : null}

      <ol className="agent-message-list" ref={transcriptRef} data-testid="agent-message-list">
        {sessionRuns.length === 0 ? (
          <li className="empty-panel-state">Ask OpenCode to work on this project.</li>
        ) : sessionRuns.map((run) => (
          <li key={run.id} className="agent-turn">
            <article className="agent-user-message">
              <header>
                <strong>{runMemberName(run, members)}</strong>
                <time>{formatTime(run.createdAt)}</time>
              </header>
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
              knowledgeUpdateCardIds={knowledgeUpdateRuns[run.id] ?? []}
              onLoadTrace={() => onLoadTrace(run.id)}
              queuedRuns={queuedRuns}
              canCancel={Boolean(member)}
              onCancel={() => void cancelRun(run)}
              onOpenFile={onOpenFile}
              onError={onErrorRef.current}
            />
          </li>
        ))}
      </ol>

      <div className="agent-composer">
        {knowledgePreview.length ? (
          <div className="agent-knowledge-preview" data-testid="agent-knowledge-preview">
            <strong>将参考的知识</strong>
            <ul>
              {knowledgePreview.map((card) => (
                <li key={card.id}>
                  <label>
                    <input
                      type="checkbox"
                      checked={!excludedKnowledge.has(card.id)}
                      onChange={() => setExcludedKnowledge((current) => {
                        const next = new Set(current);
                        if (next.has(card.id)) next.delete(card.id); else next.add(card.id);
                        return next;
                      })}
                    />
                    <span>{card.title}</span>
                    <small>{card.chars} chars</small>
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
                  aria-label={`Remove ${context.path}`}
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
          onChange={(event) => setPrompt(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              void submitRun();
            }
          }}
          placeholder="Ask OpenCode about this project (only you can see this session)"
          data-testid="agent-prompt"
        />
        <div className="agent-composer-toolbar">
          <div className="agent-context-picker">
            <button
              type="button"
              aria-label="Add project file"
              title="Add project file"
              onClick={() => void toggleContextMenu()}
              data-testid="agent-add-context"
            >
              <Paperclip size={15} />
            </button>
            {contextMenuOpen ? (
              <div className="agent-context-menu">
                <strong>Add project file</strong>
                <ul>
                  {contextLoading ? <li className="agent-context-loading">Loading files</li> : null}
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
          <small>Enter to send · Shift + Enter for a new line</small>
          <button
            type="button"
            className="agent-send-button"
            aria-label="Send to Agent"
            title="Send to Agent"
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
  knowledgeUpdateCardIds,
  onLoadTrace,
  queuedRuns,
  canCancel,
  onCancel,
  onOpenFile,
  onError
}: {
  projectId: string;
  run: AgentRun;
  trace: AgentTraceEvent[];
  knowledgeUpdateCardIds: string[];
  onLoadTrace(): void;
  queuedRuns: AgentRun[];
  canCancel: boolean;
  onCancel(): void;
  onOpenFile(path: string): void;
  onError(error: unknown): void;
}) {
  const [expanded, setExpanded] = useState(ACTIVE_STATUSES.has(run.status));
  useEffect(() => setExpanded(ACTIVE_STATUSES.has(run.status)), [run.status]);
  const presentation = useMemo(() => presentTrace(trace), [trace]);
  const postCheckHits = ((trace.find((event) => event.type === "knowledge_post_check")?.data?.hits as Array<{ cardId?: string; checkResult?: { passed?: boolean } }> | undefined) ?? []);
  const postCheckFailed = postCheckHits.some((hit) => hit.checkResult?.passed === false);

  return (
    <article className="agent-assistant-message" data-testid="agent-selected-run">
      <header>
        <span className="agent-avatar"><Bot size={14} /></span>
        <div>
          <strong>OpenCode</strong>
          <small>{runStatusLabel(run, queuedRuns)} · {run.model}</small>
        </div>
        {ACTIVE_STATUSES.has(run.status) && canCancel ? (
          <button type="button" className="agent-cancel-button" onClick={onCancel} title="Cancel run">
            <CircleStop size={14} />
          </button>
        ) : null}
      </header>

      <details
        className={`agent-trace-block ${run.status}`}
        open={expanded}
        onToggle={(event) => {
          setExpanded(event.currentTarget.open);
          if (event.currentTarget.open) onLoadTrace();
        }}
        data-testid="agent-trace-disclosure"
      >
        <summary data-testid="agent-trace-summary">
          <span className="agent-trace-summary-main">
            <TraceStatusIcon status={run.status} />
            <span>
              <strong>{ACTIVE_STATUSES.has(run.status) ? "OpenCode is working" : "Work details"}</strong>
              <small>{presentation.visible.length} actions</small>
            </span>
          </span>
          <ChevronDown className="agent-trace-chevron" size={14} />
        </summary>
        <div className="agent-trace-content">
          <ol className="agent-trace" data-testid="agent-trace">
            {presentation.visible.map((item) => (
              <li key={item.sequence} className={`agent-trace-entry ${item.tone}`}>
                <span className="agent-trace-entry-marker" aria-hidden="true" />
                <div><strong>{item.title}</strong>{item.detail ? <span>{item.detail}</span> : null}</div>
              </li>
            ))}
          </ol>
          <button
            type="button"
            className="agent-trace-download"
            onClick={() => void downloadAgentTrace(projectId, run.id).catch(onError)}
            data-testid="agent-trace-download"
          >
            <Download size={13} /> Download trace
          </button>
        </div>
      </details>

      {run.output ? <div className="agent-run-output">{run.output}</div> : null}
      {knowledgeUpdateCardIds.length ? (
        <div className="agent-knowledge-update" data-testid="agent-knowledge-update">
          任务运行期间确认了新的知识卡片，可在下一次任务中参考（{knowledgeUpdateCardIds.join("、")}）。
        </div>
      ) : null}
      {trace.some((event) => event.type === "knowledge_injected") ? (
        <div className="agent-knowledge-reference" data-testid="agent-knowledge-reference">
          本次参考的知识：{((trace.find((event) => event.type === "knowledge_injected")?.data?.cards as Array<{ id?: string; title?: string }> | undefined) ?? []).filter((card) => card.id && card.title).map((card) => (
            <button key={card.id} type="button" onClick={() => openKnowledgeCard(card.id!)}>{card.title}</button>
          ))}
        </div>
      ) : null}
      {trace.some((event) => event.type === "knowledge_post_check") ? (
        <div className={`agent-knowledge-post-check${postCheckFailed ? " failed" : ""}`} data-testid="agent-knowledge-post-check">
          任务后核对：{postCheckHits.length ? "涉及已知问题" : "未发现已知问题"}{postCheckFailed ? "，检查未通过" : ""}
        </div>
      ) : null}
      {run.error ? <p className="agent-run-error">{run.error}</p> : null}
      {run.fileChanges?.length ? (
        <ul className="agent-file-changes">
          {run.fileChanges.map((change) => (
            <li key={change.file}>
              <button type="button" onClick={() => onOpenFile(change.file)}>
                <FileCode2 size={13} />
                <span>{change.file}</span>
                <small>+{change.additions} / -{change.deletions}</small>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </article>
  );
}

function openKnowledgeCard(cardId: string) {
  window.dispatchEvent(new CustomEvent("knowledge-open-card", { detail: cardId }));
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

function runMemberName(run: AgentRun, members: RoomMember[]) {
  return run.memberName ?? members.find((member) => member.id === run.memberId)?.displayName ?? "Member";
}

function runStatusLabel(run: AgentRun, queuedRuns: AgentRun[]) {
  if (run.interruptedByRunId) return "Interrupted";
  if (run.status !== "queued") return titleCase(run.status);
  const position = queuedRuns.findIndex((candidate) => candidate.id === run.id) + 1;
  return position > 0 ? `Queued #${position}` : "Queued";
}

function TraceStatusIcon({ status }: { status: AgentRun["status"] }) {
  if (status === "completed") return <CheckCircle2 size={16} />;
  if (status === "failed") return <AlertCircle size={16} />;
  if (status === "cancelled") return <CircleStop size={16} />;
  if (status === "running") return <LoaderCircle className="agent-trace-spinner" size={16} />;
  return <Activity size={16} />;
}
