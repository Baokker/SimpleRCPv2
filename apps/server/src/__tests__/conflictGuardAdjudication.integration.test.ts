import fs from "node:fs/promises";
import path from "node:path";
import http from "node:http";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { WebsocketProvider } from "y-websocket";
import * as Y from "yjs";
import { defaultAdjudicationConfig, readTrace, validateTrace, type JudgeResult } from "@simplercp/conflict-guard";
import { createApp } from "../createApp.js";
import { attachRealtimeServer } from "../realtime.js";
import { joinMember } from "./memberTestHelper.js";
import { createTestWorkspace } from "./testWorkspace.js";
import type { ProjectRuntime } from "../projectRuntime.js";

const shop = fileURLToPath(new URL("../../../../demo/conflict-shop/", import.meta.url));
describe("T1 grey adjudication production timing", () => {
  const cleanup: Array<() => Promise<void>> = [];
  afterEach(async () => { for (const dispose of cleanup.reverse()) await dispose(); cleanup.length = 0; });
  async function setup(decision: "allow" | "warn" | "lock", fail = false) {
    const root = await createTestWorkspace("guard-model-");
    const signals: AbortSignal[] = [];
    const judge = async (_input: unknown, signal: AbortSignal): Promise<JudgeResult> => {
      signals.push(signal);
      await new Promise((resolve) => setTimeout(resolve, 2600));
      if (fail) throw new Error("测试注入的服务错误");
      return { decision, confidence: 0.9, latencyMs: 2600, raw: {}, userExplanation: "请检查双方使用的计算方式。", suggestedAction: "请 applyDiscount 的修改者检查计算单位。" };
    };
    const app = await createApp({ port: 0, host: "127.0.0.1", publicOrigin: "http://127.0.0.1:5173", dataDir: path.join(root, "data"), demoProjectRoot: shop, terminalEnabled: false, importRoots: [path.dirname(shop)], conflictGuard: { mode: "full", idleMs: 1500, cursorLeaveLines: 3, maxBatchDurationMs: 5000, activeIdleMs: 600000, cursorDebounceMs: 100, adjudication: { settings: { ...defaultAdjudicationConfig, strategy: "G2" }, jev: {}, deepseek: { model: "test" }, judges: { fast: { name: "test-fast", model: "test-v1", judge }, deep: { name: "test-deep", model: "test-v1", judge: (input, _options, signal) => judge(input, signal) } } } } });
    const project = await app.locals.registry.importDirectory("Model shop", shop);
    const runtime = app.locals.runtimeManager.get(project.id) as ProjectRuntime;
    const server = http.createServer(app); const realtime = attachRealtimeServer(server, app.locals.runtimeManager, app.locals.agentRuns, { members: app.locals.members });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address(); if (!address || typeof address === "string") throw new Error("服务器地址无效");
    const origin = `http://127.0.0.1:${address.port}`;
    cleanup.push(async () => { realtime.dispose(); await app.locals.runtimeManager.dispose(); await new Promise<void>((resolve) => server.close(() => resolve())); await fs.rm(root, { recursive: true, force: true }); });
    const members = [await joinMember(origin, project.id, { name: "Alice" }), await joinMember(origin, project.id, { name: "Bob" })];
    const connect = async (file: string, memberId: string) => {
      const document = new Y.Doc(); const provider = new WebsocketProvider(`${origin}/yjs/${project.id}`, encodeURIComponent(`${runtime.room.id}:${file}`), document, { disableBc: true, params: { memberId }, WebSocketPolyfill: WebSocket as unknown as typeof globalThis.WebSocket });
      cleanup.push(async () => { provider.destroy(); document.destroy(); });
      await new Promise<void>((resolve, reject) => { provider.once("sync", (synced) => { if (synced) resolve(); }); provider.once("connection-error", reject); });
      return document;
    };
    const pricing = await connect("src/pricing.ts", members[0]!.member.id); const checkout = await connect("src/checkout.ts", members[1]!.member.id);
    replace(pricing, "return price * (1 - rate);", "return price - rate;");
    replace(checkout, "formatMoney(cart.total())", "formatMoney(cart.total() + 1)");
    return { runtime, pricing, checkout, signals, members, state: () => runtime.conflictGuard!.state(), disk: (file: string) => fs.readFile(path.join(runtime.project.workspacePath, file), "utf8") };
  }
  for (const decision of ["allow", "warn", "lock"] as const) it(`analyzing is pushed before ${decision} and gates persistence`, async () => {
    const context = await setup(decision);
    await waitFor(() => context.state().pairDecisions.some((record) => record.status === "analyzing"));
    expect(context.state().analyzingFiles.length).toBe(2);
    expect(context.state().blockedPersists.every((entry) => entry.reason === "analyzing")).toBe(true);
    expect(await context.disk("src/checkout.ts")).not.toContain("cart.total() + 1");
    await waitFor(() => context.state().pairDecisions.some((record) => record.analysisVisible));
    await waitFor(() => context.state().pairDecisions.some((record) => record.status === "judged"));
    expect(context.state().pairDecisions[0]?.verdict).toMatchObject({ decision, adjudication: { source: "fast", status: "success" } });
    expect(context.state().analyzingFiles).toEqual([]);
    expect(context.state().frozenFiles.length).toBe(decision === "lock" ? 2 : 0);
    if (decision !== "lock") await waitFor(async () => (await context.disk("src/checkout.ts")).includes("cart.total() + 1"));
    await context.runtime.conflictGuard!.waitForTrace();
    const events = readTrace(await context.runtime.conflictGuard!.exportTrace());
    expect(validateTrace(events)).toBe(true);
    expect(events.some((event) => event.type === "pair_analyzing")).toBe(true);
    expect(events.some((event) => event.type === "provider_call" && event.status === "success")).toBe(true);
  }, 18000);
  it("failure becomes warn and changed revision cancels the old request", async () => {
    const context = await setup("lock", true);
    await waitFor(() => context.state().pairDecisions.some((record) => record.status === "analyzing"));
    replace(context.pricing, "return price - rate;", "return price - rate * 2;");
    await waitFor(() => context.signals[0]?.aborted === true);
    await waitFor(() => context.state().pairDecisions.some((record) => record.status === "judged"));
    expect(context.state().pairDecisions[0]?.verdict).toMatchObject({ decision: "warn", adjudication: { status: "degraded" } });
    expect(context.state().frozenFiles).toEqual([]);
    await waitFor(async () => (await context.disk("src/pricing.ts")).includes("rate * 2"));
  }, 18000);
});
function replace(document: Y.Doc, before: string, after: string) { const text = document.getText("content"); const position = text.toString().indexOf(before); expect(position).toBeGreaterThanOrEqual(0); document.transact(() => { text.delete(position, before.length); text.insert(position, after); }); }
async function waitFor(check: () => boolean | Promise<boolean>) { const deadline = Date.now() + 12000; while (!await check()) { if (Date.now() > deadline) throw new Error("等待研判状态超时"); await new Promise((resolve) => setTimeout(resolve, 25)); } }
