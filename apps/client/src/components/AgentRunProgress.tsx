import { useEffect, useState } from "react";
import { CircleStop, RotateCcw } from "lucide-react";
import type { AgentRun, AgentRuntimeStatus } from "../types";
import { AgentBadge, AgentMetrics } from "./AgentPresentation";
import { useI18n } from "../i18n";
import { serverText, type Translate } from "../i18n/messages";

const phases = {
  "creating-session": "phaseCreatingSession", "first-request": "phaseFirstRequest",
  streaming: "phaseStreaming", tool: "phaseTool", approval: "phaseApproval", question: "phaseQuestion"
} as const;
const failureSources = {
  "local-runtime": "localOpenCode", "model-provider": "modelService", server: "server"
} as const;

function activityLabel(t: Translate, run: AgentRun, memberId?: string) {
  if (run.activity?.phase !== "question") return t(phases[run.activity?.phase ?? "first-request"]);
  return memberId === run.memberId
    ? t("waitingForYourAnswer")
    : t("waitingForAnswer", { name: run.memberName ?? t("taskInitiator") });
}
export function AgentRunProgress({ run, memberId, config, onCancel, onRetry }: { run: AgentRun; memberId?: string; config?: AgentRuntimeStatus["activityConfig"]; onCancel?: () => void; onRetry?: () => void }) {
  const { locale, t } = useI18n();
  const [now, setNow] = useState(Date.now());
  const active = run.status === "running";
  useEffect(() => { if (!active) return; const timer = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(timer); }, [active]);
  const end = active ? now : Date.parse(run.finishedAt ?? run.startedAt ?? run.createdAt);
  const elapsed = Math.max(0, Math.floor((end - Date.parse(run.startedAt ?? run.createdAt)) / 1000));
  const silenceMs = Math.max(0, now - Date.parse(run.activity?.lastPartAt ?? run.startedAt ?? run.createdAt));
  const settings = run.activity?.config ?? config;
  const waiting = active && !run.questions?.length && silenceMs >= (settings?.waitingMs ?? 20_000);
  const stalled = waiting && silenceMs >= (settings?.stalledMs ?? 60_000);
  const toolExecuting = run.activity?.tools.some((tool) => tool.status === "running") ?? false;
  return <section className="agent-run-progress" data-testid="agent-run-progress">
    {active ? <div className="agent-progress-heading"><strong>{t("liveActivity")}</strong><AgentBadge tone="info">{activityLabel(t, run, memberId)}</AgentBadge></div> : null}
    <AgentMetrics items={[
      { id: "run-duration", label: t("taskDuration"), value: t("seconds", { count: elapsed }) },
      { id: "changed-files", label: t("recordedFileChanges"), value: t("fileCount", { count: run.fileChanges?.length ?? 0 }) },
      ...(run.activity?.tokens ? [{ id: "token-usage", label: t("tokenUsage"), value: run.activity.tokens.total.toLocaleString(locale) }] : [])
    ]} />
    {active && run.activity?.tools.length ? (
      <ul className="agent-current-tools" data-testid="agent-current-tools">
        {run.activity.tools.map((tool) => <li key={tool.id}>
          <code>{tool.name}</code><span>{serverText(t, tool.summary)}</span>
          <small>{t("toolElapsed", { count: Math.max(0, Math.floor((now - Date.parse(tool.startedAt)) / 1000)) })}</small>
        </li>)}
      </ul>
    ) : null}
    {waiting ? (
      <div className="agent-response-wait" role="status" data-testid={toolExecuting ? "agent-tool-wait" : "agent-response-wait"}>
        <p>{toolExecuting ? t("toolStillRunning") : t("waitingModel", { count: Math.floor(silenceMs / 1000) })}</p>
        {stalled ? <p>{t(toolExecuting ? "toolStalled" : "modelStalled")}</p> : null}
        {onCancel ? <button type="button" onClick={onCancel}><CircleStop size={14} />{t("stopTask")}</button> : null}
      </div>
    ) : null}
    {run.status === "failed" ? (
      <div className="agent-run-failure" data-testid="agent-run-failure">
        <strong>{t("taskFailed")}</strong>
        <p>{serverText(t, run.failure?.guidance ?? run.error ?? t("seeTaskRecord"))}</p>
        {run.failure ? <details><summary>{t("errorDetails")}</summary><dl>
          <div><dt>{t("failurePhase")}</dt><dd>{t(phases[run.failure.phase])}</dd></div>
          <div><dt>{t("requestLocation")}</dt><dd>{t(failureSources[run.failure.source])}</dd></div>
          {run.failure.target ? <div><dt>{t("requestTarget")}</dt><dd><code>{run.failure.target}</code></dd></div> : null}
          <div><dt>{t("errorMessage")}</dt><dd>{[run.failure.errorType, run.failure.statusCode ? `HTTP ${run.failure.statusCode}` : undefined, run.failure.errno, serverText(t, run.failure.message)].filter(Boolean).join("\n")}</dd></div>
          <div><dt>{t("lastSuccessfulEvent")}</dt><dd>{run.failure.lastSuccessfulSequence}</dd></div>
        </dl></details> : null}
        <p>{t(run.fileChanges?.length ? "changesRetained" : "noRecordedChanges")}</p>
        {run.failure?.retryable && onRetry ? <button type="button" onClick={onRetry}><RotateCcw size={14} />{t("retryTask")}</button> : null}
      </div>
    ) : null}
  </section>;
}
export function AgentRunStatus({ run, memberId }: { run: AgentRun; memberId?: string }) {
  const { t } = useI18n();
  return <div className="agent-run-live-status"><AgentBadge tone="info">{activityLabel(t, run, memberId)}</AgentBadge>{run.overlappingRunIds?.length ? <small>{t("overlappingTasks", { count: run.overlappingRunIds.length })}</small> : null}</div>;
}
