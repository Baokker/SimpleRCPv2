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
    await fs.copyFile(new URL("../../../../demo/workspace/src/projectStatus.js", import.meta.url), path.join(workspace, "src", "projectStatus.js"));
    const app = await createApp({
      port: 0,
      host: "127.0.0.1",
      publicOrigin: "http://127.0.0.1:5173",
      dataDir: path.join(root, "data"),
      demoProjectRoot: workspace,
      terminalEnabled: false,
      knowledge: "capture",
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
    const proposed = await fetch(`${origin}/api/projects/demo/knowledge/cards/${personalCard.id}/scope/request-team`, { method: "POST", headers: headers(first) });
    expect(proposed.status).toBe(200);
    expect((await proposed.json() as { card: { scope: string } }).card.scope).toBe("proposedTeam");
    const pendingTeam = await fetch(`${origin}/api/projects/demo/knowledge/cards/pending-team`, { headers: headers(second) });
    expect(pendingTeam.status).toBe(200);
    expect((await pendingTeam.json() as { cards: Array<{ id: string }> }).cards.map(card => card.id)).toContain(personalCard.id);
    const teamConfirmation = await fetch(`${origin}/api/projects/demo/knowledge/cards/${personalCard.id}/scope/confirm-team`, { method: "POST", headers: headers(second) });
    expect(teamConfirmation.status).toBe(200);
    expect((await teamConfirmation.json() as { card: { scope: string; review: { confirmedBy: string[] } } }).card).toMatchObject({ scope: "team", review: { confirmedBy: expect.arrayContaining([first, second]) } });
    const relationTargetResponse = await fetch(`${origin}/api/projects/demo/knowledge/cards`, { method: "POST", headers: headers(first), body: JSON.stringify({ type: "risk", title: "Private relation target", summary: "A private card used for relation tests", content: "Private relation target", tags: [], scope: "team" }) });
    const relationTarget = (await relationTargetResponse.json() as { card: { id: string } }).card;
    const candidates = await fetch(`${origin}/api/projects/demo/knowledge/cards/${personalCard.id}/relations/candidates`, { headers: headers(first) });
    expect(candidates.status).toBe(200);
    expect((await candidates.json() as { candidates: Array<{ card: { id: string } }> }).candidates.map(candidate => candidate.card.id)).toContain(relationTarget.id);
    const relation = await fetch(`${origin}/api/projects/demo/knowledge/cards/${personalCard.id}/relations`, { method: "POST", headers: headers(first), body: JSON.stringify({ kind: "contradicts", cardId: relationTarget.id }) });
    expect(relation.status).toBe(200);
    expect((await relation.json() as { card: { relations: Array<{ kind: string; cardId: string }> } }).card.relations).toContainEqual({ kind: "contradicts", cardId: relationTarget.id });
    const supersederResponse = await fetch(`${origin}/api/projects/demo/knowledge/cards`, { method: "POST", headers: headers(first), body: JSON.stringify({ type: "decision", title: "Superseding card", summary: "A newer relation target", content: "Superseding card", tags: [], scope: "team" }) });
    const superseder = (await supersederResponse.json() as { card: { id: string } }).card;
    const supersede = await fetch(`${origin}/api/projects/demo/knowledge/cards/${superseder.id}/relations`, { method: "POST", headers: headers(first), body: JSON.stringify({ kind: "supersedes", cardId: relationTarget.id }) });
    expect(supersede.status).toBe(200);
    const superseded = await fetch(`${origin}/api/projects/demo/knowledge/cards/${relationTarget.id}`, { headers: headers(second) });
    expect((await superseded.json() as { card: { status: string } }).card.status).toBe("superseded");
    const configOff = await fetch(`${origin}/api/projects/demo/knowledge/config`, { method: "PUT", headers: headers(first), body: JSON.stringify({ requireSecondConfirmForTeam: false }) });
    expect(configOff.status).toBe(200);
    const ownerConfirmResponse = await fetch(`${origin}/api/projects/demo/knowledge/cards`, { method: "POST", headers: headers(first), body: JSON.stringify({ type: "decision", title: "Owner team card", summary: "Owner can confirm when configured", content: "Owner confirmation is enabled by project configuration.", tags: [], scope: "personal" }) });
    const ownerConfirmCard = (await ownerConfirmResponse.json() as { card: { id: string } }).card;
    expect((await fetch(`${origin}/api/projects/demo/knowledge/cards/${ownerConfirmCard.id}/scope/request-team`, { method: "POST", headers: headers(first) })).status).toBe(200);
    const ownerConfirmed = await fetch(`${origin}/api/projects/demo/knowledge/cards/${ownerConfirmCard.id}/scope/confirm-team`, { method: "POST", headers: headers(first) });
    expect(ownerConfirmed.status).toBe(200);
    expect((await ownerConfirmed.json() as { card: { scope: string } }).card.scope).toBe("team");
    const configOn = await fetch(`${origin}/api/projects/demo/knowledge/config`, { method: "PUT", headers: headers(first), body: JSON.stringify({ requireSecondConfirmForTeam: true }) });
    expect(configOn.status).toBe(200);
    const privateOnlyResponse = await fetch(`${origin}/api/projects/demo/knowledge/cards`, { method: "POST", headers: headers(first), body: JSON.stringify({ type: "context", title: "Private only", summary: "Only Ada sees this card", content: "Private", tags: [], scope: "personal" }) });
    const privateOnlyCard = (await privateOnlyResponse.json() as { card: { id: string } }).card;
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
    await fs.writeFile(path.join(projectMetadata, "knowledge", "cards", "personal-draft-card.json"), JSON.stringify({
      ...draftValue.card,
      id: "personal-draft-card",
      status: "draft",
      scope: "personal",
      ownerMemberId: first,
      review: { confirmedBy: [] },
      evolution: [{ at: Date.now(), action: "created", by: { peerId: first, name: "Ada" } }]
    }));
    const confirmed = await fetch(`${origin}/api/projects/demo/knowledge/cards/draft-card/confirm`, { method: "POST", headers: headers(second), body: JSON.stringify({ patch: { title: "Keep the line", summary: "A shared decision", authorMemberId: first } }) });
    expect(confirmed.status).toBe(200);
    expect((await confirmed.json() as { card: { status: string; review?: { confirmedBy: string[]; editedBeforeConfirm?: boolean } } }).card).toMatchObject({ status: "reviewed", review: { confirmedBy: [second], editedBeforeConfirm: false } });
    const hiddenDraftConfirmation = await fetch(`${origin}/api/projects/demo/knowledge/cards/personal-draft-card/confirm`, { method: "POST", headers: headers(second), body: JSON.stringify({ edited: true }) });
    expect(hiddenDraftConfirmation.status).toBe(404);

    const chat = await fetch(`${origin}/api/projects/demo/chat`, { method: "POST", headers: headers(first), body: JSON.stringify({ text: "README.md Keep this line as our shared decision." }) });
    expect(chat.status).toBe(200);
    const chatMessage = (await chat.json() as { message: { id: string } }).message;
    const fromChat = await fetch(`${origin}/api/projects/demo/knowledge/from-chat`, { method: "POST", headers: headers(first), body: JSON.stringify({ messageIds: [chatMessage.id] }) });
    expect(fromChat.status).toBe(201);
    const suggestion = (await fromChat.json() as { suggestion: { id: string } }).suggestion;
    const accepted = await fetch(`${origin}/api/projects/demo/knowledge/inbox/${suggestion.id}/accept`, { method: "POST", headers: headers(first), body: "{}" });
    expect(accepted.status).toBe(200);
    const acceptedCard = (await accepted.json() as { card: { id: string; status: string; ownerMemberId: string } }).card;
    expect(acceptedCard).toMatchObject({ status: "draft", ownerMemberId: first });
    const rejectedEdit = await fetch(`${origin}/api/projects/demo/knowledge/cards/${acceptedCard.id}`, { method: "PATCH", headers: headers(second), body: JSON.stringify({ title: "Unauthorized edit" }) });
    expect(rejectedEdit.status).toBe(400);
    for (const patch of [{ title: "" }, { authorMemberId: "missing-member" }, []]) {
      const rejectedConfirmation = await fetch(`${origin}/api/projects/demo/knowledge/cards/${acceptedCard.id}/confirm`, { method: "POST", headers: headers(second), body: JSON.stringify({ edited: true, patch }) });
      expect(rejectedConfirmation.status).toBe(400);
      const unchanged = await fetch(`${origin}/api/projects/demo/knowledge/cards/${acceptedCard.id}`, { headers: headers(first) }).then(response => response.json()) as { card: typeof acceptedCard };
      expect(unchanged.card).toEqual(acceptedCard);
    }
    const editedConfirmation = await fetch(`${origin}/api/projects/demo/knowledge/cards/${acceptedCard.id}/confirm`, {
      method: "POST", headers: headers(second), body: JSON.stringify({ durationMs: 750, patch: { title: "Reviewed shared decision", summary: "Keep this line after review", authorMemberId: first, authorName: "Untrusted name", ownerMemberId: second } })
    });
    expect(editedConfirmation.status).toBe(200);
    expect((await editedConfirmation.json() as { card: unknown }).card).toMatchObject({ title: "Reviewed shared decision", summary: "Keep this line after review", ownerMemberId: first, status: "reviewed", provenance: { author: { memberId: first, displayName: "Ada" } }, review: { confirmedBy: [second], editedBeforeConfirm: true } });
    const confirmerEdit = await fetch(`${origin}/api/projects/demo/knowledge/cards/${acceptedCard.id}`, { method: "PATCH", headers: headers(second), body: JSON.stringify({ content: "Confirmed member can edit." }) });
    expect(confirmerEdit.status).toBe(200);

    const secondCards = await fetch(`${origin}/api/projects/demo/knowledge/cards`, { headers: headers(second) }).then((response) => response.json()) as { cards: Array<{ id: string }> };
    expect(secondCards.cards.map((card) => card.id)).toContain(teamCard.id);
    expect(secondCards.cards.map((card) => card.id)).not.toContain(privateOnlyCard.id);
    const hiddenPersonal = await fetch(`${origin}/api/projects/demo/knowledge/cards/${privateOnlyCard.id}`, { headers: headers(second) });
    expect(hiddenPersonal.status).toBe(404);

    const updated = await fetch(`${origin}/api/projects/demo/knowledge/cards/${teamCard.id}`, {
      method: "PATCH",
      headers: headers(first),
      body: JSON.stringify({ title: "Keep the line updated", content: "Updated rule content", note: "reviewed in the panel" })
    });
    expect(updated.status).toBe(200);
    const updatedCard = (await updated.json() as { card: { title: string; evolution: Array<{ action: string; note?: string }> } }).card;
    expect(updatedCard).toMatchObject({ title: "Keep the line updated" });
    expect(updatedCard.evolution.at(-1)?.note).toContain("修改标题");
    expect(updatedCard.evolution.at(-1)?.note).toMatch(/修改正文，增加 \d+ 个字符，删除 \d+ 个字符/);
    const archived = await fetch(`${origin}/api/projects/demo/knowledge/cards/${teamCard.id}/archive`, {
      method: "POST",
      headers: headers(first),
      body: JSON.stringify({ reason: "superseded in the test" })
    });
    expect(archived.status).toBe(200);
    expect((await archived.json() as { card: { status: string; evolution: Array<{ action: string; note?: string }> } }).card).toMatchObject({ status: "archived" });
    const events = await fetch(`${origin}/api/projects/demo/events`, { headers: headers(first) }).then((response) => response.json()) as { events: Array<{ type: string; payload?: { cardId?: string; editedBeforeConfirm?: boolean; durationMs?: number } }> };
    expect(events.events.filter((event) => event.payload?.cardId === teamCard.id).map((event) => event.type)).toEqual(expect.arrayContaining(["knowledge_card_created", "knowledge_card_updated", "knowledge_card_archived"]));
    expect(events.events.find(event => event.type === "knowledge_review_completed" && event.payload?.cardId === acceptedCard.id)?.payload).toMatchObject({ editedBeforeConfirm: true, durationMs: 750 });

    const resolved = await fetch(`${origin}/api/projects/demo/knowledge/cards?file=README.md`, { headers: headers(first) }).then((response) => response.json()) as { resolutions: Array<{ cardId: string; strategy?: string; status: string }> };
    expect(resolved.resolutions.find((item) => item.cardId === teamCard.id)).toMatchObject({ status: "ok", strategy: "range" });
    const project = app.locals.registry.getProject("demo") as { workspacePath: string };
    await fs.writeFile(path.join(project.workspacePath, "README.md"), "# Demo\n\nChanged entirely.\n");
    const deleted = await fetch(`${origin}/api/projects/demo/knowledge/cards?file=README.md`, { headers: headers(first) }).then((response) => response.json()) as { resolutions: Array<{ cardId: string; status: string }> };
    expect(deleted.resolutions.find((item) => item.cardId === teamCard.id)).toMatchObject({ status: "needsReview", range: { startLine: 3, startColumn: 1, endLine: 3, endColumn: 1 } });
    await fs.rm(path.join(project.workspacePath, "README.md"));
    const missing = await fetch(`${origin}/api/projects/demo/knowledge/cards?file=README.md`, { headers: headers(first) }).then((response) => response.json()) as { resolutions: Array<{ cardId: string; status: string }> };
    expect(missing.resolutions.find((item) => item.cardId === teamCard.id)).toMatchObject({ status: "needsReview" });

    const demo = await fetch(`${origin}/api/projects/demo/knowledge/demo`, { method: "POST", headers: headers(first), body: "{}" });
    expect(demo.status).toBe(201);
    const demoCards = (await demo.json() as { cards: Array<{ id: string; type: string; title: string; summary: string; content: string; tags: string[]; evolution: Array<{ note?: string }>; anchors: Array<{ file: { workspaceRelativePath: string } }> }> }).cards;
    expect(demoCards).toHaveLength(6);
    expect(demoCards[0]).toMatchObject({ anchors: [{ file: { workspaceRelativePath: "src/projectStatus.js" } }] });
    expect(demoCards.some((card) => card.content.includes("createProjectStatus"))).toBe(true);
    expect(demoCards.find(card => card.type === "decision")).toMatchObject({ title: "集中计算任务状态", summary: "createProjectStatus 计算任务数量、完成数量与下一项任务。" });
    expect(demoCards.find(card => card.type === "risk")?.summary).toContain("nextTask");
    expect(demoCards.every(card => card.tags.includes("project-status") && !/timeout|protocol|eager synchronization/i.test(JSON.stringify(card)))).toBe(true);
    const demoCard = await fetch(`${origin}/api/projects/demo/knowledge/cards/${demoCards[0]!.id}`, { headers: headers(first) }).then((response) => response.json()) as { card: typeof demoCards[number] };
    expect(demoCard.card).toEqual(demoCards[0]);
  });

  it("returns 404 for every knowledge route when the feature is disabled", async () => {
    const root = await createTestWorkspace("knowledge-off-");
    const workspace = path.join(root, "source");
    await fs.mkdir(workspace, { recursive: true });
    await fs.writeFile(path.join(workspace, "README.md"), "# Demo\n");
    const app = await createApp({ port: 0, host: "127.0.0.1", publicOrigin: "http://127.0.0.1:5173", dataDir: path.join(root, "data"), demoProjectRoot: workspace, terminalEnabled: false, knowledge: "off", agent: { baseUrl: "https://api.deepseek.com/v1", model: "deepseek-chat" } });
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
    const app = await createApp({ port: 0, host: "127.0.0.1", publicOrigin: "http://127.0.0.1:5173", dataDir: path.join(root, "data"), demoProjectRoot: workspace, terminalEnabled: false, knowledge: "capture", agent: { baseUrl: "https://api.deepseek.com/v1", model: "deepseek-chat" } });
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
    const app = await createApp({ port: 0, host: "127.0.0.1", publicOrigin: "http://127.0.0.1:5173", dataDir: path.join(root, "data"), demoProjectRoot: workspace, terminalEnabled: false, knowledge: "capture", agent: { baseUrl: "https://api.deepseek.com/v1", model: "deepseek-chat" } });
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
      const metadata = app.locals.registry.getProject("demo").metadataPath;
      const storedFile = path.join(metadata, "knowledge/cards", `${createdCard.id}.json`);
      const stored = JSON.parse(await fs.readFile(storedFile, "utf8"));
      const serverDocument = await runtime.documents.getPreparedDocument(documentName);
      const currentText = serverDocument.getText("content");
      const legacyEnd = Y.createRelativePositionFromTypeIndex(currentText, currentText.toString().indexOf("anchor Xline") + 12, 0);
      const legacyJson = Y.relativePositionToJSON(legacyEnd);
      stored.anchors[0].yjsRelative.end = {type: "content", assoc: 0, ...(legacyJson.item ? {item: `${legacyJson.item.client}:${legacyJson.item.clock}`} : {})};
      await fs.writeFile(storedFile, JSON.stringify(stored));
      await fetch(`${origin}/api/projects/demo/knowledge/cards?file=README.md`, {headers: {"X-SimpleRCP-Member": first}});
      expect(JSON.parse(await fs.readFile(storedFile, "utf8")).anchors[0].yjsRelative.end.assoc).toBe(-1);
      const boundaryOffset = firstText.toString().indexOf("anchor Xline");
      firstText.insert(boundaryOffset, "LEFT");
      secondText.insert(boundaryOffset + 12, "RIGHT");
      for (let attempt = 0; attempt < 100 && !firstText.toString().includes("LEFTanchor XlineRIGHT"); attempt++) await new Promise(resolve => setTimeout(resolve, 20));
      const boundaries = await fetch(`${origin}/api/projects/demo/knowledge/cards?file=README.md`, {headers: {"X-SimpleRCP-Member": first}}).then(response => response.json()) as {resolutions: Array<{cardId: string; range?: unknown}>};
      expect(boundaries.resolutions.find((item: {cardId: string}) => item.cardId === createdCard.id)).toMatchObject({range: {startLine: 3, startColumn: 5, endLine: 3, endColumn: 17}});

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
      const afterRebuild = await fetch(`${origin}/api/projects/demo/knowledge/cards?file=README.md`, { headers: { "X-SimpleRCP-Member": first } }).then((response) => response.json()) as { resolutions: Array<{ cardId: string; strategy?: string; status: string; range?: { startLine: number; endLine: number } }> };
      const rebuiltResolution = afterRebuild.resolutions.find((item) => item.cardId === epochCard.id);
      expect(rebuiltResolution).toMatchObject({ range: { startLine: 4, endLine: 4 } });
      // watcher 可以在请求之前通过 snapshot 更新相对位置。
      expect(["snapshot", "yjs"]).toContain(rebuiltResolution?.strategy);
      const refreshedCard = await fetch(`${origin}/api/projects/demo/knowledge/cards/${epochCard.id}`, { headers: { "X-SimpleRCP-Member": first } }).then((response) => response.json()) as { card: { anchors: Array<{ yjsRelative?: { docEpoch?: string; end?: {assoc?: number} } }> } };
      expect(refreshedCard.card.anchors[0]?.yjsRelative?.docEpoch).toBe(rebuiltEpoch);
      expect(refreshedCard.card.anchors[0]?.yjsRelative?.end?.assoc).toBe(-1);
    } finally {
      firstProvider.destroy();
      secondProvider.destroy();
    }
  });
});
