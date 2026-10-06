import fs from "node:fs/promises";
import path from "node:path";
import http from "node:http";
import { fileURLToPath } from "node:url";
import { afterEach, expect, it } from "vitest";
import WebSocket from "ws";
import { WebsocketProvider } from "y-websocket";
import * as Y from "yjs";
import type { AgentRun } from "@simplercp/shared";
import { defaultAdjudicationConfig, ProviderError, readTrace, validateTrace, type JudgeResult } from "@simplercp/conflict-guard";
import { createApp } from "../createApp.js";
import { attachRealtimeServer } from "../realtime.js";
import { joinMember } from "./memberTestHelper.js";
import { createTestWorkspace } from "./testWorkspace.js";
import type { ProjectRuntime } from "../projectRuntime.js";
import { createPatch } from "diff";
import { createPermissionDispatcher } from "../agent/permissionDispatcher.js";
import { conflictGuardEditHandler } from "../agent/conflictGuardEditHandler.js";

const shop = fileURLToPath(new URL("../../../../demo/conflict-shop/", import.meta.url));
const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { for (const dispose of cleanup.reverse()) await dispose(); cleanup.length = 0; });
async function setup(mode: "off" | "observe" | "rules" | "full" = "rules", model?: { decision: "allow" | "warn" | "lock"; delay?: number; timeout?: boolean; runTimeoutMs?: number }, linked = false) {
  const root = await createTestWorkspace("agent-guard-");
  const accessRoot = linked ? `${root}-link` : root;
  if (linked) {
    await fs.symlink(root, accessRoot, "dir");
    cleanup.push(async () => { await fs.unlink(accessRoot); });
  }
  let modelCalls = 0;
  const judge = async (): Promise<JudgeResult> => { modelCalls += 1; await new Promise((resolve) => setTimeout(resolve, model?.delay ?? 1)); if (model?.timeout) throw new ProviderError("timeout"); return { decision: model?.decision ?? "warn", confidence: 0.9, latencyMs: model?.delay ?? 1, raw: {}, userExplanation: "关联计算需要检查。", suggestedAction: "请 Agent 检查调用方式。" }; };
  const app = await createApp({ port: 0, host: "127.0.0.1", publicOrigin: "http://127.0.0.1:5173", dataDir: path.join(accessRoot, "data"), demoProjectRoot: shop, terminalEnabled: false, fakeAgentRuntime: true, agent: { runTimeoutMs: model?.runTimeoutMs ?? 600000, maxConcurrentRuns: 3, model: "fake-agent", openCodePort: 4199, baseUrl: "http://127.0.0.1:4199" }, importRoots: [path.dirname(shop)], conflictGuard: { mode, idleMs: 1500, cursorLeaveLines: 3, maxBatchDurationMs: 5000, activeIdleMs: 600000, cursorDebounceMs: 100, ...(model ? { adjudication: { settings: defaultAdjudicationConfig, jev: {}, deepseek: { model: "test" }, judges: { fast: { name: "test-fast", model: "test", judge }, deep: { name: "test-deep", model: "test", judge } } } } : {}) } });
  const project = await app.locals.registry.importDirectory("Agent shop", shop);
  const runtime = app.locals.runtimeManager.get(project.id) as ProjectRuntime;
  const server = http.createServer(app);
  const realtime = attachRealtimeServer(server, app.locals.runtimeManager, app.locals.agentRuns, { members: app.locals.members });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); if (!address || typeof address === "string") throw new Error("服务器地址无效");
  const origin = `http://127.0.0.1:${address.port}`;
  cleanup.push(async () => { await app.locals.agentRuns.dispose(); realtime.dispose(); await app.locals.runtimeManager.dispose(); await new Promise<void>((resolve) => server.close(() => resolve())); await fs.rm(root, { recursive: true, force: true }); });
  const alice = await joinMember(origin, project.id, { name: "Alice" });
  const bob = await joinMember(origin, project.id, { name: "Bob" });
  const connect = async (file: string, memberId = alice.member.id) => {
    const document = new Y.Doc();
    const provider = new WebsocketProvider(`${origin}/yjs/${project.id}`, encodeURIComponent(`${runtime.room.id}:${file}`), document, { disableBc: true, params: { memberId }, WebSocketPolyfill: WebSocket as unknown as typeof globalThis.WebSocket });
    cleanup.push(async () => { provider.destroy(); document.destroy(); });
    await new Promise<void>((resolve, reject) => { provider.once("sync", (synced) => { if (synced) resolve(); }); provider.once("connection-error", reject); });
    return document;
  };
  const run = (prompt: string, memberId = bob.member.id) => app.locals.agentRuns.createRun({ projectId: project.id, memberId, prompt });
  const getRun = (id: string): Promise<AgentRun> => app.locals.agentRuns.getRun(project.id, id);
  const trace = (id: string) => app.locals.agentRuns.listTrace(project.id, id);
  return { app, runtime, workspacePath: project.workspacePath, alice, bob, connect, run, getRun, trace, modelCalls: () => modelCalls, disk: (file: string) => fs.readFile(path.join(runtime.project.workspacePath, file), "utf8") };
}
function replace(document: Y.Doc, before: string, after: string) { const text = document.getText("content"); const from = text.toString().indexOf(before); expect(from).toBeGreaterThanOrEqual(0); document.transact(() => { text.delete(from, before.length); text.insert(from, after); }); }
async function waitFor(check: () => boolean | Promise<boolean>, timeout = 9000) { const deadline = performance.now() + timeout; while (!await check()) { if (performance.now() > deadline) throw new Error("等待 Agent 检查超时"); await new Promise((resolve) => setTimeout(resolve, 25)); } }
const edit = (file: string, from: string, to: string) => `${file}:${encodeURIComponent(from)}=>${encodeURIComponent(to)}`;

it("accepts and rejects Agent edits through a symbolic workspace using production timings", async () => {
  const context = await setup("rules", undefined, true);
  const workspace = context.workspacePath;
  const canonical = await fs.realpath(workspace);
  const guard = context.runtime.conflictGuard!;
  const file = "src/cart.ts";
  const before = await context.disk(file);
  guard.beginAgentRun({ kind: "agent", runId: "symbolic-run", ownerId: context.bob.member.id }, new Map([[file, before]]));
  const handler = conflictGuardEditHandler({ workspace, judge: (proposals, signal) => guard.agentGuard.judge("symbolic-run", proposals, signal), approved: () => {} });
  const request = { id: "symbolic-edit", sessionID: "symbolic-session", permission: "edit", metadata: { filepath: path.join(canonical, file), diff: createPatch(file, before, before.replace("let amount = 0;", "let amount = 10;")) } };
  const allowed = await handler(request, new AbortController().signal);
  expect(allowed.reply).toBe("once");
  await allowed.onRejected?.();
  const pricing = await context.connect("src/pricing.ts");
  replace(pricing, "rate: number)", "rate: number, currency: string)");
  await waitFor(() => guard.state().activeSymbols.some((set) => set.actor.kind === "human"));
  const rejected = await handler({ ...request, id: "symbolic-conflict" }, new AbortController().signal);
  expect(rejected.reply).toBe("reject");
  expect(rejected.message).toContain("applyDiscount");
  expect(rejected.message).not.toContain("could not verify");
}, 15000);

it("captures the disk baseline before awaiting tool input with production persistence timings", async () => {
  const context = await setup();
  const file = "src/cart.ts";
  const before = await context.disk(file);
  const document = await context.connect(file);
  const guard = context.runtime.conflictGuard!;
  const runId = "delayed-tool-input";
  guard.beginAgentRun({ kind: "agent", runId, ownerId: context.bob.member.id }, new Map([[file, before]]));
  let reading!: () => void;
  const started = new Promise<void>((resolve) => { reading = resolve; });
  const oldString = "let amount = 0;";
  const newString = "let amount = 10;";
  const toolFile = path.join(context.workspacePath, "tool-input.json");
  await fs.writeFile(toolFile, JSON.stringify({ tool: "edit", input: { oldString, newString } }));
  const replies: Array<{ reply: string; message?: string }> = [];
  const handler = conflictGuardEditHandler({ workspace: context.workspacePath, judge: (proposals, signal) => guard.agentGuard.judge(runId, proposals, signal), approved: () => {}, async toolInput() {
    reading();
    await new Promise((resolve) => setTimeout(resolve, 1500));
    return JSON.parse(await fs.readFile(toolFile, "utf8"));
  } });
  const dispatcher = createPermissionDispatcher({ handlers: [handler], trace: async () => {}, reply: async (reply) => {
    replies.push(reply);
    if (reply.reply === "once") await fs.writeFile(path.join(context.workspacePath, file), before.replace(oldString, newString));
  } });
  const permission = dispatcher.dispatch({ id: "delayed-input", sessionID: "session", permission: "edit", metadata: { filepath: file, diff: createPatch(file, before, before.replace(oldString, newString)) } });
  await started;
  replace(document, "this.items = [...this.items, item];", "this.items = [item, ...this.items];");
  await waitFor(async () => (await context.disk(file)).includes("this.items = [item, ...this.items];"));
  await permission;
  expect(replies).toEqual([expect.objectContaining({ reply: "reject", message: "文件在你修改期间已被他人更新，请重新读取后再修改" })]);
  expect(await context.disk(file)).toContain("this.items = [item, ...this.items];");
  expect(guard.agentGuard.pendingFile(file)).toBe(false);
  dispatcher.dispose();
}, 15000);

it("does not activate a write reservation after approval is cancelled during disk validation", async () => {
  const context = await setup();
  const guard = context.runtime.conflictGuard!;
  const file = "src/cart.ts";
  const before = await context.disk(file);
  const runId = "cancelled-disk-validation";
  guard.beginAgentRun({ kind: "agent", runId, ownerId: context.bob.member.id }, new Map([[file, before]]));
  const controller = new AbortController();
  let approved = 0;
  const handler = conflictGuardEditHandler({ workspace: context.workspacePath, judge: (proposals, signal) => guard.agentGuard.judge(runId, proposals, signal), approved: () => { approved += 1; } });
  const decision = await handler({ id: "cancel-validation", sessionID: "session", permission: "edit", metadata: { filepath: file, diff: createPatch(file, before, before.replace("let amount = 0;", "let amount = 10;")) } }, controller.signal);
  expect(decision.reply).toBe("once");
  const approval = Promise.resolve(decision.onApproved?.());
  controller.abort();
  await expect(approval).rejects.toThrow("审批分析已取消，本次修改未获批准。");
  expect(approved).toBe(0);
  expect(guard.agentGuard.pendingFile(file)).toBe(false);
  expect(await context.disk(file)).toBe(before);
  await decision.onRejected?.();
}, 15000);

it("rejects an Agent signature conflict, accepts a compatible retry and keeps the human editable", async () => {
  const context = await setup();
  const pricing = await context.connect("src/pricing.ts");
  replace(pricing, "rate: number)", "rate: number, currency: string)");
  await waitFor(() => context.runtime.conflictGuard!.state().activeSymbols.some((set) => set.symbols.some((symbol) => symbol.key.endsWith("#applyDiscount"))));
  const before = "applyDiscount(amount, 0.1)";
  const created = await context.run(`fake-edit=${edit("src/cart.ts", before, "applyDiscount(amount + 1, 0.1)")} fake-on-reject=${edit("src/cart.ts", before, 'applyDiscount(amount, 0.1, "CNY")')} fake-delay=500`);
  await waitFor(async () => (await context.trace(created.id)).some((event: { type: string }) => event.type === "permission_reply"), 3000);
  await waitFor(async () => (await context.getRun(created.id)).status === "completed");
  const run = await context.getRun(created.id);
  expect(run.conflictGuard?.rejectedEdits).toBe(1);
  expect(run.conflictGuard?.lastRejection).toMatch(/applyDiscount.*signature|signature.*applyDiscount/s);
  expect(await context.disk("src/cart.ts")).toContain('applyDiscount(amount, 0.1, "CNY")');
  expect(context.runtime.conflictGuard!.state().frozenFiles).toEqual([]);
  replace(pricing, "return price * (1 - rate);", "return price * (1 - rate) + 0;");
  expect(pricing.getText("content").toString()).toContain("+ 0");
  await new Promise((resolve) => setTimeout(resolve, 1600));
  expect(validateTrace(readTrace(await context.runtime.conflictGuard!.exportTrace()))).toBe(true);
}, 15000);

it("discovers a bash write in the run snapshot and checks it at T3", async () => {
  const context = await setup();
  const original = await context.disk("src/cart.ts");
  const created = await context.run(`fake-bash-edit=${edit("src/cart.ts", "let amount = 0;", "let amount = 10;")} fake-delay=2800`);
  await waitFor(async () => (await context.disk("src/cart.ts")).includes("let amount = 10;"));
  const pricing = await context.connect("src/pricing.ts");
  replace(pricing, "rate: number)", "rate: number, currency: string)");
  await waitFor(async () => (await context.getRun(created.id)).status === "completed");
  expect((await context.getRun(created.id)).conflictGuard?.t3).toBe("reverted");
  expect((await context.trace(created.id)).some((event: { type: string }) => event.type === "permission_reply")).toBe(false);
  expect(await context.disk("src/cart.ts")).toBe(original);
}, 15000);

it("reports incomplete T3 attribution when a member edits a bash-written file", async () => {
  const context = await setup();
  const created = await context.run(`fake-bash-edit=${edit("src/cart.ts", "let amount = 0;", "let amount = 10;")} fake-delay=2400`);
  await waitFor(async () => (await context.disk("src/cart.ts")).includes("let amount = 10;"));
  const cart = await context.connect("src/cart.ts");
  replace(cart, "this.items = [...this.items, item];", "this.items = [item, ...this.items];");
  await waitFor(async () => (await context.getRun(created.id)).status === "completed");
  expect((await context.getRun(created.id)).conflictGuard?.t3).toBe("warned");
  expect((await context.trace(created.id)).some((event: { type: string }) => event.type === "t3_incomplete")).toBe(true);
  expect(context.runtime.conflictGuard!.agentGuard.notices(context.bob.member.id).some((notice) => notice.summary.includes("人工处理"))).toBe(true);
  expect(cart.getText("content").toString()).toContain("let amount = 10;");
  expect(cart.getText("content").toString()).toContain("this.items = [item, ...this.items];");
  expect(validateTrace(readTrace(await context.runtime.conflictGuard!.exportTrace()))).toBe(true);
}, 15000);

it("reports incomplete T3 attribution when another run claims a bash-written file", async () => {
  const context = await setup();
  const first = await context.run(`fake-bash-edit=${edit("src/cart.ts", "let amount = 0;", "let amount = 10;")} fake-delay=2400`);
  await waitFor(async () => (await context.disk("src/cart.ts")).includes("let amount = 10;"));
  const second = await context.run(`fake-edit=${edit("src/cart.ts", "this.items = [...this.items, item];", "this.items = [item, ...this.items];")} fake-delay=100`, context.alice.member.id);
  await waitFor(async () => (await context.getRun(second.id)).status === "completed");
  await waitFor(async () => (await context.getRun(first.id)).status === "completed");
  expect((await context.getRun(first.id)).conflictGuard?.t3).toBe("warned");
  expect((await context.trace(first.id)).some((event: { type: string }) => event.type === "t3_incomplete")).toBe(true);
  expect(await context.disk("src/cart.ts")).toContain("let amount = 10;");
  expect(await context.disk("src/cart.ts")).toContain("this.items = [item, ...this.items];");
  expect(validateTrace(readTrace(await context.runtime.conflictGuard!.exportTrace()))).toBe(true);
}, 15000);

it("reports incomplete T3 when the completion snapshot cannot be read", async () => {
  const context = await setup();
  const created = await context.run(`fake-bash-edit=${edit("src/cart.ts", "let amount = 0;", "let amount = 10;")} fake-delay=1200`);
  await waitFor(async () => (await context.disk("src/cart.ts")).includes("let amount = 10;"));
  const workspace = context.runtime.project.workspacePath;
  const retained = `${workspace}-retained`;
  await fs.rename(workspace, retained);
  try {
    await waitFor(async () => (await context.getRun(created.id)).status === "completed");
    expect((await context.getRun(created.id)).conflictGuard?.t3).toBe("warned");
    expect((await context.trace(created.id)).some((event: { type: string }) => event.type === "t3_incomplete")).toBe(true);
  } finally { await fs.rename(retained, workspace); }
}, 15000);

it("keeps Agent tracking available after a workspace directory is created", async () => {
  const context = await setup();
  await fs.mkdir(path.join(context.runtime.project.workspacePath, "notes"));
  context.runtime.announceWorkspaceChange({ type: "addDir", path: "notes" });
  await fs.rename(path.join(context.runtime.project.workspacePath, "notes"), path.join(context.runtime.project.workspacePath, "archived-notes"));
  context.runtime.announceWorkspaceChange({ type: "rename", fromPath: "notes", path: "archived-notes" });
  await new Promise((resolve) => setTimeout(resolve, 350));
  expect(context.runtime.conflictGuard!.state().degraded).toBe(false);
  const created = await context.run(`fake-edit=${edit("src/cart.ts", "let amount = 0;", "let amount = 10;")}`);
  await waitFor(async () => (await context.getRun(created.id)).status === "completed");
  expect((await context.getRun(created.id)).conflictGuard?.rejectedEdits).toBe(0);
}, 15000);

it("does not request T3 adjudication when the dependency was unchanged during the run", async () => {
  const context = await setup("full", { decision: "warn" });
  const pricing = await context.connect("src/pricing.ts");
  replace(pricing, "return price * (1 - rate);", "return price - rate;");
  await waitFor(() => context.runtime.conflictGuard!.state().activeSymbols.some((set) => set.symbols.some((symbol) => symbol.key.endsWith("#applyDiscount"))));
  const created = await context.run(`fake-edit=${edit("src/checkout.ts", "cart.total()", "cart.total() + 1")} fake-delay=100`);
  await waitFor(async () => (await context.getRun(created.id)).status === "completed");
  expect(context.modelCalls()).toBe(1);
  expect((await context.getRun(created.id)).conflictGuard?.t3).toBe("passed");
  expect((await context.getRun(created.id)).conflictGuard?.warnings).toHaveLength(1);
}, 15000);

it("attributes an approved unrelated edit to the run and includes Agents in active candidates", async () => {
  const context = await setup();
  const pricing = await context.connect("src/pricing.ts");
  replace(pricing, "return price * (1 - rate);", "console.log(price); return price * (1 - rate);");
  const created = await context.run(`fake-edit=${edit("src/cart.ts", "applyDiscount(amount, 0.1)", "applyDiscount(amount, 0.2)")} fake-delay=2000`);
  await waitFor(() => context.runtime.conflictGuard!.state().activeSymbols.some((set) => set.actor.kind === "agent" && set.actor.runId === created.id && set.symbols.some((symbol) => symbol.key.endsWith("#Cart.total"))));
  expect(context.runtime.conflictGuard!.state().candidatePairs.some((pair) => pair.left.actor.kind === "agent" || pair.right.actor.kind === "agent")).toBe(true);
  expect(context.runtime.conflictGuard!.state().frozenFiles).toEqual([]);
  await waitFor(async () => (await context.getRun(created.id)).status === "completed");
  expect((await context.getRun(created.id)).conflictGuard?.rejectedEdits).toBe(0);
  const unrelated = await context.run(`fake-edit=${edit("src/isolated.ts", "", "export function isolated() { return 1; }\n")}`);
  await waitFor(async () => (await context.getRun(unrelated.id)).status === "completed");
  expect((await context.getRun(unrelated.id)).conflictGuard?.rejectedEdits).toBe(0);
}, 15000);

for (const decision of ["lock", "warn"] as const) it(`uses the configured T2 model for grey edits: ${decision}`, async () => {
  const context = await setup("full", { decision });
  const pricing = await context.connect("src/pricing.ts");
  replace(pricing, "return price * (1 - rate);", "return price - rate;");
  await waitFor(() => context.runtime.conflictGuard!.state().activeSymbols.some((set) => set.symbols.some((symbol) => symbol.key.endsWith("#applyDiscount"))));
  const created = await context.run(`fake-edit=${edit("src/checkout.ts", "cart.total()", "cart.total() + 1")}`);
  await waitFor(async () => (await context.getRun(created.id)).status === "completed");
  expect(context.modelCalls()).toBe(1);
  expect((await context.getRun(created.id)).conflictGuard?.rejectedEdits).toBe(decision === "lock" ? 1 : 0);
  expect(await context.disk("src/checkout.ts")).toContain(decision === "lock" ? "formatMoney(cart.total())" : "cart.total() + 1");
  expect(context.runtime.conflictGuard!.state().frozenFiles).toEqual([]);
}, 15000);

it("rejects a timed out T2 without failing the run", async () => {
  const context = await setup("full", { decision: "allow", timeout: true });
  const pricing = await context.connect("src/pricing.ts");
  replace(pricing, "return price * (1 - rate);", "return price - rate;");
  await waitFor(() => context.runtime.conflictGuard!.state().activeSymbols.some((set) => set.symbols.some((symbol) => symbol.key.endsWith("#applyDiscount"))));
  const created = await context.run(`fake-edit=${edit("src/checkout.ts", "cart.total()", "cart.total() + 1")}`);
  await waitFor(async () => (await context.getRun(created.id)).status === "completed");
  expect((await context.getRun(created.id)).conflictGuard?.lastRejection).toContain("研判未完成");
  expect(context.runtime.conflictGuard!.state().frozenFiles).toEqual([]);
}, 15000);

it("rechecks a dependency changed while T2 is awaiting a model verdict", async () => {
  const context = await setup("full", { decision: "allow", delay: 700 });
  const pricing = await context.connect("src/pricing.ts");
  replace(pricing, "return price * (1 - rate);", "return price - rate;");
  await waitFor(() => context.runtime.conflictGuard!.state().activeSymbols.some((set) => set.symbols.some((symbol) => symbol.key.endsWith("#applyDiscount"))));
  const original = await context.disk("src/cart.ts");
  const created = await context.run(`fake-edit=${edit("src/cart.ts", "applyDiscount(amount, 0.1)", "applyDiscount(amount + 1, 0.1)")}`);
  await waitFor(() => context.modelCalls() === 1);
  replace(pricing, "rate: number)", "rate: number, currency: string)");
  await waitFor(async () => (await context.getRun(created.id)).status === "completed");
  expect((await context.getRun(created.id)).conflictGuard?.rejectedEdits).toBe(1);
  expect((await context.getRun(created.id)).conflictGuard?.lastRejection).toContain("signature");
  expect(await context.disk("src/cart.ts")).toBe(original);
  expect(context.runtime.conflictGuard!.state().frozenFiles).toEqual([]);
}, 15000);

it("rejects a stale full-file T2 write and keeps a human edit during its 1500ms judgement", async () => {
  const context = await setup("full", { decision: "allow", delay: 1500 });
  const pricing = await context.connect("src/pricing.ts");
  replace(pricing, "return price * (1 - rate);", "return price - rate;");
  await waitFor(() => context.runtime.conflictGuard!.state().activeSymbols.some((set) => set.symbols.some((symbol) => symbol.key.endsWith("#applyDiscount"))));
  const cart = await context.connect("src/cart.ts", context.alice.member.id);
  const from = "applyDiscount(amount, 0.1)";
  const to = "applyDiscount(amount + 1, 0.1)";
  const created = await context.run(`fake-edit=${edit("src/cart.ts", from, to)} fake-on-reject=${edit("src/cart.ts", from, to)} fake-delay=300`);
  await waitFor(() => context.modelCalls() === 1);
  replace(cart, "this.items = [...this.items, item];", "this.items = [item, ...this.items];");
  await waitFor(async () => (await context.disk("src/cart.ts")).includes("[item, ...this.items]"));
  await waitFor(async () => ["completed", "failed"].includes((await context.getRun(created.id)).status), 18000);
  expect(await context.getRun(created.id)).toMatchObject({ status: "completed" });
  expect((await context.getRun(created.id)).conflictGuard?.lastRejection).toContain("文件在你修改期间已被他人更新");
  expect((await context.getRun(created.id)).conflictGuard?.rejectedEdits).toBe(1);
  expect(await context.disk("src/cart.ts")).toContain("[item, ...this.items]");
  expect(await context.disk("src/cart.ts")).toContain(to);
  expect(cart.getText("content").toString()).toContain("[item, ...this.items]");
  expect(cart.getText("content").toString()).toContain(to);
}, 30000);

it("replies to an edit permission from a child Agent session", async () => {
  const context = await setup();
  const created = await context.run(`fake-child=true fake-edit=${edit("src/cart.ts", "let amount = 0;", "let amount = 10;")}`);
  await waitFor(async () => (await context.getRun(created.id)).status === "completed");
  expect(await context.disk("src/cart.ts")).toContain("let amount = 10;");
  const events = await context.trace(created.id);
  const createdChild = events.find((event: { type: string }) => event.type === "opencode.session.created");
  expect(createdChild).toBeDefined();
  expect(events.some((event: { type: string; data?: Record<string, unknown> }) => event.type === "permission_reply" && String(event.data?.sessionId).endsWith("-child"))).toBe(true);
}, 15000);

it("merges an approved Agent write with a human edit made before write confirmation", async () => {
  const context = await setup();
  const cart = await context.connect("src/cart.ts");
  const created = await context.run(`fake-edit=${edit("src/cart.ts", "let amount = 0;", "let amount = 10;")} fake-write-delay=1000 fake-delay=2700`);
  await waitFor(async () => (await context.trace(created.id)).some((event: { type: string }) => event.type === "permission_reply"));
  replace(cart, "this.items = [...this.items, item];", "this.items = [item, ...this.items];");
  await new Promise((resolve) => setTimeout(resolve, 400));
  expect(await context.disk("src/cart.ts")).toContain("this.items = [...this.items, item];");
  await waitFor(() => cart.getText("content").toString().includes("let amount = 10;"));
  await waitFor(async () => (await context.disk("src/cart.ts")).includes("this.items = [item, ...this.items];"));
  expect(await context.disk("src/cart.ts")).toContain("let amount = 10;");
  await waitFor(async () => (await context.getRun(created.id)).status === "completed");
  expect(cart.getText("content").toString()).toContain("this.items = [item, ...this.items];");
}, 15000);

it("keeps a later human dependency edit editable while an Agent run is active", async () => {
  const context = await setup();
  const created = await context.run(`fake-edit=${edit("src/cart.ts", "let amount = 0;", "let amount = 10;")} fake-delay=4000`);
  await waitFor(() => context.runtime.conflictGuard!.state().activeSymbols.some((set) => set.actor.kind === "agent" && set.actor.runId === created.id));
  const pricing = await context.connect("src/pricing.ts");
  replace(pricing, "rate: number)", "rate: number, currency: string)");
  await waitFor(() => context.runtime.conflictGuard!.state().candidatePairs.some((pair) => pair.left.actor.kind === "agent" || pair.right.actor.kind === "agent"));
  await new Promise((resolve) => setTimeout(resolve, 1700));
  expect(context.runtime.conflictGuard!.state().frozenFiles).toEqual([]);
  expect(context.runtime.conflictGuard!.state().pairDecisions.filter((record) => record.pair.left.actor.kind === "human" && record.pair.right.actor.kind === "agent" && record.verdict?.decision === "lock")).toEqual([]);
  replace(pricing, "return price * (1 - rate);", "return price * (1 - rate) + 0;");
  expect(pricing.getText("content").toString()).toContain("+ 0");
  await waitFor(async () => (await context.getRun(created.id)).status === "completed");
}, 15000);

it("reserves precise disjoint functions in one file for two Agent proposals", async () => {
  const context = await setup();
  const guard = context.runtime.conflictGuard!;
  const file = "src/independent.ts";
  const before = "export function tax(amount: number) { return amount * 0.1; }\nexport function label(text: string) { return text.trim(); }\n";
  await fs.writeFile(path.join(context.runtime.project.workspacePath, file), before);
  guard.beginAgentRun({ kind: "agent", runId: "proposal-one", ownerId: context.alice.member.id }, new Map([[file, before]]));
  guard.beginAgentRun({ kind: "agent", runId: "proposal-two", ownerId: context.bob.member.id }, new Map([[file, before]]));
  const first = await guard.agentGuard.judge("proposal-one", [{ file, before, after: before.replace("amount * 0.1", "amount * 0.12") }], new AbortController().signal);
  const second = await guard.agentGuard.judge("proposal-two", [{ file, before, after: before.replace("text.trim()", "text.trim().toUpperCase()") }], new AbortController().signal);
  expect(first.decision).toBe("allow");
  expect(second.decision).toBe("allow");
  first.onApproved?.();
  expect(() => second.onApproved?.()).toThrow("正在确认另一位 Agent");
  first.onRejected?.(); second.onRejected?.();
}, 15000);

it("prevents a second whole-file Agent write until the first reservation is confirmed", async () => {
  const context = await setup();
  const file = "src/independent.ts";
  const before = "export function tax(amount: number) { return amount * 0.1; }\nexport function label(text: string) { return text.trim(); }\n";
  await fs.writeFile(path.join(context.runtime.project.workspacePath, file), before);
  const first = await context.run(`fake-edit=${edit(file, "amount * 0.1", "amount * 0.12")} fake-write-delay=1000 fake-delay=2200`, context.alice.member.id);
  await waitFor(async () => (await context.trace(first.id)).some((event: { type: string }) => event.type === "permission_reply"));
  const second = await context.run(`fake-edit=${edit(file, "text.trim()", "text.trim().toUpperCase()")} fake-delay=10`);
  await waitFor(async () => (await context.getRun(second.id)).status === "completed");
  expect((await context.getRun(second.id)).conflictGuard?.rejectedEdits).toBe(1);
  expect((await context.getRun(second.id)).conflictGuard?.lastRejection).toContain("正在确认另一位 Agent");
  await waitFor(async () => (await context.getRun(first.id)).status === "completed");
  const retry = await context.run(`fake-edit=${edit(file, "text.trim()", "text.trim().toUpperCase()")} fake-delay=10`);
  await waitFor(async () => (await context.getRun(retry.id)).status === "completed");
  expect(await context.disk(file)).toContain("amount * 0.12");
  expect(await context.disk(file)).toContain("text.trim().toUpperCase()");
}, 15000);

it("clears a formatted approval after its two-second confirmation deadline", async () => {
  const context = await setup();
  const guard = context.runtime.conflictGuard!;
  const file = "src/cart.ts";
  const before = await context.disk(file);
  guard.beginAgentRun({ kind: "agent", runId: "formatted-run", ownerId: context.bob.member.id }, new Map([[file, before]]));
  const after = before.replace("let amount = 0;", "let amount = 10;");
  const result = await guard.agentGuard.judge("formatted-run", [{ file, before, after }], new AbortController().signal);
  result.onApproved?.();
  expect(guard.agentGuard.pendingFile(file)).toBe(true);
  await fs.writeFile(path.join(context.workspacePath, file), `${after}\n`);
  await waitFor(() => !guard.agentGuard.pendingFile(file));
  await guard.waitForTrace();
  expect(readTrace(await guard.exportTrace()).some((event) => event.type === "reservation_mismatch" && event.file === file)).toBe(true);
  expect(guard.tracker.getActiveChangeSets().some((set) => set.actor.kind === "agent" && set.actor.runId === "formatted-run")).toBe(true);
}, 15000);

it("confirms an approved deletion without keeping its write reservation", async () => {
  const context = await setup();
  const guard = context.runtime.conflictGuard!;
  const file = "src/report.ts";
  const before = await context.disk(file);
  guard.beginAgentRun({ kind: "agent", runId: "delete-run", ownerId: context.bob.member.id }, new Map([[file, before]]));
  const result = await guard.agentGuard.judge("delete-run", [{ file, before, after: "", deleted: true }], new AbortController().signal);
  result.onApproved?.();
  await fs.unlink(path.join(context.workspacePath, file));
  guard.workspaceChanged(file);
  expect(guard.agentGuard.pendingFile(file)).toBe(false);
}, 15000);

it("ignores earlier session files during the next run's T3 verification", async () => {
  const context = await setup();
  const first = await context.run(`fake-edit=${edit("src/cart.ts", "let amount = 0;", "let amount = 10;")} fake-delay=10`);
  await waitFor(async () => (await context.getRun(first.id)).status === "completed");
  const second = await context.app.locals.agentRuns.createRun({ projectId: context.runtime.project.id, memberId: context.bob.member.id, sessionId: first.sessionId, prompt: `fake-edit=${edit("src/checkout.ts", "cart.total()", "cart.total() + 1")} fake-delay=10` });
  await waitFor(async () => (await context.getRun(second.id)).status === "completed");
  expect((await context.getRun(second.id)).fileChanges?.map((change) => change.file)).toEqual(["src/checkout.ts"]);
  expect((await context.getRun(second.id)).conflictGuard?.t3).toBe("passed");
  expect((await context.trace(second.id)).some((event: { type: string }) => event.type === "t3_incomplete")).toBe(false);
}, 15000);

it("pauses a short run timeout while a T2 model request is pending", async () => {
  const context = await setup("full", { decision: "allow", delay: 600, runTimeoutMs: 300 });
  const pricing = await context.connect("src/pricing.ts");
  replace(pricing, "return price * (1 - rate);", "return price - rate;");
  await waitFor(() => context.runtime.conflictGuard!.state().activeSymbols.some((set) => set.symbols.some((symbol) => symbol.key.endsWith("#applyDiscount"))));
  const created = await context.run(`fake-edit=${edit("src/checkout.ts", "cart.total()", "cart.total() + 1")} fake-delay=10`);
  await waitFor(async () => ["completed", "failed"].includes((await context.getRun(created.id)).status));
  expect((await context.getRun(created.id)).status).toBe("completed");
  expect((await context.getRun(created.id)).conflictGuard?.approvalWaitMs).toBeGreaterThanOrEqual(550);
}, 15000);

it("rejects the later dependent edit from another active Agent run", async () => {
  const context = await setup();
  const first = await context.run(`fake-edit=${edit("src/pricing.ts", "rate: number)", "rate: number, currency: string)")} fake-delay=2500`, context.alice.member.id);
  await waitFor(() => context.runtime.conflictGuard!.state().activeSymbols.some((set) => set.actor.kind === "agent" && set.actor.runId === first.id && set.symbols.some((symbol) => symbol.key.endsWith("#applyDiscount"))));
  const second = await context.run(`fake-edit=${edit("src/cart.ts", "applyDiscount(amount, 0.1)", "applyDiscount(amount + 1, 0.1)")}`);
  await waitFor(async () => (await context.getRun(second.id)).status === "completed");
  expect((await context.getRun(second.id)).conflictGuard?.rejectedEdits).toBe(1);
  expect((await context.getRun(second.id)).conflictGuard?.lastRejection).toContain("Alice 的 Agent");
  await waitFor(async () => (await context.getRun(first.id)).status === "completed");
}, 15000);

for (const failure of ["handler-reject", "reply-failure"] as const) it(`clears an unwritten approval reservation after ${failure}`, async () => {
  const context = await setup();
  const guard = context.runtime.conflictGuard!;
  const pricing = await context.disk("src/pricing.ts");
  const cart = await context.disk("src/cart.ts");
  const first = "unwritten-producer";
  const second = "independent-consumer";
  const baseline = new Map([["src/pricing.ts", pricing], ["src/cart.ts", cart]]);
  guard.beginAgentRun({ kind: "agent", runId: first, ownerId: context.alice.member.id }, baseline);
  guard.beginAgentRun({ kind: "agent", runId: second, ownerId: context.bob.member.id }, baseline);
  const handler = conflictGuardEditHandler({ workspace: context.runtime.project.workspacePath, judge: (proposals, signal) => guard.agentGuard.judge(first, proposals, signal), approved: () => {} });
  const dispatcher = createPermissionDispatcher({
    handlers: [handler, ...(failure === "handler-reject" ? [async () => ({ reply: "reject" as const, message: "Rejected by another permission handler" })] : [])],
    reply: async () => { if (failure === "reply-failure") throw new Error("Permission reply unavailable"); },
    trace: async () => {}
  });
  await dispatcher.dispatch({ id: failure, sessionID: "producer-session", permission: "edit", metadata: { filepath: "src/pricing.ts", diff: createPatch("src/pricing.ts", pricing, pricing.replace("rate: number)", "rate: number, currency: string)")) } });
  const result = await guard.agentGuard.judge(second, [{ file: "src/cart.ts", before: cart, after: cart.replace("applyDiscount(amount, 0.1)", "applyDiscount(amount + 1, 0.1)") }], new AbortController().signal);
  expect(result.decision).toBe("allow");
  expect(await context.disk("src/pricing.ts")).toBe(pricing);
  dispatcher.dispose();
}, 15000);

it("T3 reverts an unchanged block and skips the block edited by Bob", async () => {
  const context = await setup();
  const original = await context.disk("src/cart.ts");
  const agent = original.replace("let amount = 0;", "let amount = 10;").replace("applyDiscount(amount, 0.1)", "applyDiscount(amount, 0.2)");
  const created = await context.run(`fake-edit=${edit("src/cart.ts", original, agent)} fake-delay=4200`);
  await waitFor(async () => (await context.disk("src/cart.ts")).includes("let amount = 10;"));
  const pricing = await context.connect("src/pricing.ts");
  const cart = await context.connect("src/cart.ts", context.bob.member.id);
  replace(pricing, "rate: number)", "rate: number, currency: string)");
  replace(cart, "applyDiscount(amount, 0.2)", "applyDiscount(amount, 0.25)");
  await waitFor(async () => (await context.getRun(created.id)).status === "completed");
  expect((await context.getRun(created.id)).conflictGuard?.t3).toBe("partially-reverted");
  expect(cart.getText("content").toString()).toContain("let amount = 0;");
  expect(cart.getText("content").toString()).toContain("applyDiscount(amount, 0.25)");
  expect((await context.trace(created.id)).some((event: { type: string }) => event.type === "t3_revert")).toBe(true);
  expect(context.runtime.conflictGuard!.agentGuard.notices(context.bob.member.id)).toEqual(expect.arrayContaining([expect.objectContaining({ conflict: expect.objectContaining({ self: { kind: "agent", runId: created.id, ownerId: context.bob.member.id }, other: expect.objectContaining({ kind: "human" }), otherDisplayName: expect.stringMatching(/^(?:Alice|Bob)（人）$/), beforeSignature: expect.stringMatching(/\(/), afterSignature: expect.stringMatching(/\(/), ruleId: expect.stringMatching(/^(?:call-signature-incompatible|same-symbol-concurrent-write)$/) }) })]));
  expect(validateTrace(readTrace(await context.runtime.conflictGuard!.exportTrace()))).toBe(true);
}, 15000);

it("keeps another member's symbol out of an Agent's repeated-edit T3 change set", async () => {
  const context = await setup();
  const file = "src/isolated.ts";
  const baseline = "export function first() { return 1; }\nexport function second() { return 2; }\n";
  await fs.writeFile(path.join(context.runtime.project.workspacePath, file), baseline);
  const document = await context.connect(file);
  const guard = context.runtime.conflictGuard!;
  const runId = "repeat-edit-run";
  guard.beginAgentRun({ kind: "agent", runId, ownerId: context.bob.member.id }, new Map([[file, baseline]]));
  const write = async (before: string, after: string) => {
    const result = await guard.agentGuard.judge(runId, [{ file, before, after }], new AbortController().signal);
    expect(result.decision).toBe("allow");
    await fs.writeFile(path.join(context.runtime.project.workspacePath, file), after);
    await context.runtime.documents.reloadPath(file);
    await waitFor(() => document.getText("content").toString() === after);
  };
  await write(baseline, baseline.replace("first() { return 1; }", "first() { return 10; }"));
  replace(document, "second() { return 2; }", "second() { return 20; }");
  await waitFor(() => guard.state().activeSymbols.some((set) => set.actor.kind === "human" && set.symbols.some((symbol) => symbol.key.endsWith("#second"))));
  await waitFor(async () => (await context.disk(file)).includes("second() { return 20; }"));
  const before = await context.disk(file);
  await write(before, before.replace("first() { return 10; }", "first() { return 11; }"));
  const result = await guard.agentGuard.finish(runId, [], (target, expected, content, owner, remove) => context.runtime.documents.applyGuardRevert(target, expected, content, owner, remove));
  expect(result).toBe("passed");
  expect(document.getText("content").toString()).toContain("first() { return 11; }");
  expect(document.getText("content").toString()).toContain("second() { return 20; }");
}, 15000);

for (const mode of ["off", "observe"] as const) it(`${mode} preserves permission allow and ${mode === "observe" ? "records T2 shadow" : "has no guard processing"}`, async () => {
  const context = await setup(mode);
  const pricing = await context.connect("src/pricing.ts");
  replace(pricing, "rate: number)", "rate: number, currency: string)");
  await new Promise((resolve) => setTimeout(resolve, 1600));
  const created = await context.run(`fake-edit=${edit("src/cart.ts", "applyDiscount(amount, 0.1)", "applyDiscount(amount + 1, 0.1)")}`);
  await waitFor(async () => (await context.getRun(created.id)).status === "completed");
  expect(await context.disk("src/cart.ts")).toContain("applyDiscount(amount + 1, 0.1)");
  const trace = await context.trace(created.id);
  expect(trace.some((event: { type: string }) => event.type === "permission_reply")).toBe(false);
  if (mode === "observe") expect(readTrace(await context.runtime.conflictGuard!.exportTrace()).some((event) => event.type === "t2_shadow" && event.decision === "lock")).toBe(true);
  else expect((await context.getRun(created.id)).conflictGuard).toBeUndefined();
}, 15000);

it("checks a proposal against unsaved human changes in another symbol of the same file", async () => {
  const context = await setup();
  const file = "src/same.ts";
  await fs.writeFile(path.join(context.runtime.project.workspacePath, file), "export function price(value: number) { return value; }\nexport function total() { return price(10); }\n");
  const document = await context.connect(file);
  replace(document, "value: number)", "value: number, currency: string)");
  const created = await context.run(`fake-edit=${edit(file, "price(10)", "price(20)")}`);
  await waitFor(async () => (await context.getRun(created.id)).status === "completed");
  expect((await context.getRun(created.id)).conflictGuard?.rejectedEdits).toBe(1);
  expect((await context.getRun(created.id)).conflictGuard?.lastRejection).toContain("signature");
  expect(document.getText("content").toString()).toContain("currency: string");
  expect(document.getText("content").toString()).toContain("price(10)");
}, 15000);

it("rejects an edit to a file already paused by a human conflict", async () => {
  const context = await setup();
  const pricing = await context.connect("src/pricing.ts");
  const cart = await context.connect("src/cart.ts", context.bob.member.id);
  replace(pricing, "rate: number)", "rate: number, currency: string)");
  replace(cart, "applyDiscount(amount, 0.1)", "applyDiscount(amount, 0.2)");
  await waitFor(() => context.runtime.conflictGuard!.state().frozenFiles.length > 0);
  const created = await context.run(`fake-edit=${edit("src/cart.ts", "applyDiscount(amount, 0.1)", "applyDiscount(amount + 1, 0.1)")}`);
  await waitFor(async () => (await context.getRun(created.id)).status === "completed");
  expect((await context.getRun(created.id)).conflictGuard?.lastRejection).toContain("正在等待冲突处理");
}, 15000);

for (const ending of ["completed", "failed", "cancelled", "timeout"] as const) it(`runs T3 for an unopened file when the run ends as ${ending}`, async () => {
  const context = await setup("rules", ending === "timeout" ? { decision: "allow", runTimeoutMs: 2500 } : undefined);
  const original = await context.disk("src/cart.ts");
  const created = await context.run(`fake-edit=${edit("src/cart.ts", "let amount = 0;", "let amount = 10;")} fake-delay=${ending === "cancelled" ? 9000 : ending === "timeout" ? 5000 : 2600}${ending === "failed" ? " fake-fail" : ""}`);
  await waitFor(async () => (await context.disk("src/cart.ts")).includes("let amount = 10;"));
  const pricing = await context.connect("src/pricing.ts");
  replace(pricing, "rate: number)", "rate: number, currency: string)");
  await waitFor(() => context.runtime.conflictGuard!.state().activeSymbols.some((set) => set.actor.kind === "human" && set.symbols.some((symbol) => symbol.key.endsWith("#applyDiscount"))));
  if (ending === "cancelled") await context.app.locals.agentRuns.cancelRun(context.runtime.project.id, created.id, context.bob.member.id);
  await waitFor(async () => { const run = await context.getRun(created.id); return Boolean(run.conflictGuard?.t3) && run.status !== "running"; });
  expect((await context.getRun(created.id)).conflictGuard?.t3).toBe("reverted");
  expect((await context.getRun(created.id)).status).toBe(ending === "timeout" ? "failed" : ending);
  expect(await context.disk("src/cart.ts")).toBe(original);
  expect(readTrace(await context.runtime.conflictGuard!.exportTrace()).some((event) => event.type === "edit" && (event.origin as { kind?: string })?.kind === "guard-revert")).toBe(true);
}, 15000);

it("uses a changed dependency in the same file during T3", async () => {
  const context = await setup();
  const file = "src/same.ts";
  const original = "export function price(value: number) { return value; }\nexport function total() { return price(10); }\n";
  await fs.writeFile(path.join(context.runtime.project.workspacePath, file), original);
  const created = await context.run(`fake-edit=${edit(file, "price(10)", "price(20)")} fake-delay=2700`);
  await waitFor(async () => (await context.disk(file)).includes("price(20)"));
  const document = await context.connect(file);
  replace(document, "value: number)", "value: number, currency: string)");
  await waitFor(async () => (await context.getRun(created.id)).status === "completed");
  expect((await context.getRun(created.id)).conflictGuard?.t3).toBe("reverted");
  expect(document.getText("content").toString()).toContain("price(10)");
  expect(document.getText("content").toString()).toContain("currency: string");
}, 15000);

it("retains dependency changes from an earlier completed human change set during T3", async () => {
  const context = await setup();
  const file = "src/pricing.ts";
  const original = await context.disk("src/cart.ts");
  await fs.appendFile(path.join(context.runtime.project.workspacePath, file), "\nexport function unrelated() { return 1; }\n");
  const pricing = await context.connect(file);
  const created = await context.run(`fake-edit=${edit("src/cart.ts", "let amount = 0;", "let amount = 10;")} fake-delay=5500`);
  await waitFor(async () => (await context.disk("src/cart.ts")).includes("let amount = 10;"));
  replace(pricing, "rate: number)", "rate: number, currency: string)");
  await waitFor(() => context.runtime.conflictGuard!.state().activeSymbols.some((set) => set.actor.kind === "human" && set.symbols.some((symbol) => symbol.key.endsWith("#applyDiscount"))));
  context.runtime.conflictGuard!.markDone(context.alice.member.id);
  replace(pricing, "function unrelated() { return 1; }", "function unrelated() { return 2; }");
  await waitFor(() => context.runtime.conflictGuard!.state().activeSymbols.some((set) => set.actor.kind === "human" && set.symbols.some((symbol) => symbol.key.endsWith("#unrelated"))));
  await waitFor(async () => (await context.getRun(created.id)).status === "completed");
  expect((await context.getRun(created.id)).conflictGuard?.t3).toBe("reverted");
  expect(await context.disk("src/cart.ts")).toBe(original);
}, 15000);

it("rechecks a dependency changed while T3 is awaiting a model verdict", async () => {
  const context = await setup("full", { decision: "allow", delay: 700 });
  const original = await context.disk("src/cart.ts");
  const created = await context.run(`fake-edit=${edit("src/cart.ts", "let amount = 0;", "let amount = 10;")} fake-delay=2300`);
  await waitFor(async () => (await context.disk("src/cart.ts")).includes("let amount = 10;"));
  const pricing = await context.connect("src/pricing.ts");
  replace(pricing, "return price * (1 - rate);", "return price - rate;");
  await waitFor(async () => (await context.trace(created.id)).some((event: { type: string; data?: { point?: string } }) => event.type === "pair_analyzing" && event.data?.point === "T3"));
  replace(pricing, "rate: number)", "rate: number, currency: string)");
  await waitFor(async () => (await context.getRun(created.id)).status === "completed");
  expect((await context.getRun(created.id)).conflictGuard?.t3).toBe("reverted");
  expect(await context.disk("src/cart.ts")).toBe(original);
}, 15000);

it("records a shadow conflict between two observe Agent runs", async () => {
  const context = await setup("observe");
  const first = await context.run(`fake-edit=${edit("src/pricing.ts", "rate: number)", "rate: number, currency: string)")} fake-delay=5000`, context.alice.member.id);
  await waitFor(async () => (await context.disk("src/pricing.ts")).includes("currency: string"));
  const second = await context.run(`fake-edit=${edit("src/cart.ts", "applyDiscount(amount, 0.1)", "applyDiscount(amount + 1, 0.1)")}`);
  await waitFor(async () => (await context.getRun(second.id)).status === "completed");
  expect(readTrace(await context.runtime.conflictGuard!.exportTrace()).some((event) => event.type === "t2_shadow" && (event.actor as { runId?: string }).runId === second.id && event.decision === "lock")).toBe(true);
  await waitFor(async () => (await context.getRun(first.id)).status === "completed");
}, 15000);

it("checks and reverts a bash block following an approved edit in the same file", async () => {
  const context = await setup();
  const original = await context.disk("src/cart.ts");
  const created = await context.run(`fake-edit=${edit("src/cart.ts", "let amount = 0;", "let amount = 10;")} fake-bash-edit=${edit("src/cart.ts", "applyDiscount(amount, 0.1)", "applyDiscount(amount, 0.2)")} fake-delay=2700`);
  await waitFor(async () => (await context.disk("src/cart.ts")).includes("applyDiscount(amount, 0.2)"));
  const pricing = await context.connect("src/pricing.ts");
  replace(pricing, "rate: number)", "rate: number, currency: string)");
  await waitFor(async () => (await context.getRun(created.id)).status === "completed");
  expect((await context.getRun(created.id)).conflictGuard?.t3).toBe("reverted");
  expect(await context.disk("src/cart.ts")).toBe(original);
}, 15000);

it("restores an Agent-deleted file after its dependent symbol changes during the run", async () => {
  const context = await setup();
  const original = await context.disk("src/pricing.ts");
  const created = await context.run(`fake-edit=${edit("src/pricing.ts", original, "")} fake-delete=true fake-delay=2700`);
  await waitFor(async () => { try { await context.disk("src/pricing.ts"); return false; } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; return true; } });
  const cart = await context.connect("src/cart.ts");
  replace(cart, "applyDiscount(amount, 0.1)", "applyDiscount(amount + 1, 0.1)");
  await waitFor(async () => (await context.getRun(created.id)).status === "completed");
  expect((await context.getRun(created.id)).conflictGuard?.t3).toBe("reverted");
  expect(await context.disk("src/pricing.ts")).toBe(original);
  expect(cart.getText("content").toString()).toContain("amount + 1");
}, 15000);

it("restores an Agent-deleted file whose Yjs document remained open", async () => {
  const context = await setup();
  const pricing = await context.connect("src/pricing.ts");
  const original = await context.disk("src/pricing.ts");
  const created = await context.run(`fake-edit=${edit("src/pricing.ts", original, "")} fake-delete=true fake-delay=2700`);
  await waitFor(async () => { try { await context.disk("src/pricing.ts"); return false; } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; return true; } });
  const cart = await context.connect("src/cart.ts");
  replace(cart, "applyDiscount(amount, 0.1)", "applyDiscount(amount + 1, 0.1)");
  await waitFor(async () => (await context.getRun(created.id)).status === "completed");
  expect((await context.getRun(created.id)).conflictGuard?.t3).toBe("reverted");
  expect(await context.disk("src/pricing.ts")).toBe(original);
  expect(pricing.getText("content").toString()).toBe(original);
  expect(validateTrace(readTrace(await context.runtime.conflictGuard!.exportTrace()))).toBe(true);
}, 15000);

it("persists a T3 revert through an already open document", async () => {
  const context = await setup();
  const cart = await context.connect("src/cart.ts");
  const original = await context.disk("src/cart.ts");
  const created = await context.run(`fake-edit=${edit("src/cart.ts", "let amount = 0;", "let amount = 10;")} fake-delay=2700`);
  await waitFor(() => cart.getText("content").toString().includes("let amount = 10;"));
  const pricing = await context.connect("src/pricing.ts");
  replace(pricing, "rate: number)", "rate: number, currency: string)");
  await waitFor(async () => (await context.getRun(created.id)).status === "completed");
  expect((await context.getRun(created.id)).conflictGuard?.t3).toBe("reverted");
  expect(cart.getText("content").toString()).toBe(original);
  expect(await context.disk("src/cart.ts")).toBe(original);
}, 15000);

it("records observe shadow for a deleted file", async () => {
  const context = await setup("observe");
  const cart = await context.connect("src/cart.ts");
  replace(cart, "applyDiscount(amount, 0.1)", "applyDiscount(amount + 1, 0.1)");
  await waitFor(() => context.runtime.conflictGuard!.state().activeSymbols.some((set) => set.symbols.some((symbol) => symbol.key.endsWith("#Cart.total"))));
  const original = await context.disk("src/pricing.ts");
  const created = await context.run(`fake-edit=${edit("src/pricing.ts", original, "")} fake-delete=true`);
  await waitFor(async () => (await context.getRun(created.id)).status === "completed");
  expect(readTrace(await context.runtime.conflictGuard!.exportTrace()).some((event) => event.type === "t2_shadow" && event.decision === "lock")).toBe(true);
  expect((await context.getRun(created.id)).conflictGuard?.rejectedEdits).toBe(0);
  await expect(context.disk("src/pricing.ts")).rejects.toThrow();
}, 15000);

for (const failure of [false, true]) it(`preserves cancellation while ${failure ? "failed" : "completed"} run is waiting for T3`, async () => {
  const context = await setup("full", { decision: "warn", delay: 700 });
  const created = await context.run(`fake-edit=${edit("src/cart.ts", "let amount = 0;", "let amount = 10;")} fake-delay=2300${failure ? " fake-fail" : ""}`);
  await waitFor(async () => (await context.disk("src/cart.ts")).includes("let amount = 10;"));
  const pricing = await context.connect("src/pricing.ts");
  replace(pricing, "return price * (1 - rate);", "return price - rate;");
  await waitFor(async () => (await context.trace(created.id)).some((event: { type: string; data?: { point?: string } }) => event.type === "pair_analyzing" && event.data?.point === "T3"));
  await context.app.locals.agentRuns.cancelRun(context.runtime.project.id, created.id, context.bob.member.id);
  await waitFor(async () => (await context.trace(created.id)).some((event: { type: string }) => event.type === "run_cancelled"));
  expect((await context.getRun(created.id)).status).toBe("cancelled");
  expect((await context.trace(created.id)).some((event: { type: string }) => ["run_completed", "run_failed"].includes(event.type))).toBe(false);
}, 15000);
