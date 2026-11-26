import { Activity, AlertCircle, CheckCircle2, ChevronDown, CircleStop, Download, LoaderCircle } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { AgentRun, AgentTraceEvent } from "../types";
import { presentTrace } from "../agentTracePresentation";
import { AgentMetrics } from "./AgentPresentation";
import { useI18n } from "../i18n";

export function AgentWorkDetails({ run, trace, onLoadTrace, onDownload, variant = "personal" }: {
  run: AgentRun;
  trace: AgentTraceEvent[];
  onLoadTrace?: () => void;
  onDownload?: () => void;
  variant?: "personal" | "team";
}) {
  const { t } = useI18n();
  const active = run.status === "queued" || run.status === "running";
  const [expanded, setExpanded] = useState(active);
  useEffect(() => setExpanded(active), [active]);
  const presentation = useMemo(() => presentTrace(trace, t), [trace, t]);
  const reasoning = run.activity?.reasoning.filter((part) => part.text.trim()).map((part) => part.text).join("\n\n") ?? "";

  return <details className={`agent-trace-block agent-work-details ${run.status}`} open={expanded}
    data-testid="agent-trace-disclosure" onToggle={(event) => {
      setExpanded(event.currentTarget.open);
      if (event.currentTarget.open) onLoadTrace?.();
    }}>
    <summary data-testid="agent-trace-summary">
      <span className="agent-trace-summary-main">
        <TraceStatusIcon status={run.status} />
        <span><strong>{t("workDetails")}</strong><small>{t("operationCount", { count: presentation.visible.length })}</small>
          {reasoning ? <span className="agent-reasoning-preview">{reasoning.split("\n").slice(-3).join("\n")}</span> : null}
        </span>
      </span>
      <span className="agent-trace-summary-action"><span data-testid="agent-work-details-status">{t(active ? "liveUpdates" : "ended")}</span><ChevronDown className="agent-trace-chevron" size={14} /></span>
    </summary>
    <div className="agent-trace-content">
      {reasoning ? <section className="agent-reasoning" data-testid="agent-reasoning"><strong>{t("reasoning")}</strong><pre>{reasoning}</pre></section>
        : <p className="agent-caption" data-testid="agent-reasoning-unavailable">{t("reasoningUnavailable")}</p>}
      {presentation.visible.length ? <ol className="agent-trace" data-testid={variant === "team" ? "chat-agent-trace" : "agent-trace"}>
        {presentation.visible.map((item) => <li key={item.sequence} className={`agent-trace-entry ${item.tone}`}>
          <span className="agent-trace-entry-marker" aria-hidden="true" />
          <div><strong>{item.title}</strong>{item.detail ? <span>{item.detail}</span> : null}{item.metrics ? <AgentMetrics items={item.metrics} /> : null}</div>
        </li>)}
      </ol> : <p className="chat-trace-empty">{t("waitingForTrace")}</p>}
      {onDownload ? <button type="button" className="agent-trace-download" data-testid="agent-trace-download" onClick={onDownload}><Download size={13} />{t("downloadTrace")}</button> : null}
    </div>
  </details>;
}

function TraceStatusIcon({ status }: { status: AgentRun["status"] }) {
  if (status === "completed") return <CheckCircle2 size={16} />;
  if (status === "failed") return <AlertCircle size={16} />;
  if (status === "cancelled") return <CircleStop size={16} />;
  if (status === "running") return <LoaderCircle className="agent-trace-spinner" size={16} />;
  return <Activity size={16} />;
}
