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
    const aliceSet = body.changeSets.find((changeSet) => changeSet.actor.memberId === memberId) as { files?: Array<{ ranges: Array<{ start: number; end: number }> }> } | undefined;
    expect(aliceSet?.files?.[0]?.ranges).toEqual([{ start: 0, end: 6 }]);
    const traceResponse = await fetch(`${origin}/api/projects/demo/conflict-guard/trace`, { headers: { "X-SimpleRCP-Member": memberId } });
    expect(traceResponse.status).toBe(200);
    expect(validateTrace(readTrace(await traceResponse.text()))).toBe(true);
    provider.disconnect();
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
    const events = readTrace(trace);
    expect(validateTrace(events)).toBe(true);
    expect(events.some((event) => event.type === "edit" && (event.origin as { kind?: string })?.kind === "filesystem")).toBe(true);
    expect(events.some((event) => event.type === "batch_opened" && (event.actor as { kind?: string })?.kind === "filesystem")).toBe(false);
    expect(await fs.readFile(path.join(workspacePath, "README.md"), "utf8")).toContain("filesystem line");
    aliceProvider.disconnect();
    bobProvider.disconnect();
    aliceProvider.destroy();
    bobProvider.destroy();
  });

  it("keeps exact character ranges for alternating edits on line one and line ten", async () => {
    const initial = Array.from({ length: 12 }, (_, index) => `line-${index + 1}\n`).join("");
    const workspacePath = app.locals.runtimeManager.get("demo").project.workspacePath;
    await fs.writeFile(path.join(workspacePath, "README.md"), initial, "utf8");
    const aliceDocument = new Y.Doc();
    const bobDocument = new Y.Doc();
    const aliceProvider = createProvider(origin, roomId, aliceDocument, memberId);
    const bob = await joinMember(origin, "demo", { name: "Bob" });
    const bobProvider = createProvider(origin, roomId, bobDocument, bob.member.id);
    await Promise.all([waitForSync(aliceProvider), waitForSync(bobProvider)]);
    aliceDocument.getText("content").insert(0, "A");
    await wait(60);
    const bobOffset = bobDocument.getText("content").toString().indexOf("line-10");
    bobDocument.getText("content").insert(bobOffset, "B");
    await wait(100);
    const stateResponse = await fetch(`${origin}/api/projects/demo/conflict-guard/state`, { headers: { "X-SimpleRCP-Member": memberId } });
    const state = await stateResponse.json() as { changeSets: Array<{ actor: { memberId?: string }; files: Array<{ ranges: Array<{ start: number; end: number }> }> }> };
    expect(state.changeSets.find((changeSet) => changeSet.actor.memberId === memberId)?.files[0]?.ranges).toEqual([{ start: 0, end: 1 }]);
    expect(state.changeSets.find((changeSet) => changeSet.actor.memberId === bob.member.id)?.files[0]?.ranges).toEqual([{ start: bobOffset, end: bobOffset + 1 }]);
    aliceProvider.disconnect();
    bobProvider.disconnect();
    aliceProvider.destroy();
    bobProvider.destroy();
  });

  it("moves Bob's range by the exact size of Alice's earlier insertion", async () => {
    const initial = Array.from({ length: 10 }, (_, index) => `line-${index + 1}\n`).join("");
    const workspacePath = app.locals.runtimeManager.get("demo").project.workspacePath;
    await fs.writeFile(path.join(workspacePath, "README.md"), initial, "utf8");
    const aliceDocument = new Y.Doc();
    const bobDocument = new Y.Doc();
    const aliceProvider = createProvider(origin, roomId, aliceDocument, memberId);
    const bob = await joinMember(origin, "demo", { name: "Bob" });
    const bobProvider = createProvider(origin, roomId, bobDocument, bob.member.id);
    await Promise.all([waitForSync(aliceProvider), waitForSync(bobProvider)]);
    const bobOffset = bobDocument.getText("content").toString().indexOf("line-8");
    bobDocument.getText("content").insert(bobOffset, "B");
    await wait(60);
    const inserted = "new-1\nnew-2\nnew-3\n";
    aliceDocument.getText("content").insert(0, inserted);
    await wait(100);
    const stateResponse = await fetch(`${origin}/api/projects/demo/conflict-guard/state`, { headers: { "X-SimpleRCP-Member": memberId } });
    const state = await stateResponse.json() as { changeSets: Array<{ actor: { memberId?: string }; files: Array<{ ranges: Array<{ start: number; end: number }> }> }> };
    expect(state.changeSets.find((changeSet) => changeSet.actor.memberId === bob.member.id)?.files[0]?.ranges).toEqual([{ start: bobOffset + inserted.length, end: bobOffset + inserted.length + 1 }]);
    aliceProvider.disconnect();
    bobProvider.disconnect();
    aliceProvider.destroy();
    bobProvider.destroy();
  });

  it("continues validating the trace after a service restart", async () => {
    const config = {
      port: 0,
      host: "127.0.0.1",
      publicOrigin: "http://127.0.0.1:5173",
      dataDir: path.join(root, "data"),
      demoProjectRoot: path.join(root, "demo", "workspace"),
      conflictGuard: { mode: "observe" as const, idleMs: 50, cursorLeaveLines: 3, maxBatchDurationMs: 500, activeIdleMs: 5_000, cursorDebounceMs: 20 }
    };
    const document = new Y.Doc();
    const provider = createProvider(origin, roomId, document, memberId);
    await waitForSync(provider);
    document.getText("content").insert(0, "before restart\n");
    await wait(80);
    provider.disconnect();
    provider.destroy();
    realtime.dispose();
    await app.locals.agentRuns.dispose();
    await app.locals.agentRuntime.dispose();
    await app.locals.runtimeManager.dispose();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));

    app = await createApp(config);
    server = http.createServer(app);
    realtime = attachRealtimeServer(server, app.locals.runtimeManager, app.locals.agentRuns, { members: app.locals.members });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Server did not start");
    origin = `http://127.0.0.1:${address.port}`;
    const joined = await joinMember(origin, "demo", { name: "Alice", memberId });
    roomId = app.locals.runtimeManager.get("demo").room.id;
    const afterRestart = new Y.Doc();
    const afterProvider = createProvider(origin, roomId, afterRestart, joined.member.id);
    await waitForSync(afterProvider);
    afterRestart.getText("content").insert(0, "after restart\n");
    await wait(100);
    const traceResponse = await fetch(`${origin}/api/projects/demo/conflict-guard/trace`, { headers: { "X-SimpleRCP-Member": memberId } });
    expect(validateTrace(readTrace(await traceResponse.text()))).toBe(true);
    afterProvider.disconnect();
    afterProvider.destroy();
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
