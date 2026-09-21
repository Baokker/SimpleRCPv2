import type { AgentTraceEvent } from "./types";

export interface TraceEntry {
  sequence: number;
  title: string;
  detail?: string;
  tone: "neutral" | "success" | "warning" | "error";
}

export function presentTrace(events: AgentTraceEvent[]) {
  const hasProviderError = events.some(
    (event) => event.type === "opencode.session.error"
  );
  return {
    visible: events.slice(-200).flatMap((event) => {
      const item = presentTraceEvent(event, hasProviderError);
      return item ? [item] : [];
    })
  };
}

function presentTraceEvent(
  event: AgentTraceEvent,
  hasProviderError: boolean
): TraceEntry | null {
  switch (event.type) {
    case "run_queued": return entry(event, "Waiting for Agent capacity");
    case "run_started": return entry(event, "Started working in the project");
    case "session_created": return entry(event, "Opened an OpenCode session");
    case "file_changes": {
      const files = Array.isArray(event.data?.files)
        ? event.data.files
          .map((file) => recordValue(file)?.file)
          .filter((file): file is string => typeof file === "string")
        : [];
      return entry(
        event,
        `${files.length || "Project"} ${files.length === 1 ? "file" : "files"} changed`,
        files.join(", "),
        "success"
      );
    }
    case "concurrent_change": return entry(event, "Concurrent edit detected", event.summary, "warning");
    case "run_completed": return entry(event, "Run completed", undefined, "success");
    case "run_cancelled": return entry(event, "Run cancelled", event.summary, "warning");
    case "run_failed": return hasProviderError
      ? null
      : entry(event, "Run failed", event.summary, "error");
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
  const detail = [statusCode, message].filter(Boolean).join(" · ");
  return entry(event, "Provider request failed", detail || undefined, "error");
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
  if (tool === "bash" && command) return entry(event, "Ran command", compactText(command), tone);
  if (tool === "read" && filePath) return entry(event, "Read file", filePath, tone);
  if (tool === "write" && filePath) return entry(event, "Wrote file", filePath, tone);
  if (tool === "edit" && filePath) return entry(event, "Edited file", filePath, tone);
  return entry(event, `Used ${tool}`, undefined, tone);
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
