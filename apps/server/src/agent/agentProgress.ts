import type { AgentRunActivity } from "@simplercp/shared";
import type { AgentRuntimeEvent } from "./agentRuntime.js";

export function createAgentProgress(startedAt: string, config?: AgentRunActivity["config"]) {
  const activity: AgentRunActivity = { phase: "first-request", updatedAt: startedAt, tools: [], reasoning: [], ...(config ? { config: { ...config } } : {}) };
  const partTypes = new Map<string, string>();
  const usage = new Map<string, NonNullable<AgentRunActivity["tokens"]>>();
  const questions = new Set<string>();
  const messageRoles = new Map<string, string>();
  const messages = new Map<string, NonNullable<AgentRunActivity["messages"]>[number]>();
  const assistantMessages = () => [...messages.values()].filter((part) => messageRoles.get(part.messageId) === "assistant");
  const compact = (value: unknown) => typeof value === "string" ? value.replace(/\s+/g, " ").slice(0, 180) : "";
  return {
    phase: () => activity.phase,
    snapshot: () => structuredClone({ ...activity, messages: assistantMessages() }),
    assistantText(id: string, sessionId: string) {
      const part = messages.get(id);
      return part && messageRoles.get(part.messageId) === "assistant" && part.sessionId === sessionId ? part.text : undefined;
    },
    event(event: AgentRuntimeEvent, at: string) {
      activity.updatedAt = at;
      const part = event.data.part as { id?: string; messageID?: string; sessionID?: string; callID?: string; type?: string; text?: string; tool?: string; state?: { status?: string; input?: Record<string, unknown> } } | undefined;
      const messageInfo = event.data.info as { id?: string; role?: string } | undefined;
      if (event.type === "message.updated" && messageInfo?.id && messageInfo.role) messageRoles.set(messageInfo.id, messageInfo.role);
      if (part?.type === "text" && part.id && part.messageID && typeof part.text === "string") {
        messages.set(part.id, { id: part.id, messageId: part.messageID, sessionId: part.sessionID, text: part.text });
      }
      if (event.type === "message.part.delta" && event.data.field === "text" && typeof event.data.partID === "string" && typeof event.data.delta === "string") {
        const message = messages.get(event.data.partID);
        if (message) message.text += event.data.delta;
      }
      if (event.type === "message.part.removed" && typeof event.data.partID === "string") messages.delete(event.data.partID);
      if (event.type === "message.removed" && typeof event.data.messageID === "string") {
        messageRoles.delete(event.data.messageID);
        for (const [id, message] of messages) if (message.messageId === event.data.messageID) messages.delete(id);
      }
      if (event.type.startsWith("message.part.")) { activity.lastPartAt = at; activity.phase = activity.tools.length ? "tool" : "streaming"; }
      if (part?.id && part.type) partTypes.set(part.id, part.type);
      if (part?.type === "reasoning" && part.id) {
        let reasoning = activity.reasoning.find((entry) => entry.id === part.id);
        if (!reasoning) { reasoning = { id: part.id, text: "" }; activity.reasoning.push(reasoning); }
        if (typeof part.text === "string") reasoning.text = part.text.slice(-16_000);
        activity.reasoning = activity.reasoning.slice(-3);
      }
      if (event.type === "message.part.delta" && event.data.field === "text" && typeof event.data.partID === "string" && partTypes.get(event.data.partID) === "reasoning" && typeof event.data.delta === "string") {
        const reasoning = activity.reasoning.find((entry) => entry.id === event.data.partID);
        if (reasoning) reasoning.text = (reasoning.text + event.data.delta).slice(-16_000);
      }
      if (part?.tool && part.state) {
        const id = part.callID ?? part.id;
        if (id) {
          const current = activity.tools.find((entry) => entry.id === id);
          activity.tools = activity.tools.filter((entry) => entry.id !== id);
          if (part.state.status === "pending" || part.state.status === "running") {
            const input = part.state.input ?? {};
            activity.tools.push({ id, name: part.tool, summary: compact(input.filePath ?? input.filepath ?? input.path ?? input.command ?? input.cmd) || current?.summary || "正在准备工具参数", startedAt: current?.startedAt ?? at, status: part.state.status });
            activity.phase = "tool";
          } else activity.phase = activity.tools.length ? "tool" : "streaming";
        }
      }
      if (event.type === "permission.asked") activity.phase = "approval";
      if (event.type === "question.asked") questions.add(String(event.data.id));
      if (["question.replied", "question.rejected"].includes(event.type)) questions.delete(String(event.data.requestID));
      if (questions.size) activity.phase = "question";
      const info = event.data.info as { id?: string; role?: string; tokens?: { input?: number; output?: number; reasoning?: number; cache?: { read?: number; write?: number } } } | undefined;
      if (info?.id && info.role === "assistant" && info.tokens) {
        const tokens = info.tokens;
        const values = { input: tokens.input ?? 0, output: tokens.output ?? 0, reasoning: tokens.reasoning ?? 0, cacheRead: tokens.cache?.read ?? 0, cacheWrite: tokens.cache?.write ?? 0, total: 0 };
        values.total = values.input + values.output + values.reasoning + values.cacheRead + values.cacheWrite;
        usage.set(info.id, values);
        activity.tokens = [...usage.values()].reduce((sum, entry) => Object.fromEntries(Object.entries(sum).map(([key, value]) => [key, value + entry[key as keyof typeof entry]])) as typeof values, { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, total: 0 });
      }
    },
    syncQuestions(ids: string[]) {
      questions.clear();
      for (const id of ids) questions.add(id);
      activity.phase = questions.size ? "question" : activity.tools.length ? "tool" : "streaming";
    },
    waitingForApproval() { activity.phase = "approval"; },
    resumed() { activity.phase = questions.size ? "question" : activity.tools.length ? "tool" : "streaming"; }
  };
}
