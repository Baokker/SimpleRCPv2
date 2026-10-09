import { describe, expect, it } from "vitest";
import { createAgentProgress } from "../agent/agentProgress.js";
import { AgentRuntimeRequestError, diagnoseAgentFailure, safeRequestTarget } from "../agent/agentRunFailure.js";
import fs from "node:fs/promises";
import type { AgentTraceEvent } from "@simplercp/shared";

describe("Agent 活动记录", () => {
  it("真实 OpenCode 轨迹的助手正文在增量期间可读，完整更新保持原文且排除用户提示", async () => {
    const record: { trace: { events: AgentTraceEvent[] } } = JSON.parse(await fs.readFile(new URL("../../../../docs/foundation/evidence/agent-paid-check/run-21db5a4b-d3e7-4969-86ef-b9346896d468-completed.json", import.meta.url), "utf8"));
    const events = record.trace.events;
    expect(events.length).toBeGreaterThan(100);
    const progress = createAgentProgress(events[0]!.timestamp);
    const roles = new Map<string, string>();
    const expected = new Map<string, { messageId: string; text: string }>();
    let checkedDelta = false;
    let sawUserText = false;
    for (const event of events) {
      if (!event.type.startsWith("opencode.") || !event.data) continue;
      const info = event.data.info as { id?: string; role?: string } | undefined;
      const part = event.data.part as { id?: string; type?: string; messageID?: string; sessionID?: string; text?: string } | undefined;
      if (info?.id && info.role) roles.set(info.id, info.role);
      const before = progress.snapshot();
      progress.event({ type: event.type.slice("opencode.".length), data: event.data }, event.timestamp);
      if (part?.type === "text" && part.id && part.messageID && typeof part.text === "string") {
        if (roles.get(part.messageID) === "assistant") expected.set(part.id, { messageId: part.messageID, text: part.text });
        if (roles.get(part.messageID) === "user") {
          sawUserText = true;
          expect(progress.snapshot().messages?.some((message) => message.id === part.id)).toBe(false);
          expect(progress.assistantText(part.id, part.sessionID!)).toBeUndefined();
        }
      }
      if (event.type === "opencode.message.part.delta" && event.data.field === "text") {
        const previous = before.messages?.find((message) => message.id === event.data!.partID);
        if (previous) {
          const updated = progress.snapshot().messages?.find((message) => message.id === previous.id);
          expect(updated?.text).toBe(previous.text + event.data.delta);
          const text = expected.get(previous.id);
          if (text) text.text += String(event.data.delta);
          checkedDelta = true;
        }
      }
    }
    expect(checkedDelta).toBe(true);
    expect(sawUserText).toBe(true);
    expect(progress.snapshot().messages?.map(({ id, messageId, text }) => ({ id, messageId, text }))).toEqual([...expected].map(([id, part]) => ({ id, ...part })));
    const final = events.find((event: AgentTraceEvent) => event.type === "assistant_message")?.data?.text;
    expect(progress.snapshot().messages?.at(-1)?.text).toBe(final);
  });

  it("工具从开始到结束保持独立计时，推理增量进入通用活动记录", () => {
    const config = { waitingMs: 3000, stalledMs: 8000 };
    const progress = createAgentProgress("2026-10-08T00:00:00Z", config);
    config.waitingMs = 1;
    expect(progress.snapshot().config).toEqual({ waitingMs: 3000, stalledMs: 8000 });
    const event = (status: string) => ({ type: "message.part.updated", data: { part: { id: "tool", callID: "call", type: "tool", tool: "read", state: { status, input: { filePath: "src/types.ts" } } } } });
    progress.event(event("pending"), "2026-10-08T00:00:01Z");
    progress.event(event("running"), "2026-10-08T00:00:02Z");
    expect(progress.snapshot().tools).toEqual([{ id: "call", name: "read", summary: "src/types.ts", startedAt: "2026-10-08T00:00:01Z", status: "running" }]);
    progress.event({ type: "message.part.updated", data: { part: { id: "reason", type: "reasoning", text: "" } } }, "2026-10-08T00:00:03Z");
    progress.event({ type: "message.part.delta", data: { partID: "reason", field: "text", delta: "检查调用方是否依赖旧签名。" } }, "2026-10-08T00:00:04Z");
    expect(progress.snapshot().reasoning[0]?.text).toBe("检查调用方是否依赖旧签名。");
    expect(progress.snapshot().phase).toBe("tool");
    progress.event(event("completed"), "2026-10-08T00:00:05Z");
    expect(progress.snapshot().tools).toEqual([]);
    expect(progress.snapshot().lastPartAt).toBe("2026-10-08T00:00:05Z");
  });

  it("同一助手消息的 token 更新替换计数，审批回复恢复活动阶段", () => {
    const progress = createAgentProgress("2026-10-08T00:00:00Z");
    const event = (output: number) => ({ type: "message.updated", data: { info: { id: "assistant", role: "assistant", tokens: { input: 100, output, reasoning: 0, cache: { read: 20, write: 0 } } } } });
    progress.event(event(1), "2026-10-08T00:00:01Z");
    progress.event(event(5), "2026-10-08T00:00:02Z");
    expect(progress.snapshot().tokens?.total).toBe(125);
    progress.event({ type: "permission.asked", data: {} }, "2026-10-08T00:00:03Z");
    expect(progress.snapshot().phase).toBe("approval");
    progress.resumed();
    expect(progress.snapshot().phase).toBe("streaming");
  });
});

describe("Agent 失败诊断", () => {
  it("保留 fetch 多层 cause 中的 errno 与最后成功事件", () => {
    const cause = Object.assign(new Error("连接中断"), { code: "UND_ERR_SOCKET" });
    const error = new AgentRuntimeRequestError({ source: "local-runtime", target: "http://127.0.0.1:4096/session/s/prompt_async", message: "fetch failed" }, new TypeError("fetch failed", { cause }));
    expect(diagnoseAgentFailure(error, "tool", 10431)).toMatchObject({ phase: "tool", source: "local-runtime", errno: "UND_ERR_SOCKET", lastSuccessfulSequence: 10431, retryable: true });
  });

  it("认证和模型配置错误提供配置提示，所有敏感文本经过过滤", () => {
    const sensitive = "configured-test-token";
    const result = diagnoseAgentFailure(new AgentRuntimeRequestError({ source: "model-provider", statusCode: 401, message: `invalid ${sensitive}` }), "first-request", 5, [sensitive]);
    expect(result.retryable).toBe(false);
    expect(result.guidance).toContain("DEEPSEEK_BASE_URL");
    expect(JSON.stringify(result)).not.toContain(sensitive);
    expect(diagnoseAgentFailure(new AgentRuntimeRequestError({ statusCode: 404, message: "unknown model" }), "first-request", 0).guidance).toContain("DEEPSEEK_MODEL");
    expect(safeRequestTarget("https://user:password@example.com/v1?api_key=secret")).toBe("https://example.com/v1");
  });

  it("禁止使用的端口归为配置错误并保留 cause 原因", () => {
    const error = new AgentRuntimeRequestError({ source: "local-runtime", message: "fetch failed" }, new TypeError("fetch failed", { cause: new Error("bad port") }));
    const result = diagnoseAgentFailure(error, "creating-session", 0);
    expect(result.message).toContain("bad port");
    expect(result.retryable).toBe(false);
    expect(result.guidance).toContain("SIMPLERCP_OPENCODE_PORT");
  });

  it("读取嵌套 cause 的 HTTP 状态并移除请求目标中的认证信息", () => {
    const error = new TypeError("fetch failed", { cause: Object.assign(new Error("request rejected"), { status: 401 }) });
    expect(diagnoseAgentFailure(error, "first-request", 12)).toMatchObject({ statusCode: 401, retryable: false, lastSuccessfulSequence: 12 });
    expect(safeRequestTarget("https://user:secret@example.com/v1/chat/completions?token=secret")).toBe("https://example.com/v1/chat/completions");
  });
});
