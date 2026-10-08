import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../config.js";

describe("server config", () => {
  it("uses stable local defaults when no environment variables are set", () => {
    expect(loadConfig({}, "/srv/simplercp")).toEqual({
      port: 4000,
      host: "127.0.0.1",
      publicOrigin: "http://127.0.0.1:5173",
      dataDir: "/srv/simplercp/.simplercp-data",
      workspacesDir: "/srv/simplercp/.simplercp-data/workspaces",
      importRoots: undefined,
      demoProjectRoot: "/srv/simplercp/demo/workspace",
      terminalEnabled: true,
      fakeAgentRuntime: false,
      sensitiveValues: [],
      conflictGuard: {
        mode: "off",
        arbitration: "owner",
        intentInjection: true,
        idleMs: 1_500,
        cursorLeaveLines: 3,
        maxBatchDurationMs: 5_000,
        activeIdleMs: 600_000,
        cursorDebounceMs: 200,
        bodyUnrelatedMaxAdjacentLines: 3,
        judgementFrameMs: 200,
        maxJudgementsPerFrame: 20
      },
      agent: {
        apiKey: undefined,
        baseUrl: "https://api.deepseek.com/v1",
        model: "deepseek-flash",
        openCodePort: 4096,
        runTimeoutMs: 600_000,
        maxConcurrentRuns: 3,
        activityConfig: { waitingMs: 20000, stalledMs: 60000 }
      }
    });
  });

  it("loads deployment settings from environment", () => {
    expect(
      loadConfig({
        PORT: "4500",
        SIMPLERCP_HOST: "0.0.0.0",
        SIMPLERCP_PUBLIC_URL: "https://code.example.com",
        SIMPLERCP_DATA_DIR: "/srv/simplercp-data",
        SIMPLERCP_TERMINAL_ENABLED: "false",
        DEEPSEEK_API_KEY: "configured-key",
        DEEPSEEK_BASE_URL: "https://models.example.com/v1",
        DEEPSEEK_MODEL: "DeepSeek-V4-Flash"
      }, "/srv/simplercp")
    ).toEqual({
      port: 4500,
      host: "0.0.0.0",
      publicOrigin: "https://code.example.com",
      dataDir: "/srv/simplercp-data",
      workspacesDir: "/srv/simplercp-data/workspaces",
      importRoots: undefined,
      demoProjectRoot: path.resolve("/srv/simplercp/demo/workspace"),
      terminalEnabled: false,
      fakeAgentRuntime: false,
      sensitiveValues: ["configured-key"],
      conflictGuard: {
        mode: "off",
        arbitration: "owner",
        intentInjection: true,
        idleMs: 1_500,
        cursorLeaveLines: 3,
        maxBatchDurationMs: 5_000,
        activeIdleMs: 600_000,
        cursorDebounceMs: 200,
        bodyUnrelatedMaxAdjacentLines: 3,
        judgementFrameMs: 200,
        maxJudgementsPerFrame: 20
      },
      agent: {
        apiKey: "configured-key",
        baseUrl: "https://models.example.com/v1",
        model: "DeepSeek-V4-Flash",
        openCodePort: 4096,
        runTimeoutMs: 600_000,
        maxConcurrentRuns: 3,
        activityConfig: { waitingMs: 20000, stalledMs: 60000 }
      }
    });
  });

  it("rejects a relative data directory", () => {
    expect(() =>
      loadConfig({ SIMPLERCP_DATA_DIR: "runtime-data" }, "/srv/simplercp")
    ).toThrow("SIMPLERCP_DATA_DIR must be an absolute path");
  });

  it("rejects an invalid conflict guard mode", () => {
    expect(() => loadConfig({ CONFLICT_GUARD: "invalid" })).toThrow(
      "CONFLICT_GUARD must be off, observe, rules, or full"
    );
  });

  it("读取相邻行参数并拒绝无效数值", () => {
    expect(loadConfig({ CONFLICT_GUARD_BODY_ADJACENT_LINES: "5" }).conflictGuard?.bodyUnrelatedMaxAdjacentLines).toBe(5);
    expect(loadConfig({ CONFLICT_GUARD_BODY_ADJACENT_LINES: "0" }).conflictGuard?.bodyUnrelatedMaxAdjacentLines).toBe(0);
    for (const value of ["-1", "1.5", "abc"]) expect(() => loadConfig({ CONFLICT_GUARD_BODY_ADJACENT_LINES: value })).toThrow();
  });
  it("活动提示与判定队列参数必须为正整数且停滞时间大于等待时间", () => {
    expect(loadConfig({ SIMPLERCP_AGENT_WAITING_MS: "1000", SIMPLERCP_AGENT_STALLED_MS: "2000", CONFLICT_GUARD_MAX_JUDGEMENTS_PER_FRAME: "7" }).agent?.activityConfig).toEqual({ waitingMs: 1000, stalledMs: 2000 });
    expect(loadConfig({ CONFLICT_GUARD_MAX_JUDGEMENTS_PER_FRAME: "7" }).conflictGuard?.maxJudgementsPerFrame).toBe(7);
    for (const value of ["0", "-1", "abc", "1.5"]) {
      expect(() => loadConfig({ SIMPLERCP_AGENT_WAITING_MS: value })).toThrow();
      expect(() => loadConfig({ CONFLICT_GUARD_MAX_JUDGEMENTS_PER_FRAME: value })).toThrow();
    }
    expect(() => loadConfig({ SIMPLERCP_AGENT_WAITING_MS: "2000", SIMPLERCP_AGENT_STALLED_MS: "1000" })).toThrow();
  });

  it("rejects an invalid terminal setting", () => {
    expect(() =>
      loadConfig({ SIMPLERCP_TERMINAL_ENABLED: "disabled" }, "/srv/simplercp")
    ).toThrow("SIMPLERCP_TERMINAL_ENABLED must be true or false");
  });

  it("rejects an invalid Agent concurrency limit", () => {
    expect(() => loadConfig({ SIMPLERCP_AGENT_MAX_CONCURRENT_RUNS: "0" }, "/srv/simplercp"))
      .toThrow("SIMPLERCP_AGENT_MAX_CONCURRENT_RUNS must be a positive integer");
  });

  it("uses defaults for blank optional paths and validates workspace and import paths", () => {
    const config = loadConfig({ SIMPLERCP_DATA_DIR: "", SIMPLERCP_WORKSPACES_DIR: "", SIMPLERCP_IMPORT_ROOTS: "" }, "/srv/simplercp");
    expect(config.dataDir).toBe("/srv/simplercp/.simplercp-data");
    expect(config.workspacesDir).toBe("/srv/simplercp/.simplercp-data/workspaces");
    expect(config.importRoots).toBeUndefined();
    expect(() => loadConfig({ SIMPLERCP_WORKSPACES_DIR: "relative" })).toThrow("absolute path");
    expect(() => loadConfig({ SIMPLERCP_IMPORT_ROOTS: "relative" })).toThrow("absolute paths");
    expect(loadConfig({ SIMPLERCP_IMPORT_ROOTS: "/srv/imports,/srv/examples" }).importRoots).toEqual(["/srv/imports", "/srv/examples"]);
  });

  it("loads Agent adjudication strategies and reasoning settings", () => {
    const config = loadConfig({ CONFLICT_GUARD: "full", CONFLICT_GUARD_T2_STRATEGY: "G3", CONFLICT_GUARD_T3_STRATEGY: "G2", CONFLICT_GUARD_T2_REASONING: "true", CONFLICT_GUARD_T3_REASONING: "false" });
    expect(config.conflictGuard?.adjudication?.settings).toMatchObject({ t2Strategy: "G3", t3Strategy: "G2", t2Reasoning: true, t3Reasoning: false });
    expect(() => loadConfig({ CONFLICT_GUARD: "full", CONFLICT_GUARD_T2_STRATEGY: "G9" })).toThrow();
    expect(() => loadConfig({ CONFLICT_GUARD: "full", CONFLICT_GUARD_T2_REASONING: "yes" })).toThrow();
  });
});
