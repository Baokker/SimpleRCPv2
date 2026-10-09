import type { AgentRunFailure, AgentRunPhase } from "@simplercp/shared";
import { redactSensitive } from "./traceStore.js";

export class AgentRuntimeRequestError extends Error {
  constructor(readonly details: Partial<AgentRunFailure> & { message: string }, cause?: unknown) {
    super(details.message, { cause });
    this.name = details.errorType ?? "AgentRuntimeRequestError";
  }
}

export function diagnoseAgentFailure(error: unknown, phase: AgentRunPhase, lastSuccessfulSequence: number, sensitiveValues: string[] = []): AgentRunFailure {
  const record = error && typeof error === "object" ? error as Record<string, unknown> : {};
  const details: Partial<AgentRunFailure> = error instanceof AgentRuntimeRequestError ? error.details : {};
  const causes: Record<string, unknown>[] = [];
  let cause: Record<string, unknown> | undefined = record;
  while (cause && !causes.includes(cause) && causes.length < 16) {
    causes.push(cause);
    cause = cause.cause && typeof cause.cause === "object" ? cause.cause as Record<string, unknown> : undefined;
  }
  const data = record.data && typeof record.data === "object" ? record.data as Record<string, unknown> : {};
  const statusCode = details.statusCode ?? (causes.find((entry) => typeof entry.status === "number")?.status as number | undefined) ?? (typeof data.statusCode === "number" ? data.statusCode : undefined);
  const errno = details.errno ?? causes.find((entry) => typeof entry.code === "string")?.code as string | undefined;
  const messages = [details.message ?? (error instanceof Error ? error.message : String(error)), ...causes.map((entry) => typeof entry.message === "string" ? entry.message : "")].filter(Boolean);
  const message = String(redactSensitive([...new Set(messages)].join("\n"), sensitiveValues));
  const invalidPort = /bad port/i.test(message);
  const retryable = details.retryable ?? (!invalidPort && (statusCode !== undefined ? statusCode === 408 || statusCode === 429 || statusCode >= 500 : Boolean(errno && /^(?:ECONN|ENET|EHOST|ETIMEDOUT|EAI_AGAIN|UND_ERR)/.test(errno) || /fetch failed|network|timeout|socket|exceeded/i.test(message))));
  const guidance = details.guidance ?? (invalidPort ? "HTTP 客户端禁止使用当前端口，请修改 SIMPLERCP_OPENCODE_PORT 后重启服务。" : statusCode === 401 || statusCode === 403 ? "认证失败，请检查 API key 是否有效，以及 DEEPSEEK_BASE_URL 是否属于提供该 key 的服务。" : statusCode === 404 || statusCode === 400 ? "请求配置无法使用，请检查 DEEPSEEK_MODEL 与 DEEPSEEK_BASE_URL。" : retryable ? "网络请求未完成，可以保留已有文件修改并重新发起任务。" : "请检查服务配置与错误详情后重新发起任务。");
  return { phase: details.phase ?? phase, source: details.source ?? "server", errorType: details.errorType ?? (error instanceof Error ? error.name : "UnknownError"), message, ...(details.target ? { target: details.target } : {}), ...(statusCode !== undefined ? { statusCode } : {}), ...(errno ? { errno } : {}), lastSuccessfulSequence, retryable, guidance: String(redactSensitive(guidance, sensitiveValues)) };
}

export function safeRequestTarget(value: string) {
  const url = new URL(value);
  return `${url.protocol}//${url.host}${url.pathname}`;
}
