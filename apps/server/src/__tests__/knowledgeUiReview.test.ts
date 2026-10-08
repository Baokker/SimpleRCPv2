import fs from "node:fs/promises";
import path from "node:path";
import http from "node:http";
import { expect, it, vi } from "vitest";
import { createApp } from "../createApp.js";
import { createTestWorkspace } from "./testWorkspace.js";
import { assistManualKnowledge } from "../knowledge/manualAssist.js";

it("文件、项目与路径模式规则保持有效，代码关联支持全部复核操作", async () => {
  const root = await createTestWorkspace("knowledge-ui-review-");
  const source = path.join(root, "source");
  await fs.mkdir(source); await fs.writeFile(path.join(source, "README.md"), "Original shared helper.\n");
  const app = await createApp({ port: 0, host: "127.0.0.1", publicOrigin: "http://127.0.0.1:5173", dataDir: path.join(root, "data"), demoProjectRoot: source, terminalEnabled: false, fakeAgentRuntime: true, knowledge: "full", agent: { baseUrl: "https://api.deepseek.com/v1", model: "deepseek-chat" } });
  const server = http.createServer(app);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); if (!address || typeof address === "string") throw new Error("Missing server address");
  const origin = `http://127.0.0.1:${address.port}`;
  try {
    const member = await (await fetch(`${origin}/api/projects/demo/members`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "Alice" }) })).json() as { member: { id: string } };
    const headers = { "content-type": "application/json", "X-SimpleRCP-Member": member.member.id };
    const create = async (title: string, fields: object) => {
      const response = await fetch(`${origin}/api/projects/demo/knowledge/cards`, { method: "POST", headers, body: JSON.stringify({ type: "constraint", title, content: "保留项目规则。第二句话。", scope: "team", ...fields }) });
      expect(response.status).toBe(201);
      return (await response.json() as { card: { id: string; summary: string; anchors: Array<{ snapshot: { text: string }; yjsRelative?: unknown; rangeAtCapture?: unknown }> } }).card;
    };
    const blockFields = { anchors: [{ file: "README.md", startLine: 1, endLine: 1 }] };
    const blocks = await Promise.all(["reassociate", "valid", "archive"].map(title => create(title, blockFields)));
    const file = await create("file", { anchors: [{ file: "README.md", associationLevel: "file" }] });
    expect(file.anchors[0]).toMatchObject({ snapshot: { text: "" } });
    expect(file.anchors[0]?.yjsRelative).toBeUndefined(); expect(file.anchors[0]?.rangeAtCapture).toBeUndefined();
    expect(file.summary).toBe("保留项目规则。");
    const summary = await create("summary", { content: "## 规则\n修改 src/session.ts 时保留 sharedHelper。请运行测试。" });
    expect(summary.summary).toBe("修改 src/session.ts 时保留 sharedHelper。");
    const project = await create("project", { appliesTo: { kind: "project" } });
    const glob = await create("glob", { appliesTo: { kind: "glob", patterns: ["**/*.md"] } });
    const fileOnlyPreview = await (await fetch(`${origin}/api/projects/demo/knowledge/preview`, { method: "POST", headers, body: JSON.stringify({ prompt: "编写文档", contexts: [{ kind: "file", path: "README.md" }] }) })).json() as { candidates: Array<{ id: string; lexical: number }> };
    expect(fileOnlyPreview.candidates).toContainEqual(expect.objectContaining({ id: file.id, lexical: 0 }));
    const runtime = app.locals.runtimeManager.get("demo");
    await runtime.documents.getDocument(runtime.room.id, "README.md");
    await fs.writeFile(path.join(runtime.project.workspacePath, "README.md"), "Completely replaced documentation.\n");
    await vi.waitFor(async () => {
      const response = await fetch(`${origin}/api/projects/demo/knowledge/cards/${blocks[0]!.id}`, { headers });
      expect((await response.json() as { card: { status: string } }).card.status).toBe("needsReview");
    }, { timeout: 5000, interval: 30 });
    const list = await (await fetch(`${origin}/api/projects/demo/knowledge/cards?file=README.md`, { headers })).json() as { cards: Array<{ id: string; status: string }> };
    for (const card of blocks) expect(list.cards.find(item => item.id === card.id)?.status).toBe("needsReview");
    for (const card of [file, project, glob]) expect(list.cards.find(item => item.id === card.id)?.status).toBe("reviewed");
    const preview = await (await fetch(`${origin}/api/projects/demo/knowledge/preview`, { method: "POST", headers, body: JSON.stringify({ prompt: "完善一下这个项目的README", contexts: [{ kind: "file", path: "README.md" }] }) })).json() as { reviewCards: Array<{ id: string }>; records: Array<{ id: string }> };
    expect(preview.reviewCards.map(card => card.id)).toEqual(expect.arrayContaining(blocks.map(card => card.id)));
    for (const card of blocks) expect(preview.records.map(item => item.id)).not.toContain(card.id);
    const post = async (id: string, action: string, data: object) => fetch(`${origin}/api/projects/demo/knowledge/cards/${id}/${action}`, { method: "POST", headers, body: JSON.stringify(data) });
    const reassociated = await post(blocks[0]!.id, "review", { action: "reassociate", file: "README.md", selection: { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 11 } });
    expect(reassociated.status).toBe(200); expect((await reassociated.json() as { card: { status: string } }).card.status).toBe("reviewed");
    const valid = await post(blocks[1]!.id, "review", { action: "valid" });
    expect(valid.status).toBe(200); expect((await valid.json() as { card: { status: string; anchors: Array<{ associationLevel: string }> } }).card).toMatchObject({ status: "reviewed", anchors: [{ associationLevel: "file" }] });
    const archived = await post(blocks[2]!.id, "archive", { reason: "不再使用这项规则" });
    expect(archived.status).toBe(200); expect((await archived.json() as { card: { status: string } }).card.status).toBe("archived");
    const fileReview = await post(blocks[0]!.id, "review", { action: "file" });
    expect(fileReview.status).toBe(200); expect((await fileReview.json() as { card: { anchors: Array<{ associationLevel: string }> } }).card.anchors[0]?.associationLevel).toBe("file");
    const multiple = await create("multiple anchors", { anchors: [{ file: "README.md", startLine: 1, endLine: 1 }, { file: "README.md", startLine: 1, endLine: 1 }] });
    await fs.writeFile(path.join(runtime.project.workspacePath, "README.md"), "A new chapter replaces the original implementation.\n");
    await vi.waitFor(async () => {
      const response = await fetch(`${origin}/api/projects/demo/knowledge/cards/${multiple.id}`, { headers });
      expect((await response.json() as { card: { status: string } }).card.status).toBe("needsReview");
    }, { timeout: 5000, interval: 30 });
    const firstReview = await post(multiple.id, "review", { action: "file", anchorIndex: 0 });
    expect(firstReview.status).toBe(200); expect((await firstReview.json() as { card: { status: string } }).card.status).toBe("needsReview");
    const secondReview = await post(multiple.id, "review", { action: "file", anchorIndex: 1 });
    expect(secondReview.status).toBe(200); expect((await secondReview.json() as { card: { status: string } }).card.status).toBe("reviewed");
    await fs.unlink(path.join(runtime.project.workspacePath, "README.md"));
    await runtime.knowledge!.refreshExpired({ memberId: member.member.id, displayName: "Alice" }, "README.md");
    const missingFile = await (await fetch(`${origin}/api/projects/demo/knowledge/cards?file=README.md`, { headers })).json() as { cards: Array<{ id: string; status: string }>; resolutions: Array<{ cardId: string; status: string; reason?: string }> };
    expect(missingFile.cards.find(card => card.id === file.id)?.status).toBe("reviewed");
    expect(missingFile.resolutions).toContainEqual(expect.objectContaining({ cardId: file.id, reason: "missing", status: "needsReview" }));
    const activity = await (await fetch(`${origin}/api/projects/demo/knowledge/activity`, { headers })).json() as { items: Array<{ category: string; text: string }> };
    expect(activity.items.some(item => item.category === "confirmation")).toBe(true);
    expect(activity.items.some(item => item.category === "evolution" && item.text.includes("不再使用这项规则"))).toBe(true);
    const assisted = await fetch(`${origin}/api/projects/demo/knowledge/manual-assist`, { method: "POST", headers, body: JSON.stringify({ description: "README 全部使用英文，供外部成员阅读。" }) });
    expect(assisted.status).toBe(200);
    const calls = await fs.readFile(path.join(root, "data", "projects", "demo", "knowledge", "llm-calls.jsonl"), "utf8");
    expect(calls).toContain('"mode":"manual-assist"');
  } finally {
    await app.locals.agentRuns.dispose(); await app.locals.agentRuntime.dispose(); await app.locals.runtimeManager.dispose();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await fs.rm(root, { recursive: true, force: true });
  }
});

it("手动 AI 整理使用抽取流程，并记录证据与模型用量", async () => {
  const result = await assistManualKnowledge({ description: "README 全部使用英文", selection: { file: "README.md", text: "# Project" }, provider: "minimax", model: "test-model", client: { async complete(request) {
    expect(request.messages.some(message => message.content.includes("README 全部使用英文"))).toBe(true);
    return { text: JSON.stringify({ type: "constraint", title: "README 使用英文", summary: "项目 README 全部使用英文，供外部成员阅读。", content: "项目 README 的标题、说明和操作指引全部使用英文，代码标识符保持原样。修改文档后核对新增段落的语言。", tags: ["documentation"], evidenceCitations: ["evidence.description"], confidence: 0.9, unknowns: [] }), usage: { totalTokens: 123 } };
  } } });
  expect(result.fallback).toBe(false); expect(result.draft.type).toBe("constraint"); expect(result.applicability).toEqual({ kind: "block", file: "README.md" });
  expect(result.call).toMatchObject({ mode: "manual-assist", provider: "minimax", model: "test-model", completed: true, usage: { totalTokens: 123 } });
});
