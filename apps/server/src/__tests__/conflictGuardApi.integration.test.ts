import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { WebsocketProvider } from "y-websocket";
import * as Y from "yjs";
import { readTrace, validateTrace } from "@simplercp/conflict-guard";
import { createApp } from "../createApp.js";
import { attachRealtimeServer } from "../realtime.js";
import { joinMember } from "./memberTestHelper.js";
import { createTestWorkspace } from "./testWorkspace.js";

describe("conflict guard API", () => {
  let root: string;
  let server: http.Server;
  let realtime: ReturnType<typeof attachRealtimeServer>;
  let origin: string;
  let memberId: string;
  let roomId: string;
  let app: Awaited<ReturnType<typeof createApp>>;

  beforeEach(async () => {
    root = await createTestWorkspace("conflict-guard-api-");
    const demoRoot = path.join(root, "demo", "workspace");
    await fs.mkdir(demoRoot, { recursive: true });
    await fs.writeFile(path.join(demoRoot, "README.md"), "hello\n", "utf8");
    app = await createApp({
      port: 0,
      host: "127.0.0.1",
      publicOrigin: "http://127.0.0.1:5173",
      dataDir: path.join(root, "data"),
      demoProjectRoot: demoRoot,
      conflictGuard: {
        mode: "observe",
        idleMs: 50,
        cursorLeaveLines: 3,
        maxBatchDurationMs: 500,
        activeIdleMs: 5_000,
        cursorDebounceMs: 20
      }
    });
    roomId = app.locals.runtimeManager.get("demo").room.id;
    server = http.createServer(app);
    realtime = attachRealtimeServer(server, app.locals.runtimeManager, app.locals.agentRuns, { members: app.locals.members });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Server did not start");
    origin = `http://127.0.0.1:${address.port}`;
    const member = await joinMember(origin, "demo", { name: "Alice" });
    memberId = member.member.id;
  });

  afterEach(async () => {
    realtime.dispose();
    await app.locals.runtimeManager.dispose();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await fs.rm(root, { recursive: true, force: true });
  });

  it("attributes a Yjs edit to the authenticated member and exposes state", async () => {
    const document = new Y.Doc();
    const provider = new WebsocketProvider(
      `${origin}/yjs/demo`,
      encodeURIComponent(`${roomId}:README.md`),
      document,
      { disableBc: true, params: { memberId }, WebSocketPolyfill: WebSocket as unknown as typeof globalThis.WebSocket }
    );
    await new Promise<void>((resolve, reject) => {
      provider.once("sync", (synced) => { if (synced) resolve(); });
      provider.once("connection-error", reject);
    });
    document.getText("content").insert(0, "Alice ");
    await wait(100);
    const response = await fetch(`${origin}/api/projects/demo/conflict-guard/state`, { headers: { "X-SimpleRCP-Member": memberId } });
    expect(response.status).toBe(200);
    const body = await response.json() as { mode: string; changeSets: Array<{ actor: { kind: string; memberId?: string } }> };
    expect(body.mode).toBe("observe");
    expect(body.changeSets).toEqual(expect.arrayContaining([
      expect.objectContaining({ actor: { kind: "human", memberId } })
    ]));
    const traceResponse = await fetch(`${origin}/api/projects/demo/conflict-guard/trace`, { headers: { "X-SimpleRCP-Member": memberId } });
    expect(traceResponse.status).toBe(200);
    expect(validateTrace(readTrace(await traceResponse.text()))).toBe(true);
    provider.destroy();
  });

  it("tracks two members and filesystem replay without changing collaboration", async () => {
    const bob = await joinMember(origin, "demo", { name: "Bob" });
    const aliceDocument = new Y.Doc();
    const bobDocument = new Y.Doc();
    const aliceProvider = createProvider(origin, roomId, aliceDocument, memberId);
    const bobProvider = createProvider(origin, roomId, bobDocument, bob.member.id);
    await Promise.all([waitForSync(aliceProvider), waitForSync(bobProvider)]);
    aliceDocument.getText("content").insert(0, "Alice line\n");
    await wait(80);
    bobDocument.getText("content").insert(bobDocument.getText("content").length, "Bob line\n");
    await wait(100);
    const stateResponse = await fetch(`${origin}/api/projects/demo/conflict-guard/state`, { headers: { "X-SimpleRCP-Member": memberId } });
    const state = await stateResponse.json() as { changeSets: Array<{ actor: { memberId?: string }; files: Array<{ file: string; ranges: Array<{ start: number; end: number }> }> }> };
    expect(state.changeSets.map((changeSet) => changeSet.actor.memberId)).toEqual(expect.arrayContaining([memberId, bob.member.id]));
    expect(state.changeSets.every((changeSet) => changeSet.files.some((file) => file.file === "README.md"))).toBe(true);

    const workspacePath = app.locals.runtimeManager.get("demo").project.workspacePath;
    await fs.writeFile(path.join(workspacePath, "README.md"), "filesystem line\nAlice line\nBob line\n", "utf8");
    await wait(300);
    await fetch(`${origin}/api/projects/demo/conflict-guard/done`, { method: "POST", headers: { "X-SimpleRCP-Member": memberId } });
    await fetch(`${origin}/api/projects/demo/conflict-guard/done`, { method: "POST", headers: { "X-SimpleRCP-Member": bob.member.id } });
    await wait(30);
    const traceResponse = await fetch(`${origin}/api/projects/demo/conflict-guard/trace`, { headers: { "X-SimpleRCP-Member": memberId } });
    const trace = await traceResponse.text();
    expect(validateTrace(readTrace(trace))).toBe(true);
    expect(trace).toContain('"kind":"filesystem"');
    aliceProvider.destroy();
    bobProvider.destroy();
  });
});

function createProvider(serverOrigin: string, room: string, document: Y.Doc, memberId: string) {
  return new WebsocketProvider(
    `${serverOrigin}/yjs/demo`,
    encodeURIComponent(`${room}:README.md`),
    document,
    { disableBc: true, params: { memberId }, WebSocketPolyfill: WebSocket as unknown as typeof globalThis.WebSocket }
  );
}

function waitForSync(provider: WebsocketProvider) {
  return new Promise<void>((resolve, reject) => {
    provider.once("sync", (synced) => { if (synced) resolve(); });
    provider.once("connection-error", reject);
  });
}

function wait(delay: number) {
  return new Promise((resolve) => setTimeout(resolve, delay));
}
