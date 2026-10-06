import type { AgentRunUsage } from "@simplercp/shared";
import type { LlmUsage } from "@simplercp/knowledge";
import type { AgentRuntimeEvent } from "./agentRuntime.js";

const usageFields = ["inputTokens", "outputTokens", "reasoningTokens", "cacheReadTokens", "cacheWriteTokens", "totalTokens", "cost"] as const;

export function normalizeAgentUsage(info: unknown): AgentRunUsage | undefined {
  if (!info || typeof info !== "object") return undefined;
  const value = info as { role?: unknown; tokens?: { total?: unknown; input?: unknown; output?: unknown; reasoning?: unknown; cache?: { read?: unknown; write?: unknown } }; cost?: unknown };
  if (value.role !== "assistant" || !value.tokens) return undefined;
  const tokens = value.tokens;
  const inputTokens = numberOrUndefined(tokens.input);
  const outputTokens = numberOrUndefined(tokens.output);
  const reasoningTokens = numberOrUndefined(tokens.reasoning);
  const totalTokens = numberOrUndefined(tokens.total) ?? (inputTokens === undefined && outputTokens === undefined && reasoningTokens === undefined
    ? undefined
    : (inputTokens ?? 0) + (outputTokens ?? 0) + (reasoningTokens ?? 0));
  const result: AgentRunUsage = {
    inputTokens, outputTokens, reasoningTokens,
    cacheReadTokens: numberOrUndefined(tokens.cache?.read),
    cacheWriteTokens: numberOrUndefined(tokens.cache?.write),
    totalTokens, cost: numberOrUndefined(value.cost)
  };
  return Object.fromEntries(Object.entries(result).filter(([, entry]) => entry !== undefined));
}

export function createAgentUsageCollector() {
  const messages = new Map<string, AgentRunUsage>();
  return {
    observe(event: AgentRuntimeEvent) {
      if (event.type !== "message.updated") return;
      const info = event.data.info;
      if (!info || typeof info !== "object" || typeof (info as { id?: unknown }).id !== "string") return;
      const usage = normalizeAgentUsageSummary(event.data.usageSummary) ?? normalizeAgentUsage(info);
      if (usage) messages.set((info as { id: string }).id, usage);
    },
    addResult(usage: AgentRunUsage | undefined, messageId?: string) {
      if (usage) messages.set(messageId ?? "result", usage);
    },
    total(): AgentRunUsage | undefined {
      if (!messages.size) return undefined;
      const result: AgentRunUsage = {};
      for (const usage of messages.values()) for (const key of usageFields) {
        if (usage[key] !== undefined) result[key] = (result[key] ?? 0) + usage[key]!;
      }
      return result;
    }
  };
}

function normalizeAgentUsageSummary(value: unknown): AgentRunUsage | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const input = value as Partial<Record<(typeof usageFields)[number], unknown>>;
  const result = Object.fromEntries(
    usageFields
      .map((field) => [field, numberOrUndefined(input[field])] as const)
      .filter(([, entry]) => entry !== undefined)
  ) as AgentRunUsage;
  return Object.keys(result).length ? result : undefined;
}

export function toLlmUsage(value: AgentRunUsage | undefined): LlmUsage | undefined {
  if (!value) return undefined;
  const { inputTokens, outputTokens, ...other } = value;
  return {
    ...other,
    ...(inputTokens === undefined ? {} : { promptTokens: inputTokens }),
    ...(outputTokens === undefined ? {} : { completionTokens: outputTokens })
  };
}

function numberOrUndefined(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}
