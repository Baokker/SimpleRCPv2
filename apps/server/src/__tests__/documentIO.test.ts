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
  });
  it("preserves exactly one imported entry per exported card", () => {
    const cards: KnowledgeCard[] = (["constraint", "negative", "context"] as const).map((type, index) => ({ schemaVersion: LatestSchemaVersion, type, id: String(index), title: `Card ${index}`, summary: "rule", content: "## Inner heading\n\n- first rule\n- second rule", scope: "team", status: "reviewed", tags: [], createdAt: 1, updatedAt: 1, metadata: {}, evolution: [], anchors: [], appliesTo: { kind: "project" } }));
    const markdown = exportAgentsMarkdown(cards);
    expect(deterministicImport(markdown, "AGENTS.md").map(draft => draft.title).sort()).toEqual(cards.map(card => card.title).sort());
    expect(exportAgentsMarkdown([{ ...cards[0]!, scope: "personal" }])).not.toContain("Card 0");
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
  it("exports explicit project scope independently of source evidence anchors", () => {
    const [card] = createDemoKnowledgeCards({ workspaceRelativePath: "README.md", selectedText: "Use sharedHelper", now: 1 });
    const markdown = exportAgentsMarkdown([{ ...card!, scope: "team", appliesTo: { kind: "project" } }]);
    expect(markdown).toContain("Applies to: project");
    expect(markdown).not.toContain("Applies to: README.md");
    expect(exportAgentsMarkdown([{ ...card!, scope: "team", appliesTo: { kind: "glob", patterns: ["src/**"] } }])).toContain("Applies to: src/**");
  });
});
