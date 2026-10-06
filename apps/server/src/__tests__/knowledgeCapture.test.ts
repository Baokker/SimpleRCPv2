import fs from "node:fs/promises";
import path from "node:path";
import http from "node:http";
import { createRequire } from "node:module";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { replayEvents, type CaptureEvent, type CaptureSuggestion } from "@simplercp/knowledge";
import { createApp } from "../createApp.js";
import { attachRealtimeServer } from "../realtime.js";
import { getProjectMetadataPath } from "../projects.js";
import { documentName } from "../collaborativeDocuments.js";
import { createTestWorkspace } from "./testWorkspace.js";
import type { ProjectRuntime } from "../projectRuntime.js";

const require = createRequire(import.meta.url);
const Y = require("yjs") as typeof import("yjs");
const { WebsocketProvider } = require("y-websocket") as typeof import("y-websocket");

const cleanup: Array<() => Promise<void>> = [];
async function waitUntil(predicate: () => boolean | Promise<boolean>) {
  const deadline = Date.now() + 10_000;
  while (!(await predicate())) {
    if (Date.now() > deadline) throw new Error("Expected collaboration state was not reached");
    await new Promise(resolve => setTimeout(resolve, 20));
  }
}
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });
async function start(knowledge: "capture" | "off" = "capture") {
  const root = await createTestWorkspace("knowledge-capture-");
  const source = path.join(root, "source");
  await fs.mkdir(source);
  await fs.writeFile(path.join(source, "code.ts"), "// TODO check\nexport const baseline = 1;\n");
  await fs.writeFile(path.join(source, "package.json"), '{"dependencies":{}}\n');
  const config = { checkpointIdleMs: 250, chatAfterMs: 100 };
  const app = await createApp({ port: 0, host: "127.0.0.1", publicOrigin: "http://127.0.0.1", dataDir: path.join(root, "data"), demoProjectRoot: source, terminalEnabled: false, knowledge, captureConfig: config });
  const server = http.createServer(app);
  const realtime = attachRealtimeServer(server, app.locals.runtimeManager, app.locals.agentRuns, { members: app.locals.members });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  const origin = `http://127.0.0.1:${port}`;
  const sockets: WebSocket[] = [];
  const providers: Array<InstanceType<typeof WebsocketProvider>> = [];
  const docs: Array<InstanceType<typeof Y.Doc>> = [];
  cleanup.push(async () => {
    for (const provider of providers) provider.destroy();
    for (const doc of docs) doc.destroy();
    for (const socket of sockets) socket.close();
    await new Promise(resolve => setTimeout(resolve, 50));
    realtime.dispose(); await app.locals.agentRuns.dispose(); await app.locals.agentRuntime.dispose(); await app.locals.runtimeManager.dispose();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await fs.rm(root, { recursive: true, force: true });
  });
  async function join(name: string) {
    const response = await fetch(`${origin}/api/projects/demo/members`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) });
    expect(response.status).toBe(200);
    return (await response.json() as { member: { id: string } }).member.id;
  }
  const runtime = app.locals.runtimeManager.get("demo") as ProjectRuntime;
  async function connection(memberId: string, file = "code.ts") {
    const doc = new Y.Doc(); docs.push(doc);
    const provider = new WebsocketProvider(`ws://127.0.0.1:${port}/yjs/demo`, `${runtime.room.id}:${file}`, doc, { params: { memberId }, WebSocketPolyfill: WebSocket as unknown as typeof globalThis.WebSocket, disableBc: true });
    providers.push(provider);
    await waitUntil(() => provider.synced);
    const serverDocument = await runtime.documents.getPreparedDocument(documentName(runtime.room.id, file, "demo"));
    expect(serverDocument).toBeInstanceOf(Y.Doc);
    return doc.getText("content");
  }
  async function presence(memberId: string) {
    const messages: Array<Record<string, unknown>> = [];
    const socket = new WebSocket(`ws://127.0.0.1:${port}/ws?projectId=demo&memberId=${memberId}`); sockets.push(socket);
    socket.on("message", raw => messages.push(JSON.parse(raw.toString()) as Record<string, unknown>));
    await new Promise<void>((resolve, reject) => { socket.once("open", resolve); socket.once("error", reject); });
    return { messages, socket };
  }
  async function request(memberId: string, route: string, body?: unknown) {
    const response = await fetch(`${origin}/api/projects/demo/${route}`, { method: body === undefined ? "GET" : "POST", headers: { "X-SimpleRCP-Member": memberId, "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { response, body: await response.json() as Record<string, unknown> };
  }
  async function restartRuntime() {
    await app.locals.runtimeManager.disposeProject("demo");
    const restored = app.locals.runtimeManager.get("demo") as ProjectRuntime;
    await restored.capture?.ready;
    return restored;
  }
  return { root, source, origin, runtime, config, join, connection, presence, request, restartRuntime };
}

describe("knowledge capture with real collaboration", () => {
  it("attributes two members, delivers only to actors, confirms drafts and replays a two-minute session", async () => {
    const s = await start(); const ada = await s.join("Ada"); const bob = await s.join("Bob"); const charlie = await s.join("Charlie");
    const [a, b, c] = await Promise.all([s.presence(ada), s.presence(bob), s.presence(charlie)]);
    const [first, second] = await Promise.all([s.connection(ada), s.connection(bob)]);
    const sessionStart = Date.now();
    const inserted = "export const chosen = 1;\nexport const shared = 2;\nexport const review = 3;\nexport const agreed = 4;\n";
    first.insert(first.length, inserted);
    await waitUntil(() => second.toString().includes(inserted));
    const offset = second.toString().indexOf(inserted);
    second.doc!.transact(() => { second.delete(offset, inserted.length); second.insert(offset, "export const chosen = 2;\n"); });
    await waitUntil(async () => (await s.runtime.capture!.list(ada)).some(item => item.triggerType === "edit.overwritten"));
    const suggestion = (await s.runtime.capture!.list(ada)).find(item => item.triggerType === "edit.overwritten")!;
    expect(suggestion.actors.memberIds.sort()).toEqual([ada, bob].sort());
    await waitUntil(() => a.messages.some(message => message.type === "knowledge_suggestion"));
    await waitUntil(() => b.messages.some(message => message.type === "knowledge_suggestion"));
    expect(c.messages.filter(message => message.type === "knowledge_suggestion")).toEqual([]);
    expect((await s.runtime.capture!.list(charlie)).length).toBe(0);
    expect((await s.runtime.capture!.list(charlie, true)).some(item => item.id === suggestion.id)).toBe(true);
    await s.runtime.capture!.markRead(ada, [suggestion.id]);
    expect(await s.runtime.capture!.get(suggestion.id)).toMatchObject({ seenBy: [ada] });
    expect((await s.runtime.capture!.list(bob))[0]?.seenBy).not.toContain(bob);
    const disputed = await s.request(ada, `knowledge/inbox/${suggestion.id}/dispute`, { reason: "需要补充适用范围" });
    expect(disputed.response.status).toBe(200);
    expect(disputed.body.suggestion).toMatchObject({ state: "disputed", evidence: { dispute: { memberId: ada, reason: "需要补充适用范围" } } });
    const accepted = await s.request(bob, `knowledge/inbox/${suggestion.id}/accept`, {});
    expect(accepted.response.status).toBe(200);
    const card = accepted.body.card as { id: string; status: string; provenance: { author: { memberId: string } } };
    expect(card).toMatchObject({ status: "draft", provenance: { author: { memberId: bob } } });
    const confirmed = await s.request(bob, `knowledge/cards/${card.id}/confirm`, { edited: true, durationMs: 1250 });
    expect(confirmed.body.card).toMatchObject({ status: "reviewed", review: { editedBeforeConfirm: true, confirmedBy: [bob] } });
    for (const target of [a, b]) target.socket.send(JSON.stringify({ type: "cursor_change", roomId: s.runtime.room.id, path: "code.ts", position: { lineNumber: 2, column: 1 }, selection: { startLineNumber: 2, startColumn: 1, endLineNumber: 2, endColumn: 10 } }));
    for (let i = 0; i < 11; i++) { await s.request(i % 2 ? ada : bob, "chat", { text: `讨论 code.ts 中的 chosen，保留单一常量；消息 ${i}` }); }
    await waitUntil(async () => (await s.runtime.capture!.list(ada)).some(item => item.triggerType === "chat.dense"));
    for (let i = 0; Date.now() - sessionStart < 120_000; i++) {
      const editor = i % 2 ? first : second;
      editor.insert(editor.length, `// collaboration ${i}\n`);
      await s.request(i % 2 ? ada : bob, "chat", { text: `检查协作结果 ${i}` });
      await new Promise(resolve => setTimeout(resolve, Math.min(10_000, Math.max(0, 120_000 - (Date.now() - sessionStart)))));
    }
    await s.runtime.capture!.awaitIdle();
    const metadata = getProjectMetadataPath(s.runtime.project);
    const events = (await fs.readFile(path.join(metadata, "knowledge/events.jsonl"), "utf8")).trim().split("\n").map(line => JSON.parse(line) as CaptureEvent);
    expect(events.filter(event => event.type === "edit").map(event => (event as Extract<CaptureEvent, { type: "edit" }>).actor)).toContain(ada);
    expect(events.filter(event => event.type === "edit").map(event => (event as Extract<CaptureEvent, { type: "edit" }>).actor)).toContain(bob);
    expect(s.runtime.events.list().filter(event => event.type === "mirror_resync")).toEqual([]);
    const online: CaptureSuggestion[] = [];
    for (const name of await fs.readdir(path.join(metadata, "knowledge/inbox"))) online.push(JSON.parse(await fs.readFile(path.join(metadata, "knowledge/inbox", name), "utf8")) as CaptureSuggestion);
    const select = (item: CaptureSuggestion) => ({ triggerType: item.triggerType, at: item.createdAt, actors: item.actors, anchors: item.suggestedAnchors });
    expect(replayEvents(events, s.config, Date.now()).map(select)).toEqual(online.sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id)).map(select));
    const evidenceRoot = path.resolve("../../artifacts/knowledge-stage3-session");
    await fs.mkdir(evidenceRoot, { recursive: true });
    await fs.copyFile(path.join(metadata, "knowledge/events.jsonl"), path.join(evidenceRoot, "events.jsonl"));
    await fs.copyFile(path.join(metadata, "knowledge/capture-config.json"), path.join(evidenceRoot, "capture-config.json"));
    await fs.writeFile(path.join(evidenceRoot, "comparison.json"), JSON.stringify({ durationMs: Date.now() - sessionStart, eventCount: events.length, online: online.map(select), matched: true }, null, 2));
  }, 150_000);

  it("captures disk dependency changes without a Y.Doc and preserves Inbox on restart", async () => {
    const s = await start(); const ada = await s.join("Ada"); await s.runtime.capture!.ready;
    await new Promise(resolve => setTimeout(resolve, 200));
    await fs.writeFile(path.join(s.runtime.project.workspacePath, "package.json"), '{"dependencies":{"alpha":"1"}}\n');
    await waitUntil(async () => (await s.runtime.capture!.list(ada, true)).some(item => item.triggerType === "dependency.changed"));
    const suggestion = (await s.runtime.capture!.list(ada, true))[0]!;
    expect(suggestion.evidence).toMatchObject({ source: "filesystem", added: ["alpha"] });
    const discarded = await s.request(ada, `knowledge/inbox/${suggestion.id}/discard`, {});
    expect(discarded.response.status).toBe(200);
    expect(await s.runtime.capture!.list(ada, true)).toEqual([]);
    expect(await s.runtime.capture!.get(suggestion.id)).toMatchObject({ state: "discarded", resolvedBy: ada });
    const restored = await s.restartRuntime();
    expect(await restored.capture!.list(ada, true)).toEqual([]);
    expect(await restored.capture!.get(suggestion.id)).toMatchObject({ state: "discarded", resolvedBy: ada });
    await new Promise(resolve => setTimeout(resolve, 200));
    await fs.writeFile(path.join(restored.project.workspacePath, "package.json"), '{"dependencies":{"beta":"1"}}\n');
    await waitUntil(async () => (await restored.capture!.list(ada, true)).some(item => item.evidence.added && (item.evidence.added as string[]).includes("beta")));
    const pending = (await restored.capture!.list(ada, true))[0]!;
    const restarted = await s.restartRuntime();
    expect(await restarted.capture!.get(pending.id)).toMatchObject({ state: "open", evidence: { added: ["beta"] } });
  });

  it("accepts a suggestion once under simultaneous HTTP requests and records deterministic AI telemetry", async () => {
    const s = await start(); const ada = await s.join("Ada");
    const message = await s.request(ada, "chat", { text: "code.ts chosen 保留单一常量" });
    const fromChat = await s.request(ada, "knowledge/from-chat", { messageIds: [(message.body.message as { id: string }).id] });
    const suggestion = fromChat.body.suggestion as CaptureSuggestion;
    const requests = await Promise.all([s.request(ada, `knowledge/inbox/${suggestion.id}/ai-draft`, {}), s.request(ada, `knowledge/inbox/${suggestion.id}/ai-draft`, {})]);
    expect(requests.map(item => item.response.status).sort()).toEqual([200, 409]);
    const cards = await s.runtime.knowledge!.list({ memberId: ada, displayName: "Ada" });
    expect(cards).toHaveLength(1);
    expect(await s.runtime.capture!.get(suggestion.id)).toMatchObject({ state: "accepted", draftCardId: cards[0]!.id });
    const entries = (await fs.readFile(path.join(getProjectMetadataPath(s.runtime.project), "knowledge/llm-calls.jsonl"), "utf8")).trim().split("\n").map(line => JSON.parse(line));
    expect(entries).toMatchObject([{ suggestionId: suggestion.id, completed: true, fallback: true, attempts: 0 }]);
    expect(s.runtime.events.list().filter(item => item.type === "knowledge_suggestion_resolved")).toHaveLength(1);
  });

  it("sends risk warnings according to member visibility and file/card cooldowns", async () => {
    const s = await start(); const ada = await s.join("Ada"); const bob = await s.join("Bob");
    const [a, b] = await Promise.all([s.presence(ada), s.presence(bob)]);
    const risk = await s.runtime.knowledge!.create({ memberId: ada, displayName: "Ada" }, { type: "risk", title: "package.json alpha dependency compatibility", summary: "package.json alpha beta dependencies require compatibility checks", content: "package.json alpha beta dependencies require compatibility checks", scope: "personal", tags: ["alpha", "beta", "dependencies"] });
    const first = await s.connection(ada, "package.json"); const second = await s.connection(bob, "package.json");
    const replace = (text: InstanceType<typeof Y.Text>, value: string) => text.doc!.transact(() => { text.delete(0, text.length); text.insert(0, value); });
    replace(first, '{"dependencies":{"alpha":"1"}}');
    await waitUntil(() => a.messages.some(message => message.type === "knowledge_risk_warning" && message.cardId === risk.id));
    await waitUntil(() => second.toString().includes("alpha"));
    replace(second, '{"dependencies":{"beta":"1"}}');
    await new Promise(resolve => setTimeout(resolve, 500));
    expect(b.messages.filter(message => message.type === "knowledge_risk_warning")).toEqual([]);
    replace(first, '{"dependencies":{"alpha":"2"}}');
    await new Promise(resolve => setTimeout(resolve, 500));
    expect(a.messages.filter(message => message.type === "knowledge_risk_warning")).toHaveLength(1);
    const warnings = await s.runtime.capture!.listWarnings({ memberId: ada, displayName: "Ada" });
    expect(warnings).toMatchObject([{ cardId: risk.id, file: "package.json", seen: false }]);
    expect(await s.runtime.capture!.listWarnings({ memberId: bob, displayName: "Bob" })).toEqual([]);
    await s.runtime.capture!.markWarningsRead(ada, warnings.map(warning => warning.id));
    expect(await s.runtime.capture!.listWarnings({ memberId: ada, displayName: "Ada" })).toMatchObject([{ seen: true }]);
  });

  it("deduplicates visible reviewed cards and merges a recurrence without a new card", async () => {
    const s = await start(); const ada = await s.join("Ada");
    const card = await s.runtime.knowledge!.create({ memberId: ada, displayName: "Ada" }, { type: "risk", title: "chosen 协作讨论", summary: "保留 chosen 单一常量", content: "chosen 单一常量 code.ts 讨论", scope: "team", tags: ["chosen"] });
    const chat = await s.request(ada, "chat", { text: "chosen 协作讨论 code.ts 保留 chosen 单一常量" });
    const fromChat = await s.request(ada, "knowledge/from-chat", { messageIds: [(chat.body.message as { id: string }).id] });
    const suggestion = fromChat.body.suggestion as CaptureSuggestion;
    expect(suggestion.dedupe?.cardId).toBe(card.id);
    const merge = await s.request(ada, `knowledge/inbox/${suggestion.id}/merge`, { cardId: card.id });
    expect(merge.response.status).toBe(200);
    expect(merge.body.card).toMatchObject({ usage: { recurrenceCount: 1 }, evolution: expect.arrayContaining([expect.objectContaining({ action: "recurrence", note: suggestion.id })]) });
    expect(await s.runtime.knowledge!.list({ memberId: ada, displayName: "Ada" })).toHaveLength(1);
  });

  it("requires a human rule before confirming a fallback Agent draft", async () => {
    const s = await start(); const ada = await s.join("Ada");
    const draft = await s.runtime.knowledge!.createDraft({ memberId: ada, displayName: "Ada" }, {
      type: "decision",
      title: "Agent correction",
      summary: "A rule needs human review",
      content: "## 发生了什么\nAgent changed the file.\n\n## 规则\n",
      tags: ["agent.revised"],
      fallback: true,
      source: "event",
      scope: "personal",
      provenance: {
        origin: "human-agent",
        author: { kind: "human", memberId: ada, displayName: "Ada" },
        trigger: { type: "agent.revised", suggestionId: "suggestion-1" },
        evidenceRefs: { runIds: ["run-1"], chatMessageIds: [] }
      }
    });
    const rejected = await s.request(ada, `knowledge/cards/${draft.id}/confirm`, { edited: false });
    expect(rejected.response.status).toBe(400);
    expect(rejected.body.error).toContain("require a rule");
    const confirmed = await s.request(ada, `knowledge/cards/${draft.id}/confirm`, {
      edited: true,
      patch: { content: "## 发生了什么\nAgent changed the file.\n\n## 规则\nReview the Agent diff before accepting it." }
    });
    expect(confirmed.response.status).toBe(200);
    expect(confirmed.body.card).toMatchObject({ status: "reviewed", fallback: true });
  });

  it("moves an unresolved anchor from needsReview to orphaned after the configured age", async () => {
    const s = await start(); const ada = await s.join("Ada");
    const card = await s.runtime.knowledge!.create({ memberId: ada, displayName: "Ada" }, {
      type: "constraint", title: "Anchor review", summary: "Review this anchor after the file changes", content: "Review this anchor after the file changes.", tags: [], scope: "personal",
      anchors: [{ file: "code.ts", selection: { startLineNumber: 2, startColumn: 1, endLineNumber: 2, endColumn: 27 } }]
    });
    const documentText = await s.connection(ada, "code.ts");
    documentText.delete(0, documentText.length);
    await s.runtime.documents.awaitIdle();
    const resolution = await s.runtime.knowledge!.resolveAnchors({ memberId: ada, displayName: "Ada" }, "code.ts");
    expect(resolution).toEqual(expect.arrayContaining([expect.objectContaining({ cardId: card.id, status: "needsReview" })]));
    const first = await s.runtime.knowledge!.refreshExpired({ memberId: ada, displayName: "Ada" }, "code.ts", 1_000_000);
    expect(first.find((item) => item.id === card.id)).toMatchObject({ status: "needsReview" });
    const second = await s.runtime.knowledge!.refreshExpired({ memberId: ada, displayName: "Ada" }, "code.ts", 0);
    expect(second.find((item) => item.id === card.id)).toMatchObject({ status: "orphaned" });
  });

  it("registers no capture service and creates no knowledge files when disabled", async () => {
    const s = await start("off"); const ada = await s.join("Ada");
    const text = await s.connection(ada); text.insert(0, "// collaboration\n");
    await s.runtime.documents.awaitIdle();
    expect(s.runtime.capture).toBeUndefined();
    const response = await fetch(`${s.origin}/api/projects/demo/knowledge/inbox`);
    expect(response.status).toBe(404);
    const metadata = getProjectMetadataPath(s.runtime.project);
    await expect(fs.access(path.join(metadata, "knowledge"))).rejects.toMatchObject({ code: "ENOENT" });
  });
});
