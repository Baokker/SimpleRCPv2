import fs from "node:fs/promises";
import { createRequire } from "node:module";
import http from "node:http";
import path from "node:path";
import WebSocket from "ws";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../createApp.js";
import { attachRealtimeServer } from "../realtime.js";
import { createTestWorkspace } from "./testWorkspace.js";

const require = createRequire(import.meta.url);
const { WebsocketProvider } = require("y-websocket") as typeof import("y-websocket");
const Y = require("yjs") as typeof import("yjs");

const activeServers: Array<{ close(): Promise<void> }> = [];

async function waitForProvider(provider: InstanceType<typeof WebsocketProvider>) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (provider.synced) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("Yjs provider did not synchronize");
}

async function waitForDocumentRelease(runtime: { documents: { getPreparedDocument(name: string): Promise<unknown> } }, name: string) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (!(await runtime.documents.getPreparedDocument(name))) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("Yjs document was not released");
}

afterEach(async () => {
  await Promise.all(activeServers.splice(0).map((server) => server.close()));
});

describe("knowledge API", () => {
  it("stores cards in metadata, applies visibility, resolves anchors, and generates demo cards", async () => {
    const root = await createTestWorkspace("knowledge-api-");
    const workspace = path.join(root, "source");
    await fs.mkdir(workspace, { recursive: true });
    await fs.writeFile(path.join(workspace, "README.md"), "# Demo\n\nKeep this line.\n");
    await fs.mkdir(path.join(workspace, "src"), { recursive: true });
    await fs.writeFile(path.join(workspace, "src", "projectStatus.js"), "export function createProjectStatus(tasks) { return { taskCount: tasks.length, completedCount: tasks.filter((task) => task.completed).length, nextTask: tasks.find((task) => !task.completed)?.title ?? \"All tasks complete\" }; }\n");
    const app = await createApp({
      port: 0,
      host: "127.0.0.1",
      publicOrigin: "http://127.0.0.1:5173",
      dataDir: path.join(root, "data"),
      demoProjectRoot: workspace,
      terminalEnabled: false,
      knowledge: "capture",
      fakeAgentRuntime: true,
      agent: { baseUrl: "https://api.deepseek.com/v1", model: "deepseek-chat" }
    });
    const server = http.createServer(app);
    const realtime = attachRealtimeServer(server, app.locals.runtimeManager, app.locals.agentRuns, { members: app.locals.members });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Server address missing");
    const origin = `http://127.0.0.1:${address.port}`;
    const close = async () => {
      realtime.dispose();
      for (const sockets of [realtime.presence, realtime.documents, realtime.terminal]) {
        for (const client of sockets.clients) client.terminate();
        sockets.close();
      }
      await app.locals.agentRuns.dispose();
      await app.locals.agentRuntime.dispose();
      await app.locals.runtimeManager.dispose();
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
      await fs.rm(root, { recursive: true, force: true });
    };
    activeServers.push({ close });

    const join = async (name: string) => {
      const response = await fetch(`${origin}/api/projects/demo/members`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name }) });
      expect(response.status).toBe(200);
      return (await response.json() as { member: { id: string } }).member.id;
    };
    const first = await join("Ada");
    const second = await join("Bob");
    const headers = (memberId: string) => ({ "content-type": "application/json", "X-SimpleRCP-Member": memberId });
    const created = await fetch(`${origin}/api/projects/demo/knowledge/cards`, {
      method: "POST",
      headers: headers(first),
      body: JSON.stringify({ type: "decision", title: "Keep the line", summary: "A shared decision", content: "Keep this line in the demo.", tags: ["demo"], scope: "team", anchors: [{ file: "README.md", selection: { startLineNumber: 3, startColumn: 1, endLineNumber: 3, endColumn: 16 } }] })
    });
    expect(created.status).toBe(201);
    const teamCard = (await created.json() as { card: { id: string } }).card;
    const personal = await fetch(`${origin}/api/projects/demo/knowledge/cards`, { method: "POST", headers: headers(first), body: JSON.stringify({ type: "context", title: "Private note", summary: "Only Ada sees this", content: "Private", tags: [], scope: "personal" }) });
    expect(personal.status).toBe(201);
    const personalCard = (await personal.json() as { card: { id: string } }).card;
    const draftResponse = await fetch(`${origin}/api/projects/demo/knowledge/cards/${teamCard.id}`, { headers: headers(first) });
    const draftValue = await draftResponse.json() as { card: Record<string, unknown> };
    const projectMetadata = (app.locals.registry.getProject("demo") as { metadataPath: string }).metadataPath;
    await fs.mkdir(path.join(projectMetadata, "knowledge", "cards"), { recursive: true });
    await fs.writeFile(path.join(projectMetadata, "knowledge", "cards", "draft-card.json"), JSON.stringify({
      ...draftValue.card,
      id: "draft-card",
      status: "draft",
      ownerMemberId: first,
      review: { confirmedBy: [] },
      evolution: [{ at: Date.now(), action: "created", by: { peerId: first, name: "Ada" } }]
    }));
    const confirmed = await fetch(`${origin}/api/projects/demo/knowledge/cards/draft-card/confirm`, { method: "POST", headers: headers(second), body: JSON.stringify({ edited: true }) });
    expect(confirmed.status).toBe(200);
    expect((await confirmed.json() as { card: { status: string; review?: { confirmedBy: string[]; editedBeforeConfirm?: boolean } } }).card).toMatchObject({ status: "reviewed", review: { confirmedBy: [second], editedBeforeConfirm: true } });

    const secondCards = await fetch(`${origin}/api/projects/demo/knowledge/cards`, { headers: headers(second) }).then((response) => response.json()) as { cards: Array<{ id: string }> };
    expect(secondCards.cards.map((card) => card.id)).toContain(teamCard.id);
    expect(secondCards.cards.map((card) => card.id)).not.toContain(personalCard.id);

    const updated = await fetch(`${origin}/api/projects/demo/knowledge/cards/${teamCard.id}`, {
      method: "PATCH",
      headers: headers(first),
      body: JSON.stringify({ title: "Keep the line updated", note: "reviewed in the panel" })
    });
    expect(updated.status).toBe(200);
    expect((await updated.json() as { card: { title: string; evolution: Array<{ action: string; note?: string }> } }).card).toMatchObject({ title: "Keep the line updated" });
    const archived = await fetch(`${origin}/api/projects/demo/knowledge/cards/${teamCard.id}/archive`, {
      method: "POST",
      headers: headers(first),
      body: JSON.stringify({ reason: "superseded in the test" })
    });
    expect(archived.status).toBe(200);
    expect((await archived.json() as { card: { status: string; evolution: Array<{ action: string; note?: string }> } }).card).toMatchObject({ status: "archived" });
    const events = await fetch(`${origin}/api/projects/demo/events`, { headers: headers(first) }).then((response) => response.json()) as { events: Array<{ type: string; payload?: { cardId?: string } }> };
    expect(events.events.filter((event) => event.payload?.cardId === teamCard.id).map((event) => event.type)).toEqual(expect.arrayContaining(["knowledge_card_created", "knowledge_card_updated", "knowledge_card_archived"]));

    const resolved = await fetch(`${origin}/api/projects/demo/knowledge/cards?file=README.md`, { headers: headers(first) }).then((response) => response.json()) as { resolutions: Array<{ cardId: string; strategy?: string; status: string }> };
    expect(resolved.resolutions.find((item) => item.cardId === teamCard.id)).toMatchObject({ status: "ok", strategy: "range" });
    const project = app.locals.registry.getProject("demo") as { workspacePath: string };
    await fs.writeFile(path.join(project.workspacePath, "README.md"), "# Demo\n\nChanged entirely.\n");
    const deleted = await fetch(`${origin}/api/projects/demo/knowledge/cards?file=README.md`, { headers: headers(first) }).then((response) => response.json()) as { resolutions: Array<{ cardId: string; status: string }> };
    expect(deleted.resolutions.find((item) => item.cardId === teamCard.id)?.status).toBe("needsReview");

    const demo = await fetch(`${origin}/api/projects/demo/knowledge/demo`, { method: "POST", headers: headers(first), body: "{}" });
    expect(demo.status).toBe(201);
    const demoCards = (await demo.json() as { cards: Array<{ content: string; anchors: Array<{ file: { workspaceRelativePath: string } }> }> }).cards;
    expect(demoCards).toHaveLength(6);
    expect(demoCards[0]).toMatchObject({ anchors: [{ file: { workspaceRelativePath: "src/projectStatus.js" } }] });
    expect(demoCards.some((card) => card.content.includes("createProjectStatus"))).toBe(true);
  });

  it("returns 404 for every knowledge route when the feature is disabled", async () => {
    const root = await createTestWorkspace("knowledge-off-");
    const workspace = path.join(root, "source");
    await fs.mkdir(workspace, { recursive: true });
    await fs.writeFile(path.join(workspace, "README.md"), "# Demo\n");
    const app = await createApp({ port: 0, host: "127.0.0.1", publicOrigin: "http://127.0.0.1:5173", dataDir: path.join(root, "data"), demoProjectRoot: workspace, terminalEnabled: false, knowledge: "off", fakeAgentRuntime: true, agent: { baseUrl: "https://api.deepseek.com/v1", model: "deepseek-chat" } });
    const server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Server address missing");
    const close = async () => { await app.locals.agentRuns.dispose(); await app.locals.agentRuntime.dispose(); await app.locals.runtimeManager.dispose(); await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); await fs.rm(root, { recursive: true, force: true }); };
    activeServers.push({ close });
    const response = await fetch(`http://127.0.0.1:${address.port}/api/projects/demo/knowledge/cards`);
    expect(response.status).toBe(404);
  });

  it("keeps a prepared Yjs anchor attached while text moves", async () => {
    const root = await createTestWorkspace("knowledge-yjs-");
    const workspace = path.join(root, "source");
    await fs.mkdir(workspace, { recursive: true });
    await fs.writeFile(path.join(workspace, "README.md"), "before\nanchor line\nafter\n");
    const app = await createApp({ port: 0, host: "127.0.0.1", publicOrigin: "http://127.0.0.1:5173", dataDir: path.join(root, "data"), demoProjectRoot: workspace, terminalEnabled: false, knowledge: "capture", fakeAgentRuntime: true, agent: { baseUrl: "https://api.deepseek.com/v1", model: "deepseek-chat" } });
    const server = http.createServer(app);
    const realtime = attachRealtimeServer(server, app.locals.runtimeManager, app.locals.agentRuns, { members: app.locals.members });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Server address missing");
    const close = async () => { realtime.dispose(); await app.locals.agentRuns.dispose(); await app.locals.agentRuntime.dispose(); await app.locals.runtimeManager.dispose(); await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); await fs.rm(root, { recursive: true, force: true }); };
    activeServers.push({ close });
    const origin = `http://127.0.0.1:${address.port}`;
    const memberResponse = await fetch(`${origin}/api/projects/demo/members`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "Ada" }) });
    const memberId = (await memberResponse.json() as { member: { id: string } }).member.id;
    const runtime = app.locals.runtimeManager.get("demo");
    const documentName = `demo|${runtime.room.id}:README.md`;
    const document = await runtime.documents.prepareDocument(documentName);
    const created = await fetch(`${origin}/api/projects/demo/knowledge/cards`, { method: "POST", headers: { "content-type": "application/json", "X-SimpleRCP-Member": memberId }, body: JSON.stringify({ type: "risk", title: "Anchor", summary: "Yjs anchor", content: "Follow the anchor", tags: [], scope: "team", anchors: [{ file: "README.md", selection: { startLineNumber: 2, startColumn: 1, endLineNumber: 2, endColumn: 12 } }] }) });
    expect(created.status).toBe(201);
    const cardId = (await created.json() as { card: { id: string } }).card.id;
    document.getText("content").insert(0, "inserted\n");
    document.getText("content").delete(17, 1);
    const resolved = await fetch(`${origin}/api/projects/demo/knowledge/cards?file=README.md`, { headers: { "X-SimpleRCP-Member": memberId } }).then((response) => response.json()) as { resolutions: Array<{ cardId: string; strategy?: string; status: string }> };
    expect(resolved.resolutions.find((item) => item.cardId === cardId)).toMatchObject({ strategy: "yjs", status: "ok" });
  });

  it("keeps anchors correct across two WebsocketProviders and refreshes the epoch after rebuild", async () => {
    const root = await createTestWorkspace("knowledge-yjs-concurrent-");
    const workspace = path.join(root, "source");
    await fs.mkdir(workspace, { recursive: true });
    await fs.writeFile(path.join(workspace, "README.md"), "before\nanchor line\nafter\n");
    const app = await createApp({ port: 0, host: "127.0.0.1", publicOrigin: "http://127.0.0.1:5173", dataDir: path.join(root, "data"), demoProjectRoot: workspace, terminalEnabled: false, knowledge: "capture", fakeAgentRuntime: true, agent: { baseUrl: "https://api.deepseek.com/v1", model: "deepseek-chat" } });
    const server = http.createServer(app);
    const realtime = attachRealtimeServer(server, app.locals.runtimeManager, app.locals.agentRuns, { members: app.locals.members });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Server address missing");
    const close = async () => { realtime.dispose(); await app.locals.agentRuns.dispose(); await app.locals.agentRuntime.dispose(); await app.locals.runtimeManager.dispose(); await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); await fs.rm(root, { recursive: true, force: true }); };
    activeServers.push({ close });
    const origin = `http://127.0.0.1:${address.port}`;
    const join = async (name: string) => {
      const response = await fetch(`${origin}/api/projects/demo/members`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name }) });
      return (await response.json() as { member: { id: string } }).member.id;
    };
    const first = await join("Ada");
    const second = await join("Bob");
    const runtime = app.locals.runtimeManager.get("demo");
    const documentName = `demo|${runtime.room.id}:README.md`;
    const documentPart = `${runtime.room.id}:README.md`;
    const firstDocument = new Y.Doc();
    const secondDocument = new Y.Doc();
    const firstProvider = new WebsocketProvider(`ws://127.0.0.1:${address.port}/yjs/demo`, documentPart, firstDocument, { params: { memberId: first }, WebSocketPolyfill: WebSocket as unknown as typeof globalThis.WebSocket, disableBc: true });
    const secondProvider = new WebsocketProvider(`ws://127.0.0.1:${address.port}/yjs/demo`, documentPart, secondDocument, { params: { memberId: second }, WebSocketPolyfill: WebSocket as unknown as typeof globalThis.WebSocket, disableBc: true });
    try {
      await Promise.all([waitForProvider(firstProvider), waitForProvider(secondProvider)]);
      const created = await fetch(`${origin}/api/projects/demo/knowledge/cards`, {
        method: "POST",
        headers: { "content-type": "application/json", "X-SimpleRCP-Member": first },
        body: JSON.stringify({ type: "risk", title: "Concurrent anchor", summary: "Tracks concurrent edits", content: "Keep this range attached.", tags: [], scope: "team", anchors: [{ file: "README.md", selection: { startLineNumber: 2, startColumn: 1, endLineNumber: 2, endColumn: 12 } }] })
      });
      expect(created.status).toBe(201);
      const createdCard = (await created.json() as { card: { id: string; anchors: Array<{ yjsRelative?: { docEpoch?: string } }> } }).card;
      const firstText = firstDocument.getText("content");
      const secondText = secondDocument.getText("content");
      firstText.insert(0, "inserted by Ada\n");
      for (let attempt = 0; attempt < 100 && !secondText.toString().includes("inserted by Ada\n"); attempt += 1) await new Promise((resolve) => setTimeout(resolve, 20));
      const anchorOffset = secondText.toString().indexOf("anchor line");
      expect(anchorOffset).toBeGreaterThanOrEqual(0);
      secondText.insert(anchorOffset + 7, "X");
      for (let attempt = 0; attempt < 100 && !firstText.toString().includes("anchor Xline"); attempt += 1) await new Promise((resolve) => setTimeout(resolve, 20));
      const concurrent = await fetch(`${origin}/api/projects/demo/knowledge/cards?file=README.md`, { headers: { "X-SimpleRCP-Member": first } }).then((response) => response.json()) as { resolutions: Array<{ cardId: string; strategy?: string; status: string }> };
      expect(concurrent.resolutions.find((item) => item.cardId === createdCard.id)).toMatchObject({ strategy: "yjs", status: "ok" });

      const epochCardResponse = await fetch(`${origin}/api/projects/demo/knowledge/cards`, {
        method: "POST",
        headers: { "content-type": "application/json", "X-SimpleRCP-Member": first },
        body: JSON.stringify({ type: "context", title: "Epoch anchor", summary: "Refreshes after document rebuild", content: "Recreate relative positions after an epoch change.", tags: [], scope: "team", anchors: [{ file: "README.md", selection: { startLineNumber: 3, startColumn: 1, endLineNumber: 3, endColumn: 20 } }] })
      });
      expect(epochCardResponse.status).toBe(201);
      const epochCard = (await epochCardResponse.json() as { card: { id: string; anchors: Array<{ yjsRelative?: { docEpoch?: string } }> } }).card;
      const oldEpoch = epochCard.anchors[0]?.yjsRelative?.docEpoch;
      expect(oldEpoch).toBeTruthy();
      firstText.insert(0, "epoch shift\n");
      for (let attempt = 0; attempt < 100 && !secondText.toString().includes("epoch shift\n"); attempt += 1) await new Promise((resolve) => setTimeout(resolve, 20));
      firstProvider.destroy();
      secondProvider.destroy();
      await waitForDocumentRelease(runtime, documentName);
      const rebuilt = await runtime.documents.prepareDocument(documentName);
      const rebuiltEpoch = runtime.documents.getDocumentEpoch(rebuilt);
      expect(rebuiltEpoch).toBeTruthy();
      expect(rebuiltEpoch).not.toBe(oldEpoch);
      const afterRebuild = await fetch(`${origin}/api/projects/demo/knowledge/cards?file=README.md`, { headers: { "X-SimpleRCP-Member": first } }).then((response) => response.json()) as { resolutions: Array<{ cardId: string; strategy?: string; status: string }> };
      expect(afterRebuild.resolutions.find((item) => item.cardId === epochCard.id)).toMatchObject({ strategy: "snapshot", status: "moved" });
      const refreshedCard = await fetch(`${origin}/api/projects/demo/knowledge/cards/${epochCard.id}`, { headers: { "X-SimpleRCP-Member": first } }).then((response) => response.json()) as { card: { anchors: Array<{ yjsRelative?: { docEpoch?: string } }> } };
      expect(refreshedCard.card.anchors[0]?.yjsRelative?.docEpoch).toBe(rebuiltEpoch);
    } finally {
      firstProvider.destroy();
      secondProvider.destroy();
    }
  });
});
