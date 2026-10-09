import { useEffect, useState } from "react";
import { CircleStop, RotateCcw } from "lucide-react";
import type { AgentRun, AgentRuntimeStatus } from "../types";
import { AgentBadge, AgentMetrics } from "./AgentPresentation";

const phases = { "creating-session": "创建会话", "first-request": "等待首次响应", streaming: "接收模型输出", tool: "执行工具", approval: "等待审批", question: "等待问题回答" };
function activityLabel(run: AgentRun, memberId?: string) {
  if (run.activity?.phase !== "question") return phases[run.activity?.phase ?? "first-request"];
  return memberId === run.memberId ? "等待你的回答" : `等待 ${run.memberName ?? "任务发起者"} 回答`;
}
export function AgentRunProgress({ run, memberId, config, onCancel, onRetry }: { run: AgentRun; memberId?: string; config?: AgentRuntimeStatus["activityConfig"]; onCancel?: () => void; onRetry?: () => void }) {
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
    {active ? <div className="agent-progress-heading"><strong>实时活动</strong><AgentBadge tone="info">{activityLabel(run, memberId)}</AgentBadge></div> : null}
    <AgentMetrics items={[
      { id: "run-duration", label: "任务总时长", value: `${elapsed} 秒` },
      { id: "changed-files", label: "已记录文件修改", value: `${run.fileChanges?.length ?? 0} 个` },
      ...(run.activity?.tokens ? [{ id: "token-usage", label: "token 用量", value: run.activity.tokens.total.toLocaleString() }] : [])
    ]} />
    {active && run.activity?.tools.length ? <ul className="agent-current-tools" data-testid="agent-current-tools">{run.activity.tools.map((tool) => <li key={tool.id}><code>{tool.name}</code><span>{tool.summary}</span><small>已持续 {Math.max(0, Math.floor((now - Date.parse(tool.startedAt)) / 1000))} 秒</small></li>)}</ul> : null}
    {waiting ? <div className="agent-response-wait" role="status" data-testid={toolExecuting ? "agent-tool-wait" : "agent-response-wait"}><p>{toolExecuting ? "工具仍在执行，请查看上方的执行时间。" : `已等待模型响应 ${Math.floor(silenceMs / 1000)} 秒`}</p>{stalled ? <p>{toolExecuting ? "工具执行时间较长，可取消任务。" : "模型响应较慢，可以停止并重试任务。"}</p> : null}{onCancel ? <button type="button" onClick={onCancel}><CircleStop size={14} />停止任务</button> : null}</div> : null}
    {run.status === "failed" ? <div className="agent-run-failure" data-testid="agent-run-failure"><strong>任务执行失败</strong><p>{run.failure?.guidance ?? run.error ?? "请查看任务记录。"}</p>{run.failure ? <details><summary>错误详情</summary><dl>
      <div><dt>失败阶段</dt><dd>{phases[run.failure.phase]}</dd></div>
      <div><dt>请求位置</dt><dd>{run.failure.source === "local-runtime" ? "本机 OpenCode 服务" : run.failure.source === "model-provider" ? "模型服务" : "服务端"}</dd></div>
      {run.failure.target ? <div><dt>请求目标</dt><dd><code>{run.failure.target}</code></dd></div> : null}
      <div><dt>错误信息</dt><dd>{[run.failure.errorType, run.failure.statusCode ? `HTTP ${run.failure.statusCode}` : undefined, run.failure.errno, run.failure.message].filter(Boolean).join("\n")}</dd></div>
      <div><dt>最后成功事件</dt><dd>{run.failure.lastSuccessfulSequence}</dd></div>
    </dl></details> : null}<p>{run.fileChanges?.length ? "已完成的文件修改保留在下方列表中。" : "当前没有已记录的文件修改。"}</p>{run.failure?.retryable && onRetry ? <button type="button" onClick={onRetry}><RotateCcw size={14} />重试任务</button> : null}</div> : null}
  </section>;
}
export function AgentRunStatus({ run, memberId }: { run: AgentRun; memberId?: string }) {
  return <div className="agent-run-live-status"><AgentBadge tone="info">{activityLabel(run, memberId)}</AgentBadge>{run.overlappingRunIds?.length ? <small>同时有 {run.overlappingRunIds.length} 项任务执行</small> : null}</div>;
}
