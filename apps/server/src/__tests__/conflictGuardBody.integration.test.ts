import fs from "node:fs/promises";
import path from "node:path";
import http from "node:http";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import WebSocket from "ws";
import { WebsocketProvider } from "y-websocket";
import * as Y from "yjs";
import { checkReplay, createReplayModelPolicy, defaultAdjudicationConfig, readTrace } from "@simplercp/conflict-guard";
import { createApp } from "../createApp.js";
import { attachRealtimeServer } from "../realtime.js";
import { joinMember } from "./memberTestHelper.js";
import { createTestWorkspace } from "./testWorkspace.js";
import type { ProjectRuntime } from "../projectRuntime.js";

it("full 模式的远距离修改保持本地警告，轨迹记录相邻行配置并可回放", async () => {
  const root = await createTestWorkspace("guard-body-full-");
  const shop = fileURLToPath(new URL("../../../../demo/conflict-shop/", import.meta.url));
  const app = await createApp({ port: 0, host: "127.0.0.1", publicOrigin: "http://127.0.0.1:5173", dataDir: path.join(root, "data"), demoProjectRoot: shop, terminalEnabled: false, importRoots: [path.dirname(shop)], conflictGuard: { mode: "full", idleMs: 1500, cursorLeaveLines: 3, maxBatchDurationMs: 5000, activeIdleMs: 600000, cursorDebounceMs: 200, bodyUnrelatedMaxAdjacentLines: 4, adjudication: { settings: { ...defaultAdjudicationConfig, strategy: "G3" }, mode: "replay", cacheDirectory: path.join(root, "cache"), jev: {}, deepseek: { model: "deepseek-flash" } } } });
  const server = http.createServer(app);
  const realtime = attachRealtimeServer(server, app.locals.runtimeManager, app.locals.agentRuns, { members: app.locals.members });
  const connections: Array<{ document: Y.Doc; provider: WebsocketProvider }> = [];
  try {
    const project = await app.locals.registry.importDirectory("Body full", shop);
    const runtime = app.locals.runtimeManager.get(project.id) as ProjectRuntime;
    const file = path.join(runtime.project.workspacePath, "src/cart.ts");
    await fs.writeFile(file, (await fs.readFile(file, "utf8")).replace("    let amount = 0;", "    let amount = 0;\n    amount += 1;\n    amount += 2;\n    amount += 3;\n    amount += 4;\n    amount += 5;"));
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("服务没有启动");
    const origin = `http://127.0.0.1:${address.port}`;
    for (const name of ["Alice", "Bob"]) {
      const member = await joinMember(origin, project.id, { name });
      const document = new Y.Doc();
      const provider = new WebsocketProvider(`${origin}/yjs/${project.id}`, encodeURIComponent(`${runtime.room.id}:src/cart.ts`), document, { disableBc: true, params: { memberId: member.member.id }, WebSocketPolyfill: WebSocket as unknown as typeof globalThis.WebSocket });
      connections.push({ document, provider });
      await new Promise<void>((resolve, reject) => { provider.once("sync", (synced) => { if (synced) resolve(); }); provider.once("connection-error", reject); });
    }
    const replace = (document: Y.Doc, before: string, after: string) => {
      const content = document.getText("content");
      const position = content.toString().indexOf(before);
      expect(position).toBeGreaterThanOrEqual(0);
      document.transact(() => { content.delete(position, before.length); content.insert(position, after); });
    };
    replace(connections[0]!.document, "let amount = 0", "let amount = 10");
    await waitFor(() => connections[1]!.document.getText("content").toString().includes("let amount = 10"));
    replace(connections[1]!.document, "amount += 5", "amount += 50");
    await waitFor(() => runtime.conflictGuard!.state().pairDecisions.some((record) => record.status === "judged"));
    const state = runtime.conflictGuard!.state();
    expect(state.pairDecisions[0]!.verdict).toMatchObject({ zone: "grey", decision: "warn", localOnly: true, ruleId: "declaration-body-unrelated" });
    expect(state.frozenFiles).toEqual([]);
    expect(state.adjudication).toMatchObject({ calls: 0, judgements: 0 });
    expect(state.intervention.localDecisionRatio).toBe(1);
    await waitFor(async () => (await fs.readFile(file, "utf8")).includes("amount += 50"));
    await runtime.conflictGuard!.waitForTrace();
    const events = readTrace(await runtime.conflictGuard!.exportTrace());
    expect(events.filter((event) => event.type === "provider_call")).toEqual([]);
    expect(events.find((event) => event.type === "session_start")?.config).toMatchObject({ bodyUnrelatedMaxAdjacentLines: 4, routingVersion: "routing-ui-1" });
    expect(checkReplay(events, { policy: createReplayModelPolicy({ ...defaultAdjudicationConfig, strategy: "G3" }, new Map()) })).toMatchObject({ valid: true, differences: [] });
  } finally {
    for (const { provider, document } of connections) { provider.destroy(); document.destroy(); }
    realtime.dispose();
    await app.locals.runtimeManager.dispose();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await fs.rm(root, { recursive: true, force: true });
  }
}, 15000);

async function waitFor(check: () => boolean | Promise<boolean>) {
  const deadline = Date.now() + 10000;
  while (!await check()) {
    if (Date.now() > deadline) throw new Error("等待状态超时");
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}
