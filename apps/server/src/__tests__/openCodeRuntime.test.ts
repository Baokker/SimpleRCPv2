import { describe, expect, it } from "vitest";
import { createOpenCodeRuntime } from "../agent/openCodeRuntime.js";

describe("OpenCode runtime model switching", () => {
  it("keeps the old process model when dispose fails and retries while idle", async () => {
    let model = "old-model";
    let failDispose = true;
    const processes: Array<{ model: string; disposeCount: number }> = [];
    const runtime = createOpenCodeRuntime({
      port: 4096,
      baseUrl: "https://example.invalid/v1",
      getSettings: () => ({
        provider: "deepseek",
        model,
        enabled: true,
        apiKeyConfigured: true
      }),
      createProcess: ({ model: processModel }) => {
        const record = { model: processModel, disposeCount: 0 };
        processes.push(record);
        return {
          start: async () => ({ url: "http://127.0.0.1:1", version: "test" }),
          dispose: async () => {
            record.disposeCount += 1;
            if (failDispose) throw new Error("dispose failed");
          }
        };
      }
    });

    const release = runtime.acquireRun?.();
    model = "new-model";
    release?.();
    await Promise.resolve();
    await Promise.resolve();
    expect(runtime.getCurrentModel?.()).toBe("old-model");
    expect(processes).toHaveLength(1);
    expect(processes[0]?.disposeCount).toBe(1);

    failDispose = false;
    const retryRelease = runtime.acquireRun?.();
    retryRelease?.();
    await Promise.resolve();
    await Promise.resolve();
    expect(runtime.getCurrentModel?.()).toBe("new-model");
    expect(processes).toHaveLength(2);
    expect(processes[0]?.disposeCount).toBe(2);
  });
});
