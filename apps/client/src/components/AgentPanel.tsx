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
  getAgentRuns,
  getAgentSessions,
  getAgentStatus,
  getAgentTrace,
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
  members,
  workspaceTree,
  refreshVersion,
  onOpenFile,
  onError
}: {
  projectId: string;
  member: RoomMember | null;
  members: RoomMember[];
  workspaceTree: WorkspaceNode[];
  refreshVersion: number;
  onOpenFile(path: string): void;
  onError(error: unknown): void;
}) {
  const [runtime, setRuntime] = useState<AgentRuntimeStatus>();
  const [runs, setRuns] = useState<AgentRun[]>([]);
  const [sessions, setSessions] = useState<AgentSession[]>([]);
  const [traces, setTraces] = useState<Record<string, AgentTraceEvent[]>>({});
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
      getAgentSessions(projectId, member.id),
      getAgentRuns(projectId)
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
        getAgentSessions(projectId, member!.id)
      ]);
      const visibleRuns = nextRuns.filter((run) => run.sessionId === selectedSessionId);
      const traceEntries = await Promise.all(
        visibleRuns.map(async (run) => [run.id, await getAgentTrace(projectId, run.id)] as const)
      );
      if (!active) return;
      setRuns(nextRuns);
      setSessions(nextSessions);
      setTraces((current) => ({ ...current, ...Object.fromEntries(traceEntries) }));
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
  }, [member?.id, projectId, refreshVersion, selectedSessionId]);

  useEffect(() => {
    const transcript = transcriptRef.current;
    if (transcript) transcript.scrollTop = transcript.scrollHeight;
  }, [sessionRuns.length, sessionRuns.at(-1)?.status]);

  async function createSession() {
    if (!member || sessionCreating) return;
    setSessionCreating(true);
    try {
      const response = await createAgentSession(projectId, {
        memberId: member.id,
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
          memberId: member.id,
          title: text.slice(0, 80)
        });
        session = response.session;
        setSessions((current) => [response.session, ...current]);
        setSelectedSessionId(response.session.id);
      }
      const response = await createAgentSessionRun(projectId, session.id, {
        memberId: member.id,
        prompt: text,
        contexts
      });
      setRuns((current) => [response.run, ...current]);
      setPrompt("");
      setContexts([]);
      setContextMenuOpen(false);
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
      const response = await cancelAgentRun(projectId, run.id, member.id);
      setRuns((current) => current.map((item) => item.id === run.id ? response.run : item));
    } catch (error) {
      onErrorRef.current(error);
    }
  }

  const runtimeLabel = runtime ? `OpenCode ${titleCase(runtime.state)}` : "Checking OpenCode";

  return (
    <section className="collab-section agent-section">
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
              queuedRuns={queuedRuns}
              canCancel={
                run.participantId
                  ? run.participantId === member?.participantId
                  : run.memberId === member?.id
              }
              onCancel={() => void cancelRun(run)}
              onOpenFile={onOpenFile}
            />
          </li>
        ))}
      </ol>

      <div className="agent-composer">
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
          placeholder="Ask OpenCode about this project"
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
  queuedRuns,
  canCancel,
  onCancel,
  onOpenFile
}: {
  projectId: string;
  run: AgentRun;
  trace: AgentTraceEvent[];
  queuedRuns: AgentRun[];
  canCancel: boolean;
  onCancel(): void;
  onOpenFile(path: string): void;
}) {
  const [expanded, setExpanded] = useState(ACTIVE_STATUSES.has(run.status));
  useEffect(() => setExpanded(ACTIVE_STATUSES.has(run.status)), [run.status]);
  const presentation = useMemo(() => presentTrace(trace), [trace]);

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
        onToggle={(event) => setExpanded(event.currentTarget.open)}
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
          <a
            className="agent-trace-download"
            href={`/api/projects/${encodeURIComponent(projectId)}/agent/runs/${encodeURIComponent(run.id)}/trace?download=true`}
            download={`trace-${run.id}.jsonl`}
            data-testid="agent-trace-download"
          >
            <Download size={13} /> Download trace
          </a>
        </div>
      </details>

      {run.output ? <div className="agent-run-output">{run.output}</div> : null}
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
