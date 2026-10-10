import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createAgentSettingsStore } from "../agent/agentSettingsStore.js";
import { createTestWorkspace } from "./testWorkspace.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("AgentSettingsStore", () => {
  it("按当前 provider 读取默认模型并拒绝混用设置", async () => {
    const root = await createTestWorkspace("agent-settings-provider-");
    roots.push(root);
    const options = { storagePath: path.join(root, "settings.json"), defaultModel: "deepseek-flash", apiKeyConfigured: true };
    const deepseek = await createAgentSettingsStore(options);
    await deepseek.update({ provider: "deepseek", model: "deepseek-flash", enabled: true });
    const minimax = await createAgentSettingsStore({ ...options, provider: "minimax", defaultModel: "MiniMax-M3" });
    expect(minimax.get()).toEqual({ provider: "minimax", model: "MiniMax-M3", enabled: true, apiKeyConfigured: true });
    await expect(minimax.update({ provider: "deepseek", model: "deepseek-flash", enabled: true })).rejects.toThrow("provider 必须与服务端");
    await minimax.update({ provider: "minimax", model: "MiniMax-M3", enabled: true });
    expect((await createAgentSettingsStore({ ...options, provider: "minimax", defaultModel: "MiniMax-M3" })).get()).toEqual(minimax.get());
  });
  it("updates settings after the update method is extracted", async () => {
    const root = await createTestWorkspace("agent-settings-store-");
    roots.push(root);
    const options = {
      storagePath: path.join(root, "agent", "settings.json"),
      defaultModel: "deepseek-chat",
      apiKeyConfigured: false
    };
    const store = await createAgentSettingsStore(options);
    const { update } = store;
    await expect(update({
      provider: "deepseek",
      model: "deepseek-reasoner",
      enabled: true
    })).resolves.toEqual({
      provider: "deepseek",
      model: "deepseek-reasoner",
      enabled: true,
      apiKeyConfigured: false
    });
    const reloaded = await createAgentSettingsStore(options);
    expect(reloaded.get().model).toBe("deepseek-reasoner");
  });
});
