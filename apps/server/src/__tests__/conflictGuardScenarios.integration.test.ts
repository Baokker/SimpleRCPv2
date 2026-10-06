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
import { FILESYSTEM_ORIGIN } from "../textDelta.js";

const shopRoot = fileURLToPath(new URL("../../../../demo/conflict-shop/", import.meta.url));

for (const mode of ["rules", "observe"] as const) describe(`阶段 3 场景生产参数 ${mode}`, () => {
  let root: string;
  let app: Awaited<ReturnType<typeof createApp>>;
  let server: http.Server;
  let realtime: ReturnType<typeof attachRealtimeServer>;
  let origin: string;
  let projectId: string;
  let roomId: string;
  let alice: Awaited<ReturnType<typeof joinMember>>;
  let bob: Awaited<ReturnType<typeof joinMember>>;
  let baseline: Record<string, string>;
  const clients: Array<{ document: Y.Doc; provider: WebsocketProvider }> = [];
  const runtime = () => app.locals.runtimeManager.get(projectId) as ProjectRuntime;
  const guard = () => runtime().conflictGuard!;
  const state = () => guard().state();
  const disk = (file: string) => fs.readFile(path.join(runtime().project.workspacePath, file), "utf8");

  beforeEach(async () => {
    root = await createTestWorkspace("guard-scenario-");
    await fs.mkdir(path.join(root, "demo"));
    baseline = {};
    for (const file of await fs.readdir(path.join(shopRoot, "src"))) baseline[`src/${file}`] = await fs.readFile(path.join(shopRoot, "src", file), "utf8");
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

  async function connect(file: string, memberId: string) {
    const document = new Y.Doc();
    const provider = new WebsocketProvider(`${origin}/yjs/${projectId}`, encodeURIComponent(`${roomId}:${file}`), document, { disableBc: true, params: { memberId }, WebSocketPolyfill: WebSocket as unknown as typeof globalThis.WebSocket });
    clients.push({ document, provider });
    await new Promise<void>((resolve, reject) => { provider.once("sync", (synced) => { if (synced) resolve(); }); provider.once("connection-error", reject); });
    return document;
  }

  function replace(document: Y.Doc, before: string, after: string) {
    const text = document.getText("content");
    const start = text.toString().indexOf(before);
    expect(start).toBeGreaterThanOrEqual(0);
    document.transact(() => { text.delete(start, before.length); text.insert(start, after); });
  }

  async function judgement(ruleId: string) {
    await waitFor(async () => state().pairDecisions.some((record) => record.status === "judged" && record.verdict?.ruleId === ruleId));
    return state().pairDecisions.find((record) => record.status === "judged" && record.verdict?.ruleId === ruleId)!;
  }

  async function lock() {
    const pricing = await connect("src/pricing.ts", alice.member.id);
    const cart = await connect("src/cart.ts", bob.member.id);
    replace(pricing, "applyDiscount(price: number, rate: number)", "applyDiscount(price: number, rate: number, currency: string)");
    replace(cart, "applyDiscount(amount, 0.1)", "applyDiscount(amount, 0.2)");
    const record = await judgement("call-signature-incompatible");
    return { pricing, cart, record };
  }

  async function save(name: string) {
    await waitFor(async () => guard().tracker.getOpenBatches().length === 0);
    await delay(100);
    await guard().waitForTrace();
    const text = await guard().exportTrace();
    const events = readTrace(text);
    expect(validateTraceDetailed(events).valid).toBe(true);
    const directory = process.env.SIMPLERCP_CHECKPOINT_EVIDENCE;
    if (directory) {
      await fs.mkdir(directory, { recursive: true });
      await fs.writeFile(path.join(directory, `${mode}-${name}.jsonl`), text);
      await fs.writeFile(path.join(directory, `${mode}-${name}-project.json`), JSON.stringify(baseline, null, 2) + "\n");
    }
    return events;
  }

  if (mode === "observe") {
    it("场景 11 观察模式记录黑区并正常写入文件", async () => {
      const { pricing, cart } = await lock();
      expect(state().frozenFiles).toEqual([]);
      expect(state().blockedPersists).toEqual([]);
      await waitFor(async () => (await disk("src/pricing.ts")) === pricing.getText("content").toString() && (await disk("src/cart.ts")) === cart.getText("content").toString());
      await save("observe");
    }, 15000);
    return;
  }

  it("场景 2 日志修改白区放行并正常写入文件", async () => {
    const pricing = await connect("src/pricing.ts", alice.member.id);
    const checkout = await connect("src/checkout.ts", bob.member.id);
    replace(pricing, "return price * (1 - rate);", 'console.log("discount", price);\n  return price * (1 - rate);');
    replace(checkout, "formatMoney(cart.total())", "formatMoney(cart.total() + 1)");
    expect((await judgement("observability-only")).verdict?.decision).toBe("allow");
    expect(state().frozenFiles).toEqual([]);
    await waitFor(async () => (await disk("src/pricing.ts")) === pricing.getText("content").toString() && (await disk("src/checkout.ts")) === checkout.getText("content").toString());
    await save("white");
  }, 15000);

  it("场景 3 计算修改灰区通知并正常写入文件", async () => {
    const pricing = await connect("src/pricing.ts", alice.member.id);
    const checkout = await connect("src/checkout.ts", bob.member.id);
    replace(pricing, "return price * (1 - rate);", "return price - rate;");
    replace(checkout, "formatMoney(cart.total())", "formatMoney(cart.total() + 1)");
    expect((await judgement("semantic-interaction-uncertain")).verdict?.decision).toBe("warn");
    expect(state().frozenFiles).toEqual([]);
    await waitFor(async () => (await disk("src/pricing.ts")) === pricing.getText("content").toString() && (await disk("src/checkout.ts")) === checkout.getText("content").toString());
    await save("grey");
  }, 15000);

  it("场景 4 合并独有类型错误冻结并记录四状态诊断", async () => {
    const pricing = await connect("src/pricing.ts", alice.member.id);
    const checkout = await connect("src/checkout.ts", bob.member.id);
    replace(pricing, "currency: Currency = Currency.USD): string", "currency: Currency = Currency.USD): number");
    replace(pricing, "return `${currency} ${amount.toFixed(2)}`;", "return amount;");
    replace(checkout, "formatMoney(cart.total())", "formatMoney(cart.total()).toUpperCase()");
    const record = await judgement("merge-only-type-error");
    expect(record.verdict?.typecheck?.ran).toBe(true);
    expect(record.verdict?.typecheck?.mergeOnlyDiagnostics?.some((diagnostic) => diagnostic.includes("2339"))).toBe(true);
    expect(state().frozenFiles.map((file) => file.file)).toEqual(expect.arrayContaining(["src/pricing.ts", "src/checkout.ts"]));
    await save("merge-type-error");
  }, 15000);

  it("场景 7 双方确认解除冻结并写入双方当前内容", async () => {
    const { pricing, cart, record } = await lock();
    expect((await alice.request(`/conflict-guard/pairs/${record.pair.id}/confirm`, { method: "POST" })).status).toBe(204);
    expect(state().frozenFiles.length).toBeGreaterThan(0);
    expect((await bob.request(`/conflict-guard/pairs/${record.pair.id}/confirm`, { method: "POST" })).status).toBe(204);
    await waitFor(async () => state().pairDecisions.find((entry) => entry.pair.id === record.pair.id)?.resolution === "overridden" && state().frozenFiles.length === 0);
    await waitFor(async () => (await disk("src/pricing.ts")) === pricing.getText("content").toString() && (await disk("src/cart.ts")) === cart.getText("content").toString());
    await save("confirmed");
  }, 15000);

  it("场景 8 参数改为可选后自动解除冻结并恢复写入", async () => {
    const { pricing, cart, record } = await lock();
    replace(pricing, "currency: string)", "currency?: string)");
    await waitFor(async () => state().pairDecisions.find((entry) => entry.pair.id === record.pair.id)?.resolution === "auto-cleared" && state().frozenFiles.length === 0);
    await waitFor(async () => (await disk("src/pricing.ts")) === pricing.getText("content").toString() && (await disk("src/cart.ts")) === cart.getText("content").toString());
    await save("rejudged");
  }, 15000);

  it("场景 6 撤回后补写调用方并保留双方原文哈希", async () => {
    const { pricing, cart, record } = await lock();
    expect((await alice.request(`/conflict-guard/pairs/${record.pair.id}/revert`, { method: "POST" })).status).toBe(204);
    await waitFor(async () => pricing.getText("content").toString() === baseline["src/pricing.ts"] && state().frozenFiles.length === 0);
    await waitFor(async () => (await disk("src/cart.ts")) === cart.getText("content").toString());
    const events = await save("reverted");
    expect(events.some((event) => event.type === "pair_resolved" && event.resolution === "reverted")).toBe(true);
    expect(events.some((event) => event.type === "edit" && (event.origin as { kind?: string })?.kind === "guard-revert")).toBe(true);
  }, 15000);

  it("P1 已完成文档释放并重新打开后撤回新一轮修改", async () => {
    const pricing = await connect("src/pricing.ts", alice.member.id);
    replace(pricing, "return price * (1 - rate);", "return price * (1 - rate) + 1;");
    await waitFor(async () => guard().tracker.getActiveChangeSets().some((set) => set.actor.kind === "human" && set.actor.memberId === alice.member.id && set.status === "settled"));
    const reopenedBaseline = pricing.getText("content").toString();
    await waitFor(async () => (await disk("src/pricing.ts")) === reopenedBaseline);
    const original = await runtime().documents.getDocument(roomId, "src/pricing.ts");
    expect((await alice.request("/conflict-guard/done", { method: "POST" })).status).toBe(204);
    clients.find((client) => client.document === pricing)!.provider.destroy();
    await waitFor(async () => original.isDestroyed);
    const reopened = await connect("src/pricing.ts", alice.member.id);
    expect(await runtime().documents.getDocument(roomId, "src/pricing.ts")).not.toBe(original);
    expect(reopened.getText("content").toString()).toBe(reopenedBaseline);
    const cart = await connect("src/cart.ts", bob.member.id);
    replace(reopened, "applyDiscount(price: number, rate: number)", "applyDiscount(price: number, rate: number, currency: string)");
    replace(cart, "applyDiscount(amount, 0.1)", "applyDiscount(amount, 0.2)");
    const record = await judgement("call-signature-incompatible");
    expect((await alice.request(`/conflict-guard/pairs/${record.pair.id}/revert`, { method: "POST" })).status).toBe(204);
    await waitFor(async () => reopened.getText("content").toString() === reopenedBaseline && state().frozenFiles.length === 0);
    await waitFor(async () => (await disk("src/pricing.ts")) === reopenedBaseline && (await disk("src/cart.ts")) === cart.getText("content").toString());
    const events = readTrace(await guard().exportTrace());
    expect(events.some((event) => event.type === "edit" && (event.origin as { kind?: string })?.kind === "guard-revert")).toBe(true);
    expect(validateTraceDetailed(events).valid).toBe(true);
  }, 20000);

  it("P2 删除被引用导出时等待判定期间保持磁盘原文", async () => {
    const cart = await connect("src/cart.ts", bob.member.id);
    replace(cart, "applyDiscount(amount, 0.1)", "applyDiscount(amount, 0.2)");
    await waitFor(async () => guard().tracker.getActiveChangeSets().some((set) => set.actor.kind === "human" && set.actor.memberId === bob.member.id && set.status === "settled"));
    const pricing = await connect("src/pricing.ts", alice.member.id);
    replace(pricing, "export function applyDiscount(price: number, rate: number): number {\n  return price * (1 - rate);\n}\n", "");
    await delay(500);
    expect(state().blockedPersists).toContainEqual({ file: "src/pricing.ts", reason: "pending-judgement" });
    expect(await disk("src/pricing.ts")).toBe(baseline["src/pricing.ts"]);
    expect((await judgement("runtime-export-removed")).verdict?.decision).toBe("lock");
    expect(await disk("src/pricing.ts")).toBe(baseline["src/pricing.ts"]);
  }, 15000);

  it("场景 9 直接 Yjs 写入冻结区记录违规并保留共享修改", async () => {
    const { cart } = await lock();
    replace(cart, "let amount = 0", "let amount = 2");
    await waitFor(async () => (readTrace(await guard().exportTrace())).some((event) => event.type === "freeze_violation"));
    const events = await save("freeze-violation");
    expect(events.filter((event) => event.type === "freeze_violation")).toHaveLength(1);
  }, 15000);

  it("B3 多文件观察者遗漏后 resync 保留范围与冻结", async () => {
    const { pricing, record } = await lock();
    const before = state().activeSymbols.find((set) => set.actor.kind === "human" && set.actor.memberId === alice.member.id)!.symbols.find((symbol) => symbol.name === "applyDiscount")!;
    const document = await runtime().documents.getDocument(roomId, "src/pricing.ts");
    const text = document.getText("content");
    const observer = (text as unknown as { _eH: { l: Array<(event: Y.YTextEvent, transaction: Y.Transaction) => void> } })._eH.l[1]!;
    text.unobserve(observer);
    try { document.transact(() => text.insert(0, "// resync first\n"), FILESYSTEM_ORIGIN); }
    finally { text.observe(observer); }
    document.transact(() => text.insert(0, "// resync second\n"), FILESYSTEM_ORIGIN);
    await waitFor(async () => state().activeSymbols.find((set) => set.actor.kind === "human" && set.actor.memberId === alice.member.id)!.symbols.find((symbol) => symbol.name === "applyDiscount")!.startLine === before.startLine + 2);
    expect(state().pairDecisions.find((entry) => entry.pair.id === record.pair.id)?.revision).toBe(record.revision);
    expect(pricing.getText("content").toString()).toContain("// resync second\n// resync first\n");
    const events = await save("mirror-resync-multifile");
    expect(events.filter((event) => event.type === "mirror_resync")).toHaveLength(1);
  }, 15000);
});

function delay(ms: number) { return new Promise<void>((resolve) => setTimeout(resolve, ms)); }
async function waitFor(check: () => Promise<boolean>) {
  const end = Date.now() + 8000;
  while (!await check()) { if (Date.now() >= end) throw new Error("等待阶段 3 场景超时"); await delay(20); }
}
