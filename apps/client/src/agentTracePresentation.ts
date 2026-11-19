import type { AgentTraceEvent } from "./types";
import { guardCheckLabels, readableGuardText } from "./conflictGuardLabels";

export interface TraceEntry {
  sequence: number;
  title: string;
  detail?: string;
  metrics?: Array<{ id: string; label: string; value: string }>;
  tone: "neutral" | "success" | "warning" | "error";
}

export function presentTrace(events: AgentTraceEvent[]) {
  const hasProviderError = events.some(
    (event) => event.type === "opencode.session.error"
  );
  return {
    visible: events.flatMap((event) => {
      const item = presentTraceEvent(event, hasProviderError);
      return item ? [item] : [];
    }).slice(-200)
  };
}

function presentTraceEvent(
  event: AgentTraceEvent,
  hasProviderError: boolean
): TraceEntry | null {
  switch (event.type) {
    case "run_queued": return entry(event, "排队等待 Agent 名额");
    case "run_started": return entry(event, "开始在项目里工作");
    case "session_created": return entry(event, "打开了 Agent 会话");
    case "file_changes": {
      const files = Array.isArray(event.data?.files)
        ? event.data.files
          .map((file) => recordValue(file)?.file)
          .filter((file): file is string => typeof file === "string")
        : [];
      return entry(
        event,
        `修改了 ${files.length || "项目中的"} 个文件`,
        files.join(", "),
        "success"
      );
    }
    case "concurrent_change": return entry(event, "检测到同时编辑", event.summary, "warning");
    case "permission_reply": return entry(event, event.data?.reply === "reject" ? "修改被拒绝" : "修改已批准", typeof event.data?.message === "string" ? readableGuardText(event.data.message) : undefined, event.data?.reply === "reject" ? "warning" : "success");
    case "t3_revert": return { ...entry(event, "Agent 任务完成后撤回修改", undefined, "warning"), metrics: [
      { id: "reverted-blocks", label: "已撤回修改", value: `${event.data?.reverted ?? 0} 处` },
      { id: "retained-blocks", label: "保留修改", value: `${event.data?.skipped ?? 0} 处` }
    ] };
    case "t3_completed": {
      const result = String(event.data?.result ?? "passed");
      const labels: Record<string, string> = { passed: "检查通过", warned: "请检查关联修改", reverted: "已撤回修改", "partially-reverted": "部分修改已撤回，其余需要人工处理" };
      return entry(event, `${guardCheckLabels.T3}完成`, labels[result] ?? `${result}（未翻译）`);
    }
    case "t3_incomplete": return entry(event, `${guardCheckLabels.T3}未完成`, "修改归属无法核验，需要人工处理", "warning");
    case "run_completed": return entry(event, "任务完成", undefined, "success");
    case "run_cancelled": return entry(event, "任务已取消", event.summary, "warning");
    case "run_failed": return hasProviderError
      ? null
      : entry(event, "任务失败", event.summary, "error");
    case "opencode.message.part.updated": return presentToolEvent(event);
    case "opencode.session.error": return presentProviderError(event);
    default: return null;
  }
}

function presentProviderError(event: AgentTraceEvent): TraceEntry {
  const error = recordValue(event.data?.error);
  const data = recordValue(error?.data);
  const statusCode = typeof data?.statusCode === "number"
    ? String(data.statusCode)
    : undefined;
  const message = compactText(firstString(data?.message, error?.name, event.summary));
  const detail = [statusCode ? `HTTP ${statusCode}` : undefined, message].filter(Boolean).join("\n");
  return entry(event, "模型服务请求失败", detail || undefined, "error");
}

function presentToolEvent(event: AgentTraceEvent): TraceEntry | null {
  const part = recordValue(event.data?.part);
  if (part?.type !== "tool") return null;
  const state = recordValue(part.state);
  const status = typeof state?.status === "string" ? state.status : "";
  if (status !== "completed" && status !== "error") return null;
  const input = recordValue(state?.input) ?? recordValue(part.input) ?? {};
  const tool = typeof part.tool === "string" ? part.tool : "tool";
  const filePath = firstString(input.filePath, input.path, input.file);
  const command = firstString(input.command, input.cmd);
  const tone: TraceEntry["tone"] = status === "error" ? "error" : "neutral";
  if (tool === "bash" && command) return entry(event, "执行命令", compactText(command), tone);
  if (tool === "read" && filePath) return entry(event, "读取文件", filePath, tone);
  if (tool === "write" && filePath) return entry(event, "写入文件", filePath, tone);
  if (tool === "edit" && filePath) return entry(event, "编辑文件", filePath, tone);
  return entry(event, `使用工具 ${tool}`, undefined, tone);
}

function entry(
  event: AgentTraceEvent,
  title: string,
  detail?: string,
  tone: TraceEntry["tone"] = "neutral"
): TraceEntry {
  return { sequence: event.sequence, title, detail, tone };
}

function compactText(value: string | undefined) {
  if (!value) return undefined;
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > 180 ? `${normalized.slice(0, 177)}…` : normalized;
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function firstString(...values: unknown[]) {
  return values.find(
    (value): value is string => typeof value === "string" && value.length > 0
  );
}
