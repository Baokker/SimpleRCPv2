import http from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createOpenCodeRuntime } from "../agent/openCodeRuntime.js";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((accept) => { resolve = accept; });
  return { promise, resolve };
}

function setup(idleMs?: number) {
  vi.useFakeTimers();
  let model = "old-model";
  let url = "http://127.0.0.1:1";
  let finishStop: (() => void) | undefined;
  let stopping: Promise<void> | undefined;
  const records: Array<{ model: string; starts: number; disposals: number }> = [];
  const runtime = createOpenCodeRuntime({
    port: 4096, baseUrl: "http://127.0.0.1:1", idleMs,
    clock: { now: () => Date.now(), setTimeout, clearTimeout },
    getSettings: () => ({ provider: "deepseek", model, enabled: true, apiKeyConfigured: true }),
    createProcess: ({ model: processModel }) => {
      const record = { model: processModel, starts: 0, disposals: 0 };
      records.push(record);
      return {
        async start() { record.starts += 1; return { url, version: "test" }; },
        async dispose() { record.disposals += 1; await stopping; }
      };
    }
  });
  return { runtime, records, setModel: (value: string) => { model = value; }, setUrl: (value: string) => { url = value; }, delayStop: () => {
    stopping = new Promise<void>((resolve) => { finishStop = resolve; });
    return () => finishStop!();
  } };
}

afterEach(() => { vi.useRealTimers(); });

describe("OpenCode 空闲回收", () => {
  it("未设置时间时保持进程常驻", async () => {
    const { runtime, records } = setup();
    await runtime.status();
    await vi.advanceTimersByTimeAsync(3_600_000);
    expect(records[0]!.disposals).toBe(0);
    expect(records).toHaveLength(1);
    await runtime.dispose();
  });

  it("空闲到时关闭并创建尚未启动的进程", async () => {
    const { runtime, records } = setup(1000);
    await runtime.status();
    await vi.advanceTimersByTimeAsync(999);
    expect(records).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(records[0]!.disposals).toBe(1);
    expect(records[1]!.starts).toBe(0);
    await vi.advanceTimersByTimeAsync(5000);
    expect(records).toHaveLength(2);
    await runtime.status();
    expect(records[1]!.starts).toBe(1);
    await runtime.dispose();
  });

  it("全部活动运行结束后开始计时", async () => {
    const { runtime, records } = setup(1000);
    await runtime.status();
    const first = runtime.acquireRun!();
    const second = runtime.acquireRun!();
    await vi.advanceTimersByTimeAsync(2000);
    first();
    await vi.advanceTimersByTimeAsync(2000);
    expect(records[0]!.disposals).toBe(0);
    second();
    await vi.advanceTimersByTimeAsync(999);
    expect(records[0]!.disposals).toBe(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(records[0]!.disposals).toBe(1);
    await runtime.dispose();
  });

  it("新请求取消计时并从完成时重新计时", async () => {
    const { runtime, records } = setup(1000);
    await runtime.status();
    await vi.advanceTimersByTimeAsync(900);
    await runtime.status();
    await vi.advanceTimersByTimeAsync(999);
    expect(records[0]!.disposals).toBe(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(records[0]!.disposals).toBe(1);
    await runtime.dispose();
  });

  it("HTTP 请求完成前保持进程运行", async () => {
    const { runtime, records, setUrl } = setup(1000);
    const received = deferred();
    const responseReady = deferred();
    const server = http.createServer(async (_request, response) => {
      received.resolve();
      await responseReady.promise;
      response.setHeader("Content-Type", "application/json");
      response.end("[]");
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("测试服务端没有端口");
    setUrl(`http://127.0.0.1:${address.port}`);
    try {
      await runtime.status();
      await vi.advanceTimersByTimeAsync(900);
      const request = runtime.getDiff({ workspacePath: "/workspace", sessionId: "session" });
      await received.promise;
      await vi.advanceTimersByTimeAsync(5000);
      expect(records[0]!.disposals).toBe(0);
      responseReady.resolve();
      await request;
      await vi.advanceTimersByTimeAsync(1000);
      expect(records[0]!.disposals).toBe(1);
    } finally {
      responseReady.resolve();
      await runtime.dispose();
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });

  it("空闲退出清理旧订阅，旧的停止函数保留重启后的订阅", async () => {
    const { runtime, records, setUrl } = setup(1000);
    const received = [deferred(), deferred()];
    const connections: Array<{ closed: boolean; completion: ReturnType<typeof deferred> }> = [];
    const server = http.createServer((_request, response) => {
      const connection = { closed: false, completion: deferred() };
      connections.push(connection);
      received[connections.length - 1]!.resolve();
      response.writeHead(200, { "Content-Type": "text/event-stream" });
      response.write('data: {"type":"server.connected","properties":{}}\n\n');
      response.on("close", () => { connection.closed = true; connection.completion.resolve(); });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("测试服务端没有端口");
    setUrl(`http://127.0.0.1:${address.port}`);
    try {
      const stopOld = await runtime.subscribe({ workspacePath: "/workspace", sessionId: "session" }, () => {});
      await received[0]!.promise;
      await vi.advanceTimersByTimeAsync(1000);
      const stopNew = await runtime.subscribe({ workspacePath: "/workspace", sessionId: "session" }, () => {});
      await received[1]!.promise;
      expect(records[0]!.disposals).toBe(1);
      await connections[0]!.completion.promise;
      expect(connections[0]!.closed).toBe(true);
      await stopOld();
      expect(connections[1]!.closed).toBe(false);
      await vi.advanceTimersByTimeAsync(1000);
      await runtime.status();
      expect(records[1]!.disposals).toBe(1);
      await connections[1]!.completion.promise;
      await stopNew();
    } finally {
      await runtime.dispose();
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });

  it("退出期间新请求等待关闭完成", async () => {
    const { runtime, records, delayStop } = setup(1000);
    await runtime.status();
    const finish = delayStop();
    await vi.advanceTimersByTimeAsync(1000);
    let completed = false;
    const request = runtime.status().then(() => { completed = true; });
    await vi.advanceTimersByTimeAsync(1000);
    expect(completed).toBe(false);
    expect(records).toHaveLength(1);
    expect(records[0]!.starts).toBe(1);
    finish();
    await request;
    expect(records[1]!.starts).toBe(1);
    await runtime.dispose();
  });

  it("空闲退出和模型切换顺序执行", async () => {
    const { runtime, records, delayStop, setModel } = setup(1000);
    await runtime.status();
    const finish = delayStop();
    await vi.advanceTimersByTimeAsync(1000);
    setModel("new-model");
    const release = runtime.acquireRun!();
    const request = runtime.status();
    finish();
    await request;
    expect(runtime.getCurrentModel!()).toBe("new-model");
    expect(records[0]!.disposals).toBe(1);
    expect(records.at(-1)!.model).toBe("new-model");
    expect(records.at(-1)!.starts).toBe(1);
    release();
    await runtime.dispose();
  });

  it("等待空闲退出的请求也等待随后排队的模型切换", async () => {
    const { runtime, records, delayStop, setModel } = setup(1000);
    await runtime.status();
    const finish = delayStop();
    await vi.advanceTimersByTimeAsync(1000);
    const first = runtime.status();
    await vi.advanceTimersByTimeAsync(0);
    setModel("new-model");
    const release = runtime.acquireRun!();
    const second = runtime.status();
    finish();
    await Promise.all([first, second]);
    expect(records[1]!.starts).toBe(0);
    expect(records[1]!.disposals).toBe(1);
    expect(records[2]!.starts).toBe(2);
    expect(records[2]!.model).toBe("new-model");
    release();
    await runtime.dispose();
  });

  it("运行时关闭等待空闲退出并拒绝新请求", async () => {
    const { runtime, records, delayStop } = setup(1000);
    await runtime.status();
    const finish = delayStop();
    await vi.advanceTimersByTimeAsync(1000);
    const closing = runtime.dispose();
    await expect(runtime.status()).rejects.toThrow("Agent 服务已经关闭");
    finish();
    await closing;
    expect(records).toHaveLength(1);
    expect(records[0]!.disposals).toBe(1);
  });

  it("外部设置的活动任务数量控制计时", async () => {
    const { runtime, records } = setup(1000);
    await runtime.status();
    runtime.setActiveRunCount!(1);
    await vi.advanceTimersByTimeAsync(2000);
    expect(records[0]!.disposals).toBe(0);
    runtime.setActiveRunCount!(0);
    await vi.advanceTimersByTimeAsync(1000);
    expect(records[0]!.disposals).toBe(1);
    await runtime.dispose();
  });
});
