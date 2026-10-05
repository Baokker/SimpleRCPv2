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

const shopRoot = fileURLToPath(new URL("../../../../demo/conflict-shop/", import.meta.url));

describe("rules 模式冲突干预", () => {
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
    root = await createTestWorkspace("rules-api-");
    await fs.mkdir(path.join(root, "demo"));
    app = await createApp({ port: 0, host: "127.0.0.1", publicOrigin: "http://127.0.0.1:5173", dataDir: path.join(root, "data"), demoProjectRoot: path.join(root, "demo"), terminalEnabled: false, importRoots: [path.dirname(shopRoot)], conflictGuard: { mode: "rules", idleMs: 50, cursorLeaveLines: 3, maxBatchDurationMs: 500, activeIdleMs: 30_000, cursorDebounceMs: 20 } });
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
    realtime?.dispose();
    await app?.locals.runtimeManager.dispose();
    if (server) await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await fs.rm(root, { recursive: true, force: true });
  });

  it("同一函数判黑、冻结并阻止写盘，轨迹保留判定", async () => {
    const first = await connect("src/cart.ts", alice.member.id);
    const second = await connect("src/cart.ts", bob.member.id);
    replace(first, "applyDiscount(amount, 0.1)", "applyDiscount(amount, 0.2)");
    await waitFor(() => second.getText("content").toString().includes("amount, 0.2"));
    replace(second, "let amount = 0", "let amount = 1");
    await waitFor(() => {
      const state = currentState();
      return state.pairDecisions?.some((record: { verdict?: { decision?: string }; status: string }) => record.status === "judged" && record.verdict?.decision === "lock") === true;
    });
    const state = currentState();
    expect(state.frozenFiles?.some((entry: { file: string }) => entry.file === "src/cart.ts")).toBe(true);
    const source = await fs.readFile(app.locals.runtimeManager.get(projectId).project.workspacePath + "/src/cart.ts", "utf8");
    expect(source).toContain("applyDiscount(amount, 0.1)");
    await alice.request("/conflict-guard/done", { method: "POST" });
    await bob.request("/conflict-guard/done", { method: "POST" });
    const events = readTrace(await (await alice.request("/conflict-guard/trace")).text());
    expect(events.some((event) => event.type === "pair_judged")).toBe(true);
    expect(validateTraceDetailed(events).valid).toBe(true);
  });

  it("调用签名不兼容判黑并挡住两个文件的写盘", async () => {
    const pricing = await connect("src/pricing.ts", alice.member.id);
    const cart = await connect("src/cart.ts", bob.member.id);
    replace(pricing, "applyDiscount(price: number, rate: number)", "applyDiscount(price: number, rate: number, currency: string)");
    await waitFor(() => cart.getText("content").toString().includes("applyDiscount(amount, 0.1)"));
    replace(cart, "applyDiscount(amount, 0.1)", "applyDiscount(amount, 0.2)");
    await waitFor(() => currentState().pairDecisions?.some((record: { verdict?: { ruleId?: string; decision?: string } }) => record.verdict?.ruleId === "call-signature-incompatible" && record.verdict.decision === "lock") === true);
    await waitFor(() => (currentState().blockedPersists?.length ?? 0) > 0);
    const state = currentState();
    expect(state.frozenFiles?.map((entry: { file: string }) => entry.file)).toEqual(expect.arrayContaining(["src/pricing.ts", "src/cart.ts"]));
    expect(state.blockedPersists?.length).toBeGreaterThan(0);
    const pricingSource = await fs.readFile(path.join(app.locals.runtimeManager.get(projectId).project.workspacePath, "src/pricing.ts"), "utf8");
    expect(pricingSource).toContain("applyDiscount(price: number, rate: number)");
  });

  it("成员撤回后解除冻结并记录 guard-revert", async () => {
    const pricing = await connect("src/pricing.ts", alice.member.id);
    const cart = await connect("src/cart.ts", bob.member.id);
    replace(pricing, "applyDiscount(price: number, rate: number)", "applyDiscount(price: number, rate: number, currency: string)");
    replace(cart, "applyDiscount(amount, 0.1)", "applyDiscount(amount, 0.2)");
    await waitFor(() => currentState().pairDecisions?.some((record: { verdict?: { ruleId?: string; decision?: string } }) => record.verdict?.ruleId === "call-signature-incompatible" && record.verdict.decision === "lock") === true);
    const pair = currentState().pairDecisions?.find((record: { verdict?: { ruleId?: string } }) => record.verdict?.ruleId === "call-signature-incompatible") as { pair: { id: string } } | undefined;
    expect(pair).toBeDefined();
    const chatResponse = await alice.request(`/conflict-guard/pairs/${pair!.pair.id}/chat`, { method: "POST", body: JSON.stringify({ text: "@Alice @Bob 请确认冲突处理" }), headers: { "Content-Type": "application/json" } });
    expect(chatResponse.status).toBe(200);
    const response = await alice.request(`/conflict-guard/pairs/${pair!.pair.id}/revert`, { method: "POST" });
    expect(response.status).toBe(204);
    await waitFor(() => currentState().pairDecisions?.some((record: { pair: { id: string }; resolution?: string }) => record.pair.id === pair!.pair.id && record.resolution === "reverted") === true);
    const trace = readTrace(await (await alice.request("/conflict-guard/trace")).text());
    expect(trace.some((event) => event.type === "ui_action" && event.action === "revert_pair")).toBe(true);
    expect(trace.some((event) => event.type === "edit" && (event.origin as { kind?: string })?.kind === "guard-revert")).toBe(true);
  });

  function currentState() { return app.locals.runtimeManager.get(projectId).conflictGuard!.state() as { pairDecisions?: Array<{ pair: { id: string }; verdict?: { decision?: string; ruleId?: string }; status: string; resolution?: string }>; frozenFiles?: Array<{ file: string }>; blockedPersists?: Array<{ file: string }> }; }
  async function connect(file: string, memberId: string) {
    const document = new Y.Doc();
    documents.push(document);
    const provider = new WebsocketProvider(`${origin}/yjs/${projectId}`, encodeURIComponent(`${roomId}:${file}`), document, { disableBc: true, params: { memberId }, WebSocketPolyfill: WebSocket as unknown as typeof globalThis.WebSocket });
    providers.push(provider);
    await new Promise<void>((resolve, reject) => { provider.once("sync", (synced) => synced ? resolve() : undefined); provider.once("connection-error", reject); });
    return document;
  }
  function replace(document: Y.Doc, before: string, after: string) { const text = document.getText("content"); const start = text.toString().indexOf(before); expect(start).toBeGreaterThanOrEqual(0); document.transact(() => { text.delete(start, before.length); text.insert(start, after); }); }
});

async function waitFor(check: () => boolean) { const end = Date.now() + 5_000; while (!check()) { if (Date.now() >= end) throw new Error("等待规则判定超时"); await new Promise((resolve) => setTimeout(resolve, 10)); } }
