import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { deterministicImport, exportAgentsMarkdown, parseImportedDrafts, resolveKnowledgeDocument } from "../knowledge/documentIO.js";
import { createTestWorkspace } from "./testWorkspace.js";
import { LatestSchemaVersion, type KnowledgeCard } from "@simplercp/knowledge";
import { createDemoKnowledgeCards } from "@simplercp/knowledge";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true }))); });
describe("knowledge document IO", () => {
  it("validates actual source line ranges and removes reasoning before JSON parsing", () => {
    const text = JSON.stringify({ items: [{ type: "constraint", title: "Use helper", summary: "Use helper", content: "Use sharedHelper", startLine: 2, endLine: 2, files: ["src/**"] }] });
    const drafts = parseImportedDrafts(`<think>reasoning</think>${text}`, "# Rules\nUse sharedHelper\n");
    expect(drafts[0]).toMatchObject({ startLine: 2, endLine: 2, files: ["src/**"], fallback: false });
    expect(() => parseImportedDrafts(text, "short")).toThrow("line range");
    expect(() => parseImportedDrafts(text.replace('"src/**"', '"../secret"'), "# Rules\nUse helper")).toThrow("appliesTo");
  });
  it("uses Markdown syntax for headings, list items and code fences", () => {
    const source = "# Rules\n\n- Use helper\n- Preserve state\n\n```js\n# text inside a fence\n```\n";
    const drafts = deterministicImport(source, "AGENTS.md");
    expect(drafts).toHaveLength(2);
    expect(drafts[0]?.startLine).toBe(3);
    expect(drafts[1]?.startLine).toBe(4);
    expect(drafts.every(draft => draft.fallback)).toBe(true);
    expect(drafts[1]?.content).toContain("# text inside a fence");
  });
  it("retains instructions after a list together with their source line range", () => {
    const source = "# Rules\n\n- Preserve sharedHelper.\n\nRun npm test after every change.\n";
    const drafts = deterministicImport(source, "CONTRIBUTING.md");
    expect(drafts).toHaveLength(1);
    expect(drafts[0]).toMatchObject({ startLine: 3, endLine: 6 });
    expect(drafts[0]?.content).toContain("Run npm test after every change.");
    const prefixed = deterministicImport(`Run npm test.\n\n${source}`, "CONTRIBUTING.md");
    expect(prefixed).toHaveLength(2);
    expect(prefixed[0]).toMatchObject({ startLine: 1, endLine: 2, content: "Run npm test." });
    expect(deterministicImport("# Team process knowledge\n", "AGENTS.md")).toEqual([]);
  });
  it("preserves exactly one imported entry per exported card", () => {
    const cards: KnowledgeCard[] = (["decision", "constraint", "risk", "context", "negative", "tutorial"] as const).map((type, index) => ({ schemaVersion: LatestSchemaVersion, type, id: `private-id-${index}`, title: `Card ${index}`, summary: "rule", content: "## Inner heading\n\n- first rule\n- second rule\n\n## Evidence\n```json\n{\"chatMessages\":[\"raw input\"]}\n```", scope: "team", status: "reviewed", tags: [], createdAt: 1, updatedAt: 1, metadata: { createdBy: { peerId: "private-member-id", name: "Private author" } }, evolution: [], anchors: [], appliesTo: { kind: "glob", patterns: ["src/**", "lib/**"] } }));
    const markdown = exportAgentsMarkdown(cards);
    expect(deterministicImport(markdown, "AGENTS.md").map(draft => draft.title).sort()).toEqual(cards.map(card => card.title).sort());
    expect(exportAgentsMarkdown([{ ...cards[0]!, scope: "personal" }])).not.toContain("Card 0");
    for (const heading of ["决策", "约束", "风险", "上下文", "负向经验", "教程"]) expect(markdown).toContain(`## ${heading}`);
    for (const text of ["private-id", "Private author", "chatMessages", "raw input", "Evidence"]) expect(markdown).not.toContain(text);
    const imported = deterministicImport(markdown, "AGENTS.md");
    expect(imported).toHaveLength(cards.length);
    for (const card of cards) {
      const draft = imported.find(item => item.title === card.title)!;
      expect(draft).toMatchObject({ type: card.type, summary: card.summary, files: ["src/**", "lib/**"] });
      expect(draft.content).toContain("## Inner heading");
      expect(draft.content).toContain("first rule");
      expect(draft.content).not.toContain("适用范围：");
    }
  });
  it("rejects symbolic links and traversal for both reading and writing", async () => {
    const root = await createTestWorkspace("knowledge-document-"); roots.push(root);
    const workspace = path.join(root, "workspace"); await fs.mkdir(workspace);
    await fs.writeFile(path.join(root, "outside.md"), "private");
    await fs.symlink(path.join(root, "outside.md"), path.join(workspace, "AGENTS.md"));
    await expect(resolveKnowledgeDocument(workspace, "AGENTS.md")).rejects.toThrow("symbolic links");
    await expect(resolveKnowledgeDocument(workspace, "AGENTS.md", true)).rejects.toThrow("symbolic links");
    await expect(resolveKnowledgeDocument(workspace, "../outside.md")).rejects.toThrow("escapes");
    await expect(resolveKnowledgeDocument(workspace, "AGENTS.knowledge.md", true)).resolves.toBe(path.join(workspace, "AGENTS.knowledge.md"));
  });
  it("拒绝工作区内部的文件与目录 symbolic link，并支持工作区根目录的别名", async () => {
    const root = await createTestWorkspace("knowledge-document-"); roots.push(root);
    const workspace = path.join(root, "workspace"); await fs.mkdir(workspace);
    await fs.mkdir(path.join(workspace, "rules"));
    await fs.writeFile(path.join(workspace, "rules", "CONTRIBUTING.md"), "Use sharedHelper");
    await fs.symlink(path.join(workspace, "rules", "CONTRIBUTING.md"), path.join(workspace, "AGENTS.md"));
    await fs.symlink(path.join(workspace, "rules"), path.join(workspace, "linked-rules"));
    await fs.symlink(workspace, path.join(root, "workspace-alias"));
    await expect(resolveKnowledgeDocument(workspace, "AGENTS.md")).rejects.toThrow("symbolic links");
    await expect(resolveKnowledgeDocument(workspace, "linked-rules/CONTRIBUTING.md")).rejects.toThrow("symbolic links");
    await expect(resolveKnowledgeDocument(workspace, "linked-rules/new.md", true)).rejects.toThrow("symbolic links");
    await expect(resolveKnowledgeDocument(path.join(root, "workspace-alias"), "rules/CONTRIBUTING.md")).resolves.toBe(path.join(workspace, "rules", "CONTRIBUTING.md"));
  });
  it("preserves summaries that begin with the scope label", () => {
    const [card] = createDemoKnowledgeCards({ workspaceRelativePath: "README.md", selectedText: "Use sharedHelper", now: 1 });
    for (const content of ["保留 sharedHelper。", ""]) {
      const source = { ...card!, scope: "team" as const, summary: "适用范围：价格计算", content, appliesTo: { kind: "glob" as const, patterns: ["src/**"] } };
      const [imported] = deterministicImport(exportAgentsMarkdown([source]), "AGENTS.md");
      expect(imported).toMatchObject({ title: source.title, summary: source.summary, content, files: ["src/**"] });
    }
  });
  it("exports explicit project scope independently of source evidence anchors", () => {
    const [card] = createDemoKnowledgeCards({ workspaceRelativePath: "README.md", selectedText: "Use sharedHelper", now: 1 });
    const markdown = exportAgentsMarkdown([{ ...card!, scope: "team", appliesTo: { kind: "project" } }]);
    expect(markdown).toContain("适用范围：整个项目");
    expect(markdown).not.toContain("适用范围：README.md");
    expect(exportAgentsMarkdown([{ ...card!, scope: "team", appliesTo: { kind: "glob", patterns: ["src/**"] } }])).toContain("适用范围：`src/**`");
  });
});
