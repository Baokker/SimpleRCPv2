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
