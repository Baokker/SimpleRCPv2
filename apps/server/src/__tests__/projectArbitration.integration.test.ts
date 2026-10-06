import fs from "node:fs/promises";
import path from "node:path";
import http from "node:http";
import { fileURLToPath } from "node:url";
import { afterEach, expect, it } from "vitest";
import * as Y from "yjs";
import WebSocket from "ws";
import { WebsocketProvider } from "y-websocket";
import { createPatch } from "diff";
import { createApp } from "../createApp.js";
import { loadConfig } from "../config.js";
import { attachRealtimeServer } from "../realtime.js";
import { createPermissionDispatcher } from "../agent/permissionDispatcher.js";
import { conflictGuardEditHandler } from "../agent/conflictGuardEditHandler.js";
import { joinMember } from "./memberTestHelper.js";
import { createTestWorkspace } from "./testWorkspace.js";
import type { ProjectRuntime } from "../projectRuntime.js";
import type { AgentIntent } from "@simplercp/conflict-guard";

const repository = fileURLToPath(new URL("../../../../", import.meta.url));
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { for (const cleanup of cleanups.reverse()) await cleanup(); cleanups.length = 0; });
async function setup() {
  const root = await createTestWorkspace("stage7-");
  const config = loadConfig({ CONFLICT_GUARD: "rules", SIMPLERCP_DATA_DIR: root, SIMPLERCP_TERMINAL_ENABLED: "false" }, repository);
  config.importRoots = [path.join(repository, "demo")];
  const app = await createApp(config);
  const project = await app.locals.registry.importDirectory("Stage 7", path.join(repository, "demo/conflict-shop"));
  const runtime = app.locals.runtimeManager.get(project.id) as ProjectRuntime;
  const server = http.createServer(app);
  const realtime = attachRealtimeServer(server, app.locals.runtimeManager, app.locals.agentRuns, { members: app.locals.members });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); if (!address || typeof address === "string") throw new Error("Server address unavailable");
  const origin = `http://127.0.0.1:${address.port}`;
  cleanups.push(async () => { await app.locals.agentRuns.dispose(); await app.locals.agentRuntime.dispose(); realtime.dispose(); await app.locals.runtimeManager.dispose(); await new Promise<void>((resolve) => server.close(() => resolve())); await fs.rm(root, { force: true, recursive: true }); });
  const alice = (await joinMember(origin, project.id, { name: "Alice" })).member.id;
  const bob = (await joinMember(origin, project.id, { name: "Bob" })).member.id;
  const guard = runtime.conflictGuard!;
  async function connect(name: string, memberId: string) {
    const document = new Y.Doc();
    const documentName = name === "conflict-guard-intents" ? name : `${runtime.room.id}:${name}`;
    const provider = new WebsocketProvider(`${origin}/yjs/${project.id}`, encodeURIComponent(documentName), document, { disableBc: true, params: { memberId }, WebSocketPolyfill: WebSocket as unknown as typeof globalThis.WebSocket });
    cleanups.push(async () => { provider.destroy(); document.destroy(); });
    await new Promise<void>((resolve, reject) => { provider.once("sync", (synced) => { if (synced) resolve(); }); provider.once("connection-error", reject); });
    return document;
  }
  async function start(runId: string, ownerId: string) {
    const actor = { kind: "agent" as const, runId, ownerId };
    const baseline = new Map(await Promise.all(["src/pricing.ts", "src/cart.ts"].map(async (file) => [file, await fs.readFile(path.join(runtime.project.workspacePath, file), "utf8")] as const)));
    guard.arbitration.board.create(actor, "Modify related API", {}); guard.beginAgentRun(actor, baseline);
    const replies: Array<{ requestId: string; reply: string; message?: string }> = [];
    const proposals = new Map<string, { file: string; before: string; after: string }>();
    const dispatcher = createPermissionDispatcher({ handlers: [{ budgetMs: null, handle: conflictGuardEditHandler({ workspace: runtime.project.workspacePath, judge: (changes, signal, request) => guard.arbitration.judge(runId, request, changes, signal), approved() {} }) }], trace: async () => {}, reply: async (reply) => {
      replies.push(reply);
      if (reply.reply === "once") { const change = proposals.get(reply.requestId)!; await fs.writeFile(path.join(runtime.project.workspacePath, change.file), change.after); await runtime.documents.reloadPath(change.file); guard.workspaceChanged(change.file); }
    } });
    guard.arbitration.attach(runId, { resolve: dispatcher.resolve, cancel: async () => { dispatcher.dispose(); if (guard.agentGuard.actor(runId)) await guard.agentGuard.finish(runId, [], (file, before, after, owner) => runtime.documents.applyGuardRevert(file, before, after, owner)); else await guard.agentGuard.withdraw(runId); guard.arbitration.finish(runId, true); } });
    cleanups.push(async () => { dispatcher.dispose(); await dispatcher.drain(); });
    return { replies, dispatcher, async edit(file: string, from: string, to: string) {
      const before = await fs.readFile(path.join(runtime.project.workspacePath, file), "utf8");
      expect(before).toContain(from); const after = before.replace(from, to); const id = `${runId}:${proposals.size}`;
      proposals.set(id, { file, before, after });
      return dispatcher.dispatch({ id, sessionID: runId, permission: "edit", metadata: { filepath: file, diff: createPatch(file, before, after) } });
    } };
  }
  return { app, runtime, guard, alice, bob, connect, start };
}
async function until(check: () => boolean | Promise<boolean>) { const end = performance.now() + 10_000; while (!await check()) { if (performance.now() > end) throw new Error("Condition did not complete"); await new Promise((resolve) => setTimeout(resolve, 25)); } }
it("synchronizes server intents over a read-only Y.Map connection with production timings", async () => {
  const context = await setup(); const document = await context.connect("conflict-guard-intents", context.alice);
  const run = await context.start("first", context.alice);
  context.guard.arbitration.board.plan("first", "PLAN:\nsrc/pricing.ts#applyDiscount\nEND_PLAN");
  await run.edit("src/pricing.ts", "rate: number)", "rate: number, currency: string)");
  const map = document.getMap<AgentIntent>("intents");
  await until(() => Boolean(map.get("first")?.actualScope.includes("src/pricing.ts#applyDiscount")));
  expect(map.get("first")?.status).toBe("running");
  map.delete("first"); await new Promise((resolve) => setTimeout(resolve, 100));
  expect(context.guard.arbitration.board.get("first")?.actualScope).toContain("src/pricing.ts#applyDiscount");
}, 20_000);
it("restores the earlier Agent writes when its owner yields and completes the waiting approval", async () => {
  const context = await setup(); const baseline = await fs.readFile(path.join(context.runtime.project.workspacePath, "src/pricing.ts"), "utf8");
  const first = await context.start("first", context.alice);
  await first.edit("src/pricing.ts", "rate: number)", "rate: number, currency: string)");
  await until(() => context.guard.state().activeSymbols.some((set) => set.actor.kind === "agent" && set.symbols.length > 0));
  const second = await context.start("second", context.bob);
  const approval = second.edit("src/cart.ts", "let amount = 0;", "let amount = 10;");
  await until(() => context.guard.arbitration.cards.list().length > 0);
  context.guard.arbitration.act(context.guard.arbitration.cards.list()[0]!.id, context.alice, "yield");
  await approval;
  await until(async () => await fs.readFile(path.join(context.runtime.project.workspacePath, "src/pricing.ts"), "utf8") === baseline);
  expect(second.replies.at(-1)?.reply).toBe("reject");
}, 20_000);
it("rejects a suspended edit when its dispatcher is disposed", async () => {
  const context = await setup(); const first = await context.start("first", context.alice);
  await first.edit("src/pricing.ts", "rate: number)", "rate: number, currency: string)");
  await until(() => context.guard.state().activeSymbols.some((set) => set.actor.kind === "agent" && set.symbols.length > 0));
  const second = await context.start("second", context.bob);
  const approval = second.edit("src/cart.ts", "let amount = 0;", "let amount = 10;");
  await until(() => context.guard.arbitration.cards.list().length > 0);
  second.dispatcher.dispose(); await approval;
  expect(second.replies).toMatchObject([{ reply: "reject" }]);
}, 20_000);
it("suspends a cross-owner approval and completes every request when an owner yields", async () => {
  const context = await setup(); const first = await context.start("first", context.alice);
  await first.edit("src/pricing.ts", "rate: number)", "rate: number, currency: string)");
  await until(() => context.guard.state().activeSymbols.some((set) => set.actor.kind === "agent" && set.symbols.length > 0));
  const second = await context.start("second", context.bob);
  const approval = second.edit("src/cart.ts", "let amount = 0;", "let amount = 10;");
  await until(() => context.guard.arbitration.cards.list().length > 0);
  expect(second.replies).toHaveLength(0);
  const card = context.guard.arbitration.cards.list()[0]!;
  await until(() => context.guard.arbitration.cards.list()[0]?.suggestionStatus === "unavailable");
  context.guard.arbitration.cards.act(card.id, context.bob, "yield"); await approval;
  expect(second.replies).toMatchObject([{ reply: "reject" }]);
  expect(context.guard.arbitration.board.get("first")?.status).toBe("running");
  expect(context.guard.arbitration.stats().members.map((member) => member.interruptions)).toEqual([1, 1]);
  expect(context.guard.state().frozenFiles).toEqual([]);
}, 20_000);
it("waits for a same-owner run and retries through the product classifier", async () => {
  const context = await setup(); const first = await context.start("first", context.alice);
  await first.edit("src/pricing.ts", "rate: number)", "rate: number, currency: string)");
  await until(() => context.guard.state().activeSymbols.some((set) => set.actor.kind === "agent" && set.symbols.length > 0));
  const second = await context.start("second", context.alice);
  const approval = second.edit("src/cart.ts", "let amount = 0;", "let amount = 10;");
  await until(() => context.guard.arbitration.board.get("second")?.status === "waiting");
  await until(async () => (await context.guard.exportTrace()).includes("arbitration_retry"));
  expect(second.replies).toHaveLength(0); expect(context.guard.arbitration.cards.list()).toHaveLength(0);
  await context.guard.agentGuard.finish("first", [], (file, before, after, owner) => context.runtime.documents.applyGuardRevert(file, before, after, owner));
  context.guard.arbitration.finish("first", false); await approval;
  expect(second.replies).toMatchObject([{ reply: "reject", message: expect.stringContaining("当前版本") }]);
  await second.edit("src/cart.ts", "applyDiscount(amount, 0.1)", 'applyDiscount(amount, 0.1, "CNY")');
  expect(second.replies.at(-1)?.reply).toBe("once");
  expect(context.guard.arbitration.stats().members).toHaveLength(0);
}, 20_000);

it("retains the shared Agent's blocked status until all of its owner cards are handled", async () => {
  const context = await setup();
  const first = await context.start("first", context.alice);
  await first.edit("src/pricing.ts", "rate: number)", "rate: number, currency: string)");
  await until(() => context.guard.state().activeSymbols.some((set) => set.actor.kind === "agent" && set.symbols.length > 0));
  const second = await context.start("second", context.bob);
  const secondApproval = second.edit("src/cart.ts", "let amount = 0;", "let amount = 10;");
  await until(() => context.guard.arbitration.cards.list().length === 1);
  const third = await context.start("third", context.bob);
  const thirdApproval = third.edit("src/cart.ts", "let amount = 0;", "let amount = 20;");
  await until(() => context.guard.arbitration.cards.list().length === 2);
  const cards = context.guard.arbitration.cards.list();
  const cardFor = (runId: string) => cards.find((card) => card.conflict.self.kind === "agent" && card.conflict.self.runId === runId)!;
  context.guard.arbitration.act(cardFor("second").id, context.bob, "yield");
  await secondApproval;
  expect(context.guard.arbitration.board.get("first")?.status).toBe("blocked");
  expect(third.replies).toHaveLength(0);
  expect(context.guard.arbitration.cards.list().find((card) => card.id === cardFor("third").id)?.status).toBe("waiting");
  context.guard.arbitration.act(cardFor("third").id, context.bob, "yield");
  await thirdApproval;
  expect(context.guard.arbitration.board.get("first")?.status).toBe("running");
  expect(second.replies.at(-1)?.reply).toBe("reject");
  expect(third.replies.at(-1)?.reply).toBe("reject");
}, 20_000);

it("withdraws an archived Agent after completion without changing unrelated files", async () => {
  const context = await setup();
  const pricing = path.join(context.runtime.project.workspacePath, "src/pricing.ts");
  const baseline = await fs.readFile(pricing, "utf8");
  const first = await context.start("first", context.alice);
  await first.edit("src/pricing.ts", "rate: number)", "rate: number, currency: string)");
  const second = await context.start("second", context.bob);
  const approval = second.edit("src/cart.ts", "let amount = 0;", "let amount = 10;");
  await until(() => context.guard.arbitration.cards.list().length > 0);
  await context.guard.agentGuard.finish("first", [], (file, before, after, owner) => context.runtime.documents.applyGuardRevert(file, before, after, owner));
  context.guard.arbitration.finish("first", false);
  expect(context.guard.arbitration.cards.list()[0]?.status).toBe("waiting");
  expect(await fs.readFile(pricing, "utf8")).not.toBe(baseline);
  context.guard.arbitration.act(context.guard.arbitration.cards.list()[0]!.id, context.alice, "yield");
  await approval;
  await until(async () => await fs.readFile(pricing, "utf8") === baseline);
  expect(context.guard.arbitration.board.get("first")).toBeDefined();
}, 20_000);

it("archives snapshot-only Agent edits and restores them after completion", async () => {
  const context = await setup();
  await context.start("snapshot-only", context.alice);
  const file = "src/pricing.ts";
  const fullPath = path.join(context.runtime.project.workspacePath, file);
  const before = await fs.readFile(fullPath, "utf8");
  const after = `${before}\n// Agent task marker\n`;
  await fs.writeFile(fullPath, after);
  await context.runtime.documents.reloadPath(file);
  const result = await context.guard.agentGuard.finish("snapshot-only", [{ file, before, after }], (target, expected, text, owner) => context.runtime.documents.applyGuardRevert(target, expected, text, owner));
  expect(result).toBe("passed");
  context.guard.arbitration.finish("snapshot-only", false);
  expect(await context.guard.agentGuard.withdraw("snapshot-only")).toBe("reverted");
  expect(await fs.readFile(fullPath, "utf8")).toBe(before);
}, 20_000);

it("counts one light notice when a human changes an active Agent dependency", async () => {
  const context = await setup(); const document = await context.connect("src/pricing.ts", context.alice);
  const run = await context.start("consumer", context.bob);
  await run.edit("src/cart.ts", "let amount = 0;", "let amount = 10;");
  await until(() => context.guard.state().activeSymbols.some((set) => set.actor.kind === "agent" && set.symbols.some((symbol) => symbol.key === "src/cart.ts#Cart.total")));
  const text = document.getText("content"); const from = text.toString().indexOf("rate: number)");
  expect(from).toBeGreaterThan(0);
  document.transact(() => { text.delete(from, "rate: number)".length); text.insert(from, "rate: number, currency: string)"); });
  await until(() => context.guard.agentGuard.notices(context.bob).length > 0);
  const notices = context.guard.agentGuard.notices(context.bob);
  expect(context.guard.arbitration.stats().members.find((member) => member.memberId === context.bob)?.light).toBe(notices.length);
  expect(context.guard.state().frozenFiles).toEqual([]);
  expect(context.guard.state(context.alice).pairDecisions.some((record) => [record.pair.left.actor, record.pair.right.actor].some((actor) => actor.kind === "agent") && record.verdict?.decision === "lock")).toBe(true);
}, 20_000);
