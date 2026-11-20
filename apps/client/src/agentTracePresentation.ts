import type { AgentTraceEvent } from "./types";
import { serverText, type Translate } from "./i18n/messages";

export interface TraceEntry {
  sequence: number;
  title: string;
  detail?: string;
  metrics?: Array<{ id: string; label: string; value: string }>;
  tone: "neutral" | "success" | "warning" | "error";
}

export function presentTrace(events: AgentTraceEvent[], t: Translate) {
  const hasProviderError = events.some(
    (event) => event.type === "opencode.session.error"
  );
  return {
    visible: events.flatMap((event) => {
      const item = presentTraceEvent(event, hasProviderError, t);
      return item ? [item] : [];
    }).slice(-200)
  };
}

function presentTraceEvent(
  event: AgentTraceEvent,
  hasProviderError: boolean,
  t: Translate
): TraceEntry | null {
  switch (event.type) {
    case "run_queued": return entry(event, t("traceQueued"));
    case "run_started": return entry(event, t("traceStarted"));
    case "session_created": return entry(event, t("traceSession"));
    case "file_changes": {
      const files = Array.isArray(event.data?.files)
        ? event.data.files
          .map((file) => recordValue(file)?.file)
          .filter((file): file is string => typeof file === "string")
        : [];
      return entry(
        event,
        files.length === 0 ? t("traceProjectFilesChanged")
          : files.length === 1 ? t("traceOneFileChanged") : t("traceFilesChanged", { count: files.length }),
        files.join(", "),
        "success"
      );
    }
    case "concurrent_change": return entry(event, t("traceConcurrentEdit"), serverText(t, event.summary ?? ""), "warning");
    case "run_completed": return entry(event, t("traceCompleted"), undefined, "success");
    case "run_cancelled": return entry(event, t("traceCancelled"), serverText(t, event.summary ?? ""), "warning");
    case "run_interrupted": return entry(event, t("traceInterrupted"), undefined, "warning");
    case "run_failed": return hasProviderError
      ? null
      : entry(event, t("traceFailed"), serverText(t, event.summary ?? ""), "error");
    case "opencode.message.part.updated": return presentToolEvent(event, t);
    case "opencode.session.error": return presentProviderError(event, t);
    default: return null;
  }
}

function presentProviderError(event: AgentTraceEvent, t: Translate): TraceEntry {
  const error = recordValue(event.data?.error);
  const data = recordValue(error?.data);
  const statusCode = typeof data?.statusCode === "number"
    ? String(data.statusCode)
    : undefined;
  const message = compactText(firstString(data?.message, error?.name, event.summary));
  const detail = [statusCode ? `HTTP ${statusCode}` : undefined, message].filter(Boolean).join("\n");
  return entry(event, t("traceProviderFailure"), detail || undefined, "error");
}

function presentToolEvent(event: AgentTraceEvent, t: Translate): TraceEntry | null {
  const part = recordValue(event.data?.part);
  if (part?.type !== "tool") return null;
  const state = recordValue(part.state);
  const status = typeof state?.status === "string" ? state.status : "";
  if (status !== "completed" && status !== "error") return null;
  const input = recordValue(state?.input) ?? recordValue(part.input) ?? {};
  const tool = typeof part.tool === "string" ? part.tool : undefined;
  const filePath = firstString(input.filePath, input.path, input.file);
  const command = firstString(input.command, input.cmd);
  const tone: TraceEntry["tone"] = status === "error" ? "error" : "neutral";
  if (tool === "bash" && command) return entry(event, t("traceRanCommand"), compactText(command), tone);
  if (tool === "read" && filePath) return entry(event, t("traceReadFile"), filePath, tone);
  if (tool === "write" && filePath) return entry(event, t("traceWroteFile"), filePath, tone);
  if (tool === "edit" && filePath) return entry(event, t("traceEditedFile"), filePath, tone);
  return entry(event, tool ? t("traceUsedTool", { tool }) : t("traceUsedUnknownTool"), undefined, tone);
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
