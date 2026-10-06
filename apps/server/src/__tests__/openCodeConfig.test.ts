import { describe, expect, it } from "vitest";
import { openCodeConfig } from "../agent/openCodeProcess.js";

describe("OpenCode provider configuration", () => {
  it.each(["minimax", "deepseek"] as const)("configures %s and only its key reference", (provider) => {
    const config = openCodeConfig({ provider, port: 4096, baseUrl: "https://models.example/v1", model: provider === "minimax" ? "MiniMax-M2" : "deepseek-chat" });
    const text = JSON.stringify(config);
    expect(text).toContain(provider === "minimax" ? "{env:MINIMAX_API_KEY}" : "{env:DEEPSEEK_API_KEY}");
    expect(text).not.toContain(provider === "minimax" ? "DEEPSEEK_API_KEY" : "MINIMAX_API_KEY");
    expect(config.mcp).toBeUndefined();
    if (provider === "minimax") expect(text).toContain('"reasoning_split":true');
  });
  it("configures authenticated MCP and explicitly allows its tools", () => {
    const config = openCodeConfig({ port: 4096, baseUrl: "https://models.example/v1", model: "example", mcp: { url: () => "http://127.0.0.1:4000/mcp/knowledge", token: "test-token" } });
    expect(config.mcp?.knowledge).toMatchObject({ type: "remote", oauth: false, headers: { Authorization: "Bearer test-token" } });
    expect(config.permission).toMatchObject({ knowledge_knowledge_search: "allow", knowledge_knowledge_get: "allow", knowledge_knowledge_propose: "allow" });
  });
});
