import { expect, it } from "vitest";
import { openCodeConfig, openCodeProviderId } from "../agent/openCodeProcess.js";

it("MiniMax 的 OpenCode 配置使用独立 provider 与环境凭据", () => {
  const options = { provider: "minimax" as const, port: 4096, baseUrl: "https://api.minimax.io/v1", model: "MiniMax-M3", editPermission: "ask" as const };
  const config = openCodeConfig(options);
  expect(openCodeProviderId(options.provider)).toBe("simplercp-minimax");
  expect(config.enabled_providers).toEqual(["simplercp-minimax"]);
  expect(config.model).toBe("simplercp-minimax/MiniMax-M3");
  expect(config.provider).toEqual({ "simplercp-minimax": { npm: "@ai-sdk/openai-compatible", name: "MiniMax", options: { apiKey: "{env:MINIMAX_API_KEY}", baseURL: options.baseUrl }, models: { "MiniMax-M3": { name: "MiniMax-M3", tool_call: true, options: { thinking: { type: "disabled" }, reasoning_split: true } } } } });
  expect(config.permission).toEqual({ edit: "ask", bash: "allow", webfetch: "allow", doom_loop: "allow", external_directory: "deny" });
  expect(openCodeConfig({ ...options, provider: "deepseek", model: "deepseek-flash" }).enabled_providers).toEqual(["simplercp-deepseek"]);
});
