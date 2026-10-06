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
import type { ProjectRuntime } from "../projectRuntime.js";

const shopRoot = fileURLToPath(new URL("../../../../demo/conflict-shop/", import.meta.url));

for (const mode of ["rules", "observe"] as const) describe(`检查点 A 生产参数 ${mode}`, () => {
  let root: string;
  let app: Awaited<ReturnType<typeof createApp>>;
  let server: http.Server;
  let realtime: ReturnType<typeof attachRealtimeServer>;
  let origin: string;
  let projectId: string;
  let roomId: string;
  let alice: Awaited<ReturnType<typeof joinMember>>;
  let bob: Awaited<ReturnType<typeof joinMember>>;
  const clients: Array<{ document: Y.Doc; provider: WebsocketProvider }> = [];

  beforeEach(async () => {
    root = await createTestWorkspace("checkpoint-a-");
    await fs.mkdir(path.join(root, "demo"));
    app = await createApp({ port: 0, host: "127.0.0.1", publicOrigin: "http://127.0.0.1:5173", dataDir: path.join(root, "data"), demoProjectRoot: path.join(root, "demo"), terminalEnabled: false, importRoots: [path.dirname(shopRoot)], conflictGuard: { mode, idleMs: 1500, cursorLeaveLines: 3, maxBatchDurationMs: 5000, activeIdleMs: 600000, cursorDebounceMs: 100 } });
    const project = await app.locals.registry.importDirectory("Conflict shop", shopRoot);
    projectId = project.id;
    roomId = runtime().room.id;
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
    for (const client of clients.splice(0)) { client.provider.destroy(); client.document.destroy(); }
    realtime.dispose();
    await app.locals.runtimeManager.dispose();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await fs.rm(root, { recursive: true, force: true });
  });
  const runtime = () => app.locals.runtimeManager.get(projectId) as ProjectRuntime;
  const guard = () => runtime().conflictGuard!;
  const state = () => guard().state();
  const disk = (file: string) => fs.readFile(path.join(runtime().project.workspacePath, file), "utf8");
  async function trace() { return readTrace(await guard().exportTrace()); }
  async function connect(file: string, memberId: string) {
    const document = new Y.Doc();
    const provider = new WebsocketProvider(`${origin}/yjs/${projectId}`, encodeURIComponent(`${roomId}:${file}`), document, { disableBc: true, params: { memberId }, WebSocketPolyfill: WebSocket as unknown as typeof globalThis.WebSocket });
    clients.push({ document, provider });
    await new Promise<void>((resolve, reject) => { provider.once("sync", (synced) => { if (synced) resolve(); }); provider.once("connection-error", reject); });
    return { document, provider };
  }
  function replace(document: Y.Doc, before: string, after: string) {
    const text = document.getText("content");
    const start = text.toString().indexOf(before);
    expect(start).toBeGreaterThanOrEqual(0);
    document.transact(() => { text.delete(start, before.length); text.insert(start, after); });
  }
  async function lock(sequential = false) {
    const pricing = await connect("src/pricing.ts", alice.member.id);
    const cart = await connect("src/cart.ts", bob.member.id);
    const cartBaseline = cart.document.getText("content").toString();
    replace(pricing.document, "applyDiscount(price: number, rate: number)", "applyDiscount(price: number, rate: number, currency: string)");
    if (sequential) await waitFor(() => guard().tracker.getActiveChangeSets().some((set) => set.actor.kind === "human" && set.actor.memberId === alice.member.id && set.status === "settled"));
    replace(cart.document, "applyDiscount(amount, 0.1)", "applyDiscount(amount, 0.2)");
    return { pricing, cart, cartBaseline };
  }
  async function judgement() {
    await waitFor(() => state().pairDecisions.some((record) => record.status === "judged" && record.verdict?.ruleId === "call-signature-incompatible"));
    return state().pairDecisions.find((record) => record.status === "judged" && record.verdict?.ruleId === "call-signature-incompatible")!;
  }

  if (mode === "observe") {
    it("P5 拒绝观察模式下确认和撤回并保持内容", async () => {
      const { pricing } = await lock();
      const record = await judgement();
      const source = pricing.document.getText("content").toString();
      expect((await alice.request(`/conflict-guard/pairs/${record.pair.id}/revert`, { method: "POST" })).status).toBe(409);
      expect((await alice.request(`/conflict-guard/pairs/${record.pair.id}/confirm`, { method: "POST" })).status).toBe(409);
      expect(pricing.document.getText("content").toString()).toBe(source);
      expect(state().frozenFiles).toEqual([]);
      expect((await disk("src/pricing.ts"))).toBe(source);
      expect((await trace()).some((event) => event.type === "ui_action" && event.action === "confirm_pair")).toBe(false);
    }, 15000);
    return;
  }
  it("P2 先后编辑在判定前和判定后保持调用方磁盘内容", async () => {
    const { cartBaseline } = await lock(true);
    await delay(500);
    expect(await disk("src/cart.ts")).toBe(cartBaseline);
    expect(state().blockedPersists).toContainEqual({ file: "src/cart.ts", reason: "pending-judgement" });
    await judgement();
    expect(await disk("src/cart.ts")).toBe(cartBaseline);
  }, 15000);
  it("P1 锁定期间全部连接关闭后保留文档与成员 Undo 历史", async () => {
    const { pricing, cart, cartBaseline } = await lock();
    const record = await judgement();
    const original = await runtime().documents.getDocument(roomId, "src/cart.ts");
    const cartEdited = cart.document.getText("content").toString();
    pricing.provider.disconnect();
    cart.provider.disconnect();
    await delay(200);
    const reopened = await connect("src/cart.ts", bob.member.id);
    expect(reopened.document.getText("content").toString()).toBe(cartEdited);
    expect(await runtime().documents.getDocument(roomId, "src/cart.ts")).toBe(original);
    expect(await disk("src/cart.ts")).toBe(cartBaseline);
    expect((await alice.request(`/conflict-guard/pairs/${record.pair.id}/revert`, { method: "POST" })).status).toBe(204);
    await waitFor(() => state().frozenFiles.length === 0 && state().blockedPersists.length === 0);
    await waitForAsync(async () => (await disk("src/cart.ts")) === cartEdited);
    expect(await disk("src/pricing.ts")).not.toContain("rate: number, currency: string");
    expect((await trace()).some((event) => event.type === "edit" && (event.origin as { kind: string }).kind === "guard-revert")).toBe(true);
  }, 15000);
  it("P1 切换文件后撤回确实恢复原文件并补写另一成员内容", async () => {
    const { pricing, cart } = await lock();
    const record = await judgement();
    pricing.provider.disconnect();
    await connect("src/cart.ts", alice.member.id);
    await delay(150);
    expect((await alice.request(`/conflict-guard/pairs/${record.pair.id}/revert`, { method: "POST" })).status).toBe(204);
    await waitForAsync(async () => !(await disk("src/pricing.ts")).includes("rate: number, currency: string"));
    await waitForAsync(async () => (await disk("src/cart.ts")) === cart.document.getText("content").toString());
    expect(state().pairDecisions.find((entry) => entry.pair.id === record.pair.id)?.resolution).toBe("reverted");
  }, 15000);
  it("P3 外部输入在开头中间末尾通过 Yjs 元素合并并记录冲突", async () => {
    const { pricing } = await lock();
    const record = await judgement();
    const before = await disk("src/pricing.ts");
    const middle = before.indexOf("export function formatMoney");
    const external = `// EXTERNAL START\n${before.slice(0, middle)}// EXTERNAL MIDDLE\n${before.slice(middle)}\n// EXTERNAL END\n`;
    await fs.writeFile(path.join(runtime().project.workspacePath, "src/pricing.ts"), external);
    await runtime().documents.reloadPath("src/pricing.ts");
    await waitFor(() => pricing.document.getText("content").toString().includes("// EXTERNAL END"));
    const expected = external.replace("applyDiscount(price: number, rate: number)", "applyDiscount(price: number, rate: number, currency: string)");
    expect(pricing.document.getText("content").toString()).toBe(expected);
    await waitFor(() => state().pairDecisions.find((entry) => entry.pair.id === record.pair.id)?.status === "judged");
    expect((await trace()).some((event) => event.type === "persist_conflict")).toBe(true);
    expect((await alice.request(`/conflict-guard/pairs/${record.pair.id}/confirm`, { method: "POST" })).status).toBe(204);
    expect((await bob.request(`/conflict-guard/pairs/${record.pair.id}/confirm`, { method: "POST" })).status).toBe(204);
    await waitForAsync(async () => (await disk("src/pricing.ts")) === expected);
  }, 15000);
  it("P4 P6 区域外插入即时移动冻结行号且保留双方确认", async () => {
    const { cart } = await lock();
    const record = await judgement();
    const initial = state().frozenFiles.find((entry) => entry.file === "src/cart.ts")!.regions[0]!;
    expect((await alice.request(`/conflict-guard/pairs/${record.pair.id}/confirm`, { method: "POST" })).status).toBe(204);
    cart.document.getText("content").insert(0, "// outside one\n// outside two\n// outside three\n");
    await waitFor(() => state().frozenFiles.find((entry) => entry.file === "src/cart.ts")!.regions[0]!.startLine === initial.startLine + 3);
    await delay(1700);
    const current = state().pairDecisions.find((entry) => entry.pair.id === record.pair.id)!;
    expect(current.revision).toBe(record.revision);
    expect(current.leftConfirmed || current.rightConfirmed).toBe(true);
    expect((await bob.request(`/conflict-guard/pairs/${record.pair.id}/confirm`, { method: "POST" })).status).toBe(204);
    cart.document.getText("content").insert(0, "// another outside\n");
    await delay(1700);
    expect(state().pairDecisions.find((entry) => entry.pair.id === record.pair.id)?.status).toBe("resolved");
  }, 15000);
  it("P7 新增旧名称引用仍与已改名导出形成黑区关系", async () => {
    const pricing = await connect("src/pricing.ts", alice.member.id);
    replace(pricing.document, "function applyDiscount(", "function applyDiscountV2(");
    await delay(1800);
    const report = await connect("src/report.ts", bob.member.id);
    replace(report.document, 'return "Shop report"', "return String(applyDiscount(10, 0.1))");
    await waitFor(() => state().pairDecisions.some((record) => record.verdict?.ruleId === "runtime-export-removed"));
    expect(state().candidatePairs.some((pair) => [pair.left.symbol, pair.right.symbol].includes("src/pricing.ts#applyDiscount"))).toBe(true);
    replace(report.document, "return String(applyDiscount(10, 0.1))", 'return "Changed report"');
    await waitFor(() => state().candidatePairs.length === 0);
    expect(state().frozenFiles).toEqual([]);
    await waitForAsync(async () => (await disk("src/report.ts")).includes('return "Changed report"'));
  }, 15000);
  it("同名本地函数保持独立关系，不与改名导出形成冻结", async () => {
    const independent = "function applyDiscount(price: number) { return price; }\nexport function independentCheckout(price: number) { return applyDiscount(price); }\n";
    await fs.writeFile(path.join(runtime().project.workspacePath, "src/independent.ts"), independent);
    const pricing = await connect("src/pricing.ts", alice.member.id);
    const consumer = await connect("src/independent.ts", bob.member.id);
    replace(pricing.document, "function applyDiscount(", "function applyDiscountV2(");
    await waitFor(() => state().activeSymbols.some((group) => group.actor.kind === "human" && group.actor.memberId === alice.member.id && group.symbols.some((symbol) => symbol.status === "deleted")));
    replace(consumer.document, "return applyDiscount(price);", "return applyDiscount(price) + 1;");
    await waitFor(() => state().activeSymbols.some((group) => group.actor.kind === "human" && group.actor.memberId === bob.member.id && group.symbols.some((symbol) => symbol.name === "independentCheckout")));
    expect(guard().semanticIndex.outgoing("src/independent.ts#independentCheckout")).toContainEqual({ from: "src/independent.ts#independentCheckout", to: "src/independent.ts#applyDiscount", kind: "call", via: [] });
    expect(state().candidatePairs).toEqual([]);
    expect(state().frozenFiles).toEqual([]);
    expect(state().blockedPersists).toEqual([]);
    await waitForAsync(async () => (await disk("src/independent.ts")) === independent.replace("return applyDiscount(price);", "return applyDiscount(price) + 1;"));
  }, 15000);
  it("整段替换冻结方法后保留当前声明的完整行范围", async () => {
    const { cart } = await lock();
    await judgement();
    const key = "src/cart.ts#Cart.total";
    const previous = guard().symbol(key)!.text;
    const after = "total(): number {\n    let amount = 5;\n    const result = applyDiscount(amount, 0.2);\n    return result;\n  }";
    replace(cart.document, previous, after);
    await waitFor(() => guard().symbol(key)?.text === after);
    const current = guard().semanticIndex.symbolsInFile("src/cart.ts").find((symbol) => symbol.key === key)!;
    expect(state().frozenFiles.find((file) => file.file === "src/cart.ts")?.regions).toEqual(expect.arrayContaining([expect.objectContaining({ startLine: current.startLine, endLine: current.endLine })]));
    await delay(1700);
    expect(state().frozenFiles.find((file) => file.file === "src/cart.ts")?.regions).toEqual(expect.arrayContaining([expect.objectContaining({ startLine: current.startLine, endLine: current.endLine })]));
  }, 15000);
  it("N 冻结区域中的一个事务只记录一次违规", async () => {
    const { cart } = await lock();
    await judgement();
    const before = (await trace()).filter((event) => event.type === "freeze_violation").length;
    replace(cart.document, "let amount = 0", "let amount = 2");
    await waitForAsync(async () => (await trace()).filter((event) => event.type === "freeze_violation").length > before);
    expect((await trace()).filter((event) => event.type === "freeze_violation").length).toBe(before + 1);
  }, 15000);
  it("C9 单方接口变化结束批次后即可触发依赖方 T0", async () => {
    const pricing = await connect("src/pricing.ts", alice.member.id);
    replace(pricing.document, "applyDiscount(price: number, rate: number)", "applyDiscount(price: number, rate: number, currency: string)");
    await delay(1800);
    expect(state().candidatePairs).toEqual([]);
    const checkout = await connect("src/checkout.ts", bob.member.id);
    replace(checkout.document, "formatMoney(cart.total())", "formatMoney(cart.total() + 1)");
    await waitFor(() => guard().state(bob.member.id).t0Warnings.length === 1);
    expect(guard().state(alice.member.id).t0Warnings).toEqual([]);
    await delay(1700);
    expect(validateTraceDetailed(await trace()).valid).toBe(true);
  }, 15000);
  it("公开箭头函数属性签名变化向新批次发送 T0", async () => {
    await fs.writeFile(path.join(runtime().project.workspacePath, "src/box.ts"), "export class Box { apply = (value: number) => value; }\n");
    await fs.writeFile(path.join(runtime().project.workspacePath, "src/use-box.ts"), "import { Box } from './box'; export function useBox() { const box = new Box(); return box.apply(1); }\n");
    const box = await connect("src/box.ts", alice.member.id);
    replace(box.document, "value: number", "value: string");
    await waitFor(() => guard().tracker.getActiveChangeSets().some((set) => set.actor.kind === "human" && set.actor.memberId === alice.member.id && set.status === "settled"));
    const consumer = await connect("src/use-box.ts", bob.member.id);
    replace(consumer.document, "box.apply(1)", "box.apply(2)");
    await waitFor(() => guard().state(bob.member.id).t0Warnings.some((warning) => warning.summary.includes("Box.apply")));
    expect(guard().state(alice.member.id).t0Warnings).toEqual([]);
  }, 15000);
  it("P2 白区文件允许写入并且不受其他文件持续输入影响", async () => {
    const pricing = await connect("src/pricing.ts", alice.member.id);
    const checkout = await connect("src/checkout.ts", bob.member.id);
    replace(pricing.document, "return price * (1 - rate);", "console.log('audit'); return price * (1 - rate);");
    replace(checkout.document, "cart.total()", "cart.total() + 1");
    await waitFor(() => state().pairDecisions.some((entry) => entry.verdict?.decision === "allow"));
    const report = await connect("src/report.ts", bob.member.id);
    for (let iteration = 0; iteration < 6; iteration += 1) {
      report.document.getText("content").insert(0, `// input ${iteration}\n`);
      expect(guard().persistGate("src/checkout.ts").allowed).toBe(true);
      await delay(200);
    }
    await waitForAsync(async () => (await disk("src/checkout.ts")) === checkout.document.getText("content").toString());
  }, 15000);
  it("P1 结束活跃修改后关闭变更对并立即恢复写入", async () => {
    const { cart } = await lock();
    const record = await judgement();
    expect(state().blockedPersists.length).toBeGreaterThan(0);
    await alice.request("/conflict-guard/done", { method: "POST" });
    await bob.request("/conflict-guard/done", { method: "POST" });
    expect(guard().pairCoordinator.get(record.pair.id)?.status).toBe("closed");
    expect(state().blockedPersists).toEqual([]);
    await waitForAsync(async () => (await disk("src/cart.ts")) === cart.document.getText("content").toString());
  }, 15000);
});

function delay(ms: number) { return new Promise<void>((resolve) => setTimeout(resolve, ms)); }
async function waitFor(check: () => boolean) { await waitForAsync(async () => check()); }
async function waitForAsync(check: () => Promise<boolean>) {
  const end = Date.now() + 7000;
  while (!await check()) { if (Date.now() >= end) throw new Error("等待检查点状态超时"); await delay(20); }
}
