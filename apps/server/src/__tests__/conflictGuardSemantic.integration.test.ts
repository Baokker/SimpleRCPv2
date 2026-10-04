import fs from "node:fs/promises";
import path from "node:path";
import http from "node:http";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { WebsocketProvider } from "y-websocket";
import * as Y from "yjs";
import { readTrace, validateTraceDetailed } from "@simplercp/conflict-guard";
import { createApp } from "../createApp.js";
import { attachRealtimeServer } from "../realtime.js";
import { joinMember } from "./memberTestHelper.js";
import { createTestWorkspace } from "./testWorkspace.js";
import type { ProjectRuntimeManager } from "../projectRuntimeManager.js";

const shopRoot = fileURLToPath(new URL("../../../../demo/conflict-shop/", import.meta.url));

describe("符号观察的真实协作接口", () => {
  let root: string;
  let app: Awaited<ReturnType<typeof createApp>>;
  let server: http.Server;
  let realtime: ReturnType<typeof attachRealtimeServer>;
  let origin: string;
  let projectId: string;
  let roomId: string;
  let alice: Awaited<ReturnType<typeof joinMember>>;
  let bob: Awaited<ReturnType<typeof joinMember>>;
  const providers: WebsocketProvider[] = [];
  const documents: Y.Doc[] = [];

  beforeEach(async () => {
    root = await createTestWorkspace("semantic-api-");
    const demoRoot = path.join(root, "demo");
    await fs.mkdir(demoRoot);
    app = await createApp({ port: 0, host: "127.0.0.1", publicOrigin: "http://127.0.0.1:5173", dataDir: path.join(root, "data"), demoProjectRoot: demoRoot,
      terminalEnabled: false, importRoots: [path.dirname(shopRoot)], conflictGuard: { mode: "observe", idleMs: 50, cursorLeaveLines: 3, maxBatchDurationMs: 500, activeIdleMs: 30_000, cursorDebounceMs: 20 } });
    const project = await app.locals.registry.importDirectory("Conflict shop", shopRoot);
    projectId = project.id;
    roomId = app.locals.runtimeManager.get(projectId).room.id;
    server = http.createServer(app);
    realtime = attachRealtimeServer(server, app.locals.runtimeManager, app.locals.agentRuns, { members: app.locals.members });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("服务没有启动");
    origin = `http://127.0.0.1:${address.port}`;
    alice = await joinMember(origin, projectId, { name: "Alice" });
    bob = await joinMember(origin, projectId, { name: "Bob" });
  });

  afterEach(async () => {
    for (const provider of providers.splice(0)) { provider.disconnect(); provider.destroy(); }
    for (const document of documents.splice(0)) document.destroy();
    realtime.dispose();
    await app.locals.runtimeManager.dispose();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await fs.rm(root, { recursive: true, force: true });
  });

  async function connect(file: string, memberId: string) {
    const document = new Y.Doc();
    documents.push(document);
    const provider = new WebsocketProvider(`${origin}/yjs/${projectId}`, encodeURIComponent(`${roomId}:${file}`), document,
      { disableBc: true, params: { memberId }, WebSocketPolyfill: WebSocket as unknown as typeof globalThis.WebSocket });
    providers.push(provider);
    await new Promise<void>((resolve, reject) => { provider.once("sync", (synced) => { if (synced) resolve(); }); provider.once("connection-error", reject); });
    return document;
  }
  const runtime = () => (app.locals.runtimeManager as ProjectRuntimeManager).get(projectId);
  const state = () => runtime().conflictGuard!.state();
  function replace(document: Y.Doc, before: string, after: string) {
    const text = document.getText("content");
    const start = text.toString().indexOf(before);
    expect(start).toBeGreaterThanOrEqual(0);
    document.transact(() => { text.delete(start, before.length); text.insert(start, after); });
  }

  it("批次结束后发现跨文件的两跳关系，恢复修改后关闭候选并登记无关单元", async () => {
    const pricing = await connect("src/pricing.ts", alice.member.id);
    const checkout = await connect("src/checkout.ts", bob.member.id);
    replace(pricing, "price * (1 - rate)", "price - price * rate");
    replace(checkout, "formatMoney(cart.total())", "formatMoney(cart.total() + 1)");
    await waitFor(() => state().candidatePairs.length === 1);
    const pair = state().candidatePairs[0]!;
    expect(pair.distance).toBe(2);
    expect(new Set([pair.left.symbol, pair.right.symbol])).toEqual(new Set(["src/pricing.ts#applyDiscount", "src/checkout.ts#checkout"]));
    expect(pair.path?.hops.map((hop) => hop.kind)).toEqual(["call", "call"]);
    const response = await alice.request("/conflict-guard/state");
    expect(response.status).toBe(200);
    const body = await response.json() as ReturnType<typeof state>;
    expect(JSON.stringify(body.activeSymbols)).not.toContain("before");
    expect(body.statistics).toMatchObject({ total: 2, related: 2, unrelated: 0 });
    const symbol = await (await alice.request(`/conflict-guard/symbol?key=${encodeURIComponent("src/pricing.ts#applyDiscount")}`)).json() as { text: string; changes: Array<{ before: string }> };
    expect(symbol.text).toContain("price - price * rate");
    expect(symbol.changes).toHaveLength(1);
    expect(symbol.changes[0]!.before).toContain("price * (1 - rate)");
    replace(checkout, "formatMoney(cart.total() + 1)", "formatMoney(cart.total())");
    const report = await connect("src/report.ts", bob.member.id);
    replace(report, '"Shop report"', '"Daily report"');
    await waitFor(() => state().candidatePairs.length === 0 && state().statistics.unrelated === 1);
    expect(state().statistics).toMatchObject({ total: 3, related: 2, unrelated: 1 });
    const events = readTrace(await (await alice.request("/conflict-guard/trace")).text());
    expect(events.some((event) => event.type === "pair_candidate_closed")).toBe(true);
    expect(validateTraceDetailed(events).valid).toBe(true);
  });

  it("同时修改 Cart.total 得到距离零，成员结束活跃变更后候选关闭", async () => {
    const first = await connect("src/cart.ts", alice.member.id);
    const second = await connect("src/cart.ts", bob.member.id);
    replace(first, "applyDiscount(amount, 0.1)", "applyDiscount(amount, 0.2)");
    await waitFor(() => second.getText("content").toString().includes("amount, 0.2"));
    replace(second, "let amount = 0", "let amount = 1");
    await waitFor(() => state().candidatePairs.length === 1);
    expect(state().candidatePairs[0]).toMatchObject({ distance: 0, path: null, left: { symbol: "src/cart.ts#Cart.total" }, right: { symbol: "src/cart.ts#Cart.total" } });
    const response = await bob.request("/conflict-guard/done", { method: "POST" });
    expect(response.status).toBe(204);
    await waitFor(() => state().candidatePairs.length === 0);
  });

  it("磁盘修改未打开的文件时更新索引，记录初次与增量耗时且不创建活跃变更", async () => {
    const currentRuntime = runtime();
    const guard = currentRuntime.conflictGuard!;
    const initial = state().index.latestUpdate.durationMs;
    const file = path.join(currentRuntime.project.workspacePath, "src/report.ts");
    const source = await fs.readFile(file, "utf8");
    await fs.writeFile(file, `${source}\nexport function addedReport() { return 1; }\n`);
    await waitFor(() => guard.semanticIndex.symbolsInFile("src/report.ts").some((symbol) => symbol.name === "addedReport"));
    expect(state().activeSymbols).toEqual([]);
    const durations: number[] = [];
    for (let index = 0; index < 30; index += 1) {
      await fs.writeFile(file, `${source}\nexport function addedReport() { return ${index}; }\n`);
      durations.push(guard.semanticIndex.update(["src/report.ts"]).durationMs);
    }
    durations.sort((a, b) => a - b);
    const p95 = durations[Math.ceil(durations.length * 0.95) - 1]!;
    console.log(JSON.stringify({ semanticPerformance: { initialMs: initial, incrementalSamples: durations.length, p95Ms: p95 } }));
    expect(p95).toBeLessThan(200);
  });
});

async function waitFor(check: () => boolean) {
  const end = Date.now() + 5_000;
  while (!check()) { if (Date.now() >= end) throw new Error("等待语义状态超时"); await new Promise((resolve) => setTimeout(resolve, 10)); }
}
