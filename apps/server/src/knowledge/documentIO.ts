import { fromMarkdown } from "mdast-util-from-markdown";
import { toString } from "mdast-util-to-string";
import fs from "node:fs/promises";
import path from "node:path";
import { resolveWorkspacePath } from "../workspace.js";
import { extractFirstJsonObject, type KnowledgeCard, type KnowledgeCardType, type LlmClient, type LlmUsage } from "@simplercp/knowledge";

export interface ImportedDraft {
  type: KnowledgeCardType; title: string; summary: string; content: string;
  startLine: number; endLine: number; files: string[]; fallback: boolean;
}

export async function resolveKnowledgeDocument(root: string, file: string, allowMissing = false) {
  const target = resolveWorkspacePath(root, file);
  const parts = path.relative(path.resolve(root), target).split(path.sep);
  let current = path.resolve(root);
  for (let index = 0; index < parts.length; index++) {
    current = path.join(current, parts[index]!);
    const stat = await fs.lstat(current).catch((error: NodeJS.ErrnoException) => {
      if (allowMissing && index === parts.length - 1 && error.code === "ENOENT") return undefined;
      throw error;
    });
    if (stat?.isSymbolicLink()) throw new Error("Knowledge documents must not use symbolic links");
  }
  return target;
}

export function parseImportedDrafts(text: string, source: string): ImportedDraft[] {
  const json = extractFirstJsonObject(text);
  if (!json) throw new Error("Imported drafts must be a JSON object");
  const parsed: unknown = JSON.parse(json);
  if (!parsed || typeof parsed !== "object" || !Array.isArray((parsed as { items?: unknown }).items)) throw new Error("Imported drafts require items");
  const lines = source.split("\n");
  return ((parsed as { items: unknown[] }).items).map((item) => {
    if (!item || typeof item !== "object") throw new Error("Imported draft is invalid");
    const input = item as Record<string, unknown>;
    if (!["decision", "constraint", "risk", "context", "negative", "tutorial"].includes(String(input.type))) throw new Error("Imported draft type is invalid");
    for (const key of ["title", "summary", "content"] as const) if (typeof input[key] !== "string" || !input[key].trim()) throw new Error(`Imported ${key} is required`);
    const startLine = input.startLine; const endLine = input.endLine;
    if (typeof startLine !== "number" || typeof endLine !== "number" || !Number.isInteger(startLine) || !Number.isInteger(endLine) || startLine < 1 || endLine < startLine || endLine > lines.length || !lines.slice(startLine - 1, endLine).join("\n").trim()) throw new Error("Imported evidence line range is invalid");
    if (!Array.isArray(input.files) || input.files.some((file) => typeof file !== "string" || !file || file.startsWith("/") || file.split("/").includes(".."))) throw new Error("Imported appliesTo files are invalid");
    return { type: input.type as KnowledgeCardType, title: String(input.title).trim(), summary: String(input.summary).trim(), content: String(input.content).trim(), startLine, endLine, files: input.files as string[], fallback: false };
  });
}

export async function splitImportedDocument(source: string, options: { file: string; model?: string; client?: LlmClient; onCall?(request: string, usage: LlmUsage | undefined, completed: boolean): void }): Promise<ImportedDraft[]> {
  if (!source.trim()) return [];
  if (options.client) {
    const messages = [
      { role: "system" as const, content: '将文档中的规范转换为原子知识草稿，只依据原文，保留代码标识符。返回 JSON {"items":[{"type":"constraint","title":"...","summary":"...","content":"...","startLine":1,"endLine":2,"files":[]}]}。type 只能为 decision、constraint、risk、context、negative、tutorial。自然语言使用中文。startLine/endLine 是下方编号原文中确实存在的非空证据范围。files 为适用文件或 glob，项目级规则使用空数组。不要生成原文没有的规则。' },
      { role: "user" as const, content: `FILE: ${options.file}\n${source.split("\n").map((line, index) => `${index + 1}: ${line}`).join("\n")}` }
    ];
    let usage: LlmUsage | undefined;
    try {
      const result = await options.client.complete({ model: options.model ?? "", messages, responseFormat: { type: "json_object" }, timeoutMs: 60_000 });
      usage = result.usage;
      const items = parseImportedDrafts(result.text, source);
      if (!items.length) throw new Error("Model produced no imported drafts");
      options.onCall?.(JSON.stringify(messages), usage, true);
      return items;
    } catch {
      options.onCall?.(JSON.stringify(messages), usage, false);
    }
  }
  return deterministicImport(source, options.file);
}

export function deterministicImport(source: string, file: string): ImportedDraft[] {
  const tree = fromMarkdown(source);
  const lines = source.split("\n");
  const exported = tree.children[0]?.type === "heading" && toString(tree.children[0]) === "Team process knowledge";
  const boundaries: Array<{ startLine: number; endLine: number; title: string }> = [];
  for (const node of tree.children) {
    if (node.type === "heading" && (!exported || node.depth === 3)) {
      boundaries.push({ startLine: node.position!.start.line, endLine: lines.length, title: toString(node) });
    } else if (node.type === "list" && !exported) {
      for (const item of node.children) boundaries.push({ startLine: item.position!.start.line, endLine: item.position!.end.line, title: toString(item).split("\n")[0]!.slice(0, 160) });
    }
  }
  if (!boundaries.length && !exported) boundaries.push({ startLine: 1, endLine: lines.length, title: file });
  return boundaries.flatMap((boundary, index) => {
    const endLine = Math.min(boundary.endLine, (boundaries[index + 1]?.startLine ?? lines.length + 1) - 1);
    const content = lines.slice(boundary.startLine - 1, endLine).join("\n").trim();
    const first = tree.children.find((node) => node.position?.start.line === boundary.startLine);
    if (!exported && first?.type === "heading" && !lines.slice(boundary.startLine, endLine).join("\n").trim()) return [];
    return [{ type: /must|不得|禁止|required|always|never/i.test(content) ? "constraint" as const : "context" as const, title: boundary.title || file, summary: boundary.title || file, content, startLine: boundary.startLine, endLine, files: [], fallback: true }];
  });
}

export function exportAgentsMarkdown(cards: KnowledgeCard[]): string {
  const lines = ["# Team process knowledge", "", "Generated from reviewed team knowledge cards.", ""];
  for (const type of ["decision", "constraint", "risk", "context", "negative", "tutorial"] as const) {
    const group = cards.filter((card) => card.scope === "team" && card.status === "reviewed" && card.type === type);
    if (!group.length) continue;
    lines.push(`## ${type}`, "");
    for (const card of group) {
      lines.push(`### ${card.title.replace(/[\r\n]/g, " ")}`, "", ...(card.content || card.summary).split("\n").map((line) => `> ${line}`), "", `Applies to: ${card.appliesTo?.kind === "project" ? "project" : card.appliesTo?.kind === "glob" ? card.appliesTo.patterns.join(", ") : card.anchors.length ? card.anchors.map((anchor) => anchor.file.workspaceRelativePath).join(", ") : "project"}`, "");
    }
  }
  return lines.join("\n");
}
