import { afterEach, describe, expect, it, vi } from "vitest";
import { loadConfig } from "../config.js";
import { decide } from "../guard/decide.js";
import { judgeGuardRequest } from "../guard/llmJudge.js";
import { openCodeConfig } from "../agent/openCodeProcess.js";
import type { GuardContext, GuardDecision, GuardRequest } from "../guard/types.js";

const workspace = "/workspace/project";
const context = (memberLevel: GuardContext["memberLevel"]): GuardContext => ({ memberLevel, initiatorOnline: true, workspaceRoot: workspace, platformDataRoot: "/platform/data" });
const run = (memberLevel: GuardContext["memberLevel"], source: GuardRequest["source"], command: string) =>
  decide({ projectId: "project", memberId: "member", source, kind: "command", command, cwd: workspace }, context(memberLevel));

describe("process termination is irreversible", () => {
  it.each(["kill 123", "pkill node", "pkill -f \"node server.js\"", "killall node", "lsof -ti:3000 | xargs kill"])("asks before an owner's Agent runs %s", (command) => {
    const decision = run("owner", "agent", command);
    expect(decision.action).toBe("ask");
    expect(decision.matchedRules).toContain("agent.default");
  });

  it("keeps owner terminal process control direct and collaborator process control under approval", () => {
    expect(run("owner", "terminal", "pkill node").action).toBe("allow");
    expect(run("collaborator", "terminal", "pkill -f \"node server.js\"")).toMatchObject({ action: "ask", approvers: "owners" });
  });

  it("does not treat words containing kill as process control", () => {
    expect(run("owner", "agent", "grep skill README.md").action).toBe("allow");
  });
});

describe("MiniMax model judgment", () => {
  afterEach(() => { vi.unstubAllGlobals(); });
  const decision: GuardDecision = { action: "ask", segments: [], legacyRisk: "unknown", matchedRules: ["classify.unknown"], unknown: true, autoEligible: true, approvers: "owners" };
  const request: GuardRequest = { projectId: "project", memberId: "member", source: "terminal", kind: "command", command: "sed -n 1p a.txt", cwd: workspace };

  it("forces the submit_judgment function call and reads its arguments", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: "<think>reasoning</think>", tool_calls: [{ function: { name: "submit_judgment", arguments: JSON.stringify({ risk: "low", confidence: 0.9, reason: "Prints one line." }) } }] } }] })));
    vi.stubGlobal("fetch", fetchMock);
    const result = await judgeGuardRequest({ request, decision, mode: "suggest", provider: "minimax", baseUrl: "https://api.minimaxi.com/v1", apiKey: "test", model: "MiniMax-M3" });
    expect(result).toEqual({ risk: "low", confidence: 0.9, reason: "Prints one line." });
    const body = JSON.parse((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(body).toMatchObject({ model: "MiniMax-M3", temperature: 0, reasoning_split: true, tool_choice: { type: "function", function: { name: "submit_judgment" } } });
    expect(JSON.parse(body.messages[1].content).request).not.toHaveProperty("memberId");
  });

  it("keeps reading message content for other providers", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ risk: "high", confidence: 0.8, reason: "Deletes files." }) } }] }))));
    const result = await judgeGuardRequest({ request, decision, mode: "suggest", baseUrl: "https://api.deepseek.com/v1", apiKey: "test" });
    expect(result?.risk).toBe("high");
  });
});

describe("study configuration", () => {
  it("selects MiniMax for the Agent and the guard through one provider switch", () => {
    const config = loadConfig({ SIMPLERCP_LLM_PROVIDER: "minimax", MINIMAX_API_KEY: "test-key" }, "/srv/simplercp");
    expect(config.agent).toMatchObject({ provider: "minimax", apiKey: "test-key", baseUrl: "https://api.minimaxi.com/v1", model: "MiniMax-M3" });
    expect(config.guardLlmTimeoutMs).toBe(5_000);
    expect(() => loadConfig({ SIMPLERCP_LLM_PROVIDER: "other" }, "/srv/simplercp")).toThrow(/SIMPLERCP_LLM_PROVIDER/);
  });

  it("accepts the native guard mode and keeps OpenCode default rules", () => {
    expect(loadConfig({ SIMPLERCP_GUARD_MODE: "native" }, "/srv/simplercp").guardMode).toBe("native");
    const permission = openCodeConfig({ port: 4096, baseUrl: "https://models.example.test/v1", model: "model", guardMode: "native" }).permission;
    expect(permission).toEqual({ task: "deny" });
  });
});
