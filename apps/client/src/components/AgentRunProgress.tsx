import { useEffect, useState } from "react";
import { CircleStop, RotateCcw } from "lucide-react";
import type { AgentRun, AgentRuntimeStatus } from "../types";
import { GuardBadge, GuardMetrics, ReadableText } from "./ConflictGuardText";
import { guardCheckLabels } from "../conflictGuardLabels";

const phases = { "creating-session": "创建会话", "first-request": "等待首次响应", streaming: "接收模型输出", tool: "执行工具", approval: "等待审批" };

export function AgentRunProgress({ run, config, onCancel, onRetry }: { run: AgentRun; config?: AgentRuntimeStatus["activityConfig"]; onCancel?: () => void; onRetry?: () => void }) {
  const [now, setNow] = useState(Date.now());
  const active = run.status === "running";
  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [active]);
  const end = active ? now : Date.parse(run.finishedAt ?? run.startedAt ?? run.createdAt);
  const elapsed = Math.max(0, Math.floor((end - Date.parse(run.startedAt ?? run.createdAt)) / 1000));
  const silenceMs = Math.max(0, now - Date.parse(run.activity?.lastPartAt ?? run.startedAt ?? run.createdAt));
  const activityConfig = run.activity?.config ?? config;
  const waiting = active && run.activity?.phase !== "approval" && silenceMs >= (activityConfig?.waitingMs ?? 20_000);
  const stalled = waiting && silenceMs >= (activityConfig?.stalledMs ?? 60_000);
  const reasoning = run.activity?.reasoning.filter((part) => part.text.trim()).map((part) => part.text).join("\n\n") ?? "";
  return <section className="agent-run-progress" data-testid="agent-run-progress">
    {active ? <div className="conflict-item-header"><strong>实时活动</strong><GuardBadge tone={run.activity?.phase === "approval" ? "warning" : "info"}>{phases[run.activity?.phase ?? "first-request"]}</GuardBadge></div> : null}
    <GuardMetrics items={[
      { id: "run-duration", label: "任务总时长", value: `${elapsed} 秒` },
      { id: "changed-files", label: "已记录文件修改", value: `${run.fileChanges?.length ?? 0} 个` },
      ...(run.activity?.tokens ? [{ id: "token-usage", label: "token 用量", value: run.activity.tokens.total.toLocaleString() }] : [])
    ]} />
    {active && run.activity?.tools.length ? <ul className="agent-current-tools" data-testid="agent-current-tools">{run.activity.tools.map((tool) => <li key={tool.id}><code>{tool.name}</code><span>{tool.summary}</span><small>已持续 {Math.max(0, Math.floor((now - Date.parse(tool.startedAt)) / 1000))} 秒</small></li>)}</ul> : null}
    {waiting ? <div className="agent-response-wait" role="status" data-testid="agent-response-wait"><p>已等待模型响应 {Math.floor(silenceMs / 1000)} 秒</p>{stalled ? <p>可能较慢或已卡住，可取消重试</p> : null}{onCancel ? <button type="button" onClick={onCancel}><CircleStop size={14} />取消任务</button> : null}</div> : null}
    {reasoning ? <details className="agent-reasoning" data-testid="agent-reasoning"><summary>推理过程<span className="agent-reasoning-preview">{reasoning.split("\n").slice(-3).join("\n")}</span></summary><pre>{reasoning}</pre></details> : <p className="conflict-caption" data-testid="agent-reasoning-unavailable">该模型未提供推理过程</p>}
    {run.status === "failed" ? <div className="agent-run-failure" data-testid="agent-run-failure"><strong>任务执行失败</strong><ReadableText text={run.failure?.guidance ?? run.error ?? "请查看任务记录。"} />{run.failure ? <dl><div><dt>失败阶段</dt><dd>{phases[run.failure.phase]}</dd></div><div><dt>请求位置</dt><dd>{run.failure.source === "local-runtime" ? "本机 OpenCode 服务" : run.failure.source === "model-provider" ? "模型服务" : "服务端"}</dd></div>{run.failure.target ? <div><dt>请求目标</dt><dd><code>{run.failure.target}</code></dd></div> : null}<div><dt>错误详情</dt><dd>{[run.failure.errorType, run.failure.statusCode ? `HTTP ${run.failure.statusCode}` : undefined, run.failure.errno, run.failure.message].filter(Boolean).join("\n")}</dd></div><div><dt>最后成功事件</dt><dd>{run.failure.lastSuccessfulSequence}</dd></div></dl> : null}<p>{guardCheckLabels.T3}：{run.conflictGuard?.t3Executed || run.conflictGuard?.t3 ? "已执行，结果见冲突检查" : run.conflictGuard?.t3Error ? `执行失败：${run.conflictGuard.t3Error}` : "未执行"}</p><p>{run.fileChanges?.length ? "已完成的文件修改保留在下方列表中。" : "当前没有已归属的文件修改。"}</p>{run.failure?.retryable && onRetry ? <button type="button" onClick={onRetry}><RotateCcw size={14} />重试任务</button> : null}</div> : null}
  </section>;
}

export function AgentRunStatus({ run }: { run: AgentRun }) {
  return <div className="agent-run-live-status"><GuardBadge tone={run.conflictGuard?.needsAttention ? "warning" : "info"}>{run.conflictGuard?.needsAttention ? "等待你的处理" : phases[run.activity?.phase ?? "first-request"]}</GuardBadge>{run.conflictGuard?.rejectedEdits ? <small>修改被拒绝 {run.conflictGuard.rejectedEdits} 次</small> : null}{run.overlappingRunIds?.length ? <small>同时执行：{run.overlappingRunIds.map((id) => id.slice(0, 6)).join("、")}</small> : null}</div>;
}
