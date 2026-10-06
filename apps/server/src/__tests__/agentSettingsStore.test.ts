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
  it("uses the configured provider after restart and keeps provider changes server controlled", async () => {
    const root = await createTestWorkspace("agent-provider-settings-"); roots.push(root);
    const storagePath = path.join(root, "settings.json");
    const deepseek = await createAgentSettingsStore({ storagePath, defaultModel: "deepseek-chat", defaultProvider: "deepseek", apiKeyConfigured: true });
    await deepseek.update({ provider: "deepseek", model: "deepseek-reasoner", enabled: true });
    const minimax = await createAgentSettingsStore({ storagePath, defaultModel: "MiniMax-M2", defaultProvider: "minimax", apiKeyConfigured: true });
    expect(minimax.get()).toMatchObject({ provider: "minimax", model: "MiniMax-M2" });
    await expect(minimax.update({ provider: "deepseek", model: "deepseek-chat", enabled: true })).rejects.toThrow("AGENT_LLM_PROVIDER");
    await minimax.update({ provider: "minimax", model: "MiniMax-M2.1", enabled: true });
    expect(minimax.get().model).toBe("MiniMax-M2.1");
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
