import { fromMarkdown } from "mdast-util-from-markdown";
import { toString } from "mdast-util-to-string";
import { toMarkdown } from "mdast-util-to-markdown";
import fs from "node:fs/promises";
import path from "node:path";
import { resolveWorkspacePath } from "../workspace.js";
import { canonicalWorkspaceRoot } from "../workspacePath.js";
import { extractFirstJsonObject, removeKnowledgeEvidenceBlocks, type KnowledgeCard, type KnowledgeCardType, type LlmClient, type LlmUsage } from "@simplercp/knowledge";

export interface ImportedDraft {
  type: KnowledgeCardType; title: string; summary: string; content: string;
  startLine: number; endLine: number; files: string[]; fallback: boolean;
}

export async function resolveKnowledgeDocument(root: string, file: string, allowMissing = false) {
  const workspaceRoot = canonicalWorkspaceRoot(root);
  const requestedRoot = path.resolve(root);
  const relative = path.relative(requestedRoot, path.resolve(requestedRoot, file));
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error("Knowledge document path escapes the workspace");
  const parts = relative.split(path.sep);
  let current = workspaceRoot;
  for (let index = 0; index < parts.length; index++) {
    current = path.join(current, parts[index]!);
    const stat = await fs.lstat(current).catch((error: NodeJS.ErrnoException) => {
      if (allowMissing && index === parts.length - 1 && error.code === "ENOENT") return undefined;
      throw error;
    });
    if (stat?.isSymbolicLink()) throw new Error("Knowledge documents must not use symbolic links");
  }
  return resolveWorkspacePath(workspaceRoot, relative);
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
  const exported = tree.children[0]?.type === "heading" && ["Team process knowledge", "团队过程性知识"].includes(toString(tree.children[0]));
  const boundaries: Array<{ startLine: number; endLine: number; title: string; type?: KnowledgeCardType }> = [];
  let sectionType: KnowledgeCardType | undefined;
  for (const node of tree.children) {
    if (exported && node.type === "heading" && node.depth === 2) sectionType = knowledgeTypeEntries.find(([type, label]) => type === toString(node) || label === toString(node))?.[0];
    if (node.type === "heading" && (!exported || node.depth === 3)) {
      boundaries.push({ startLine: node.position!.start.line, endLine: lines.length, title: toString(node), type: sectionType });
    } else if (node.type === "list" && !exported) {
      for (const item of node.children) boundaries.push({ startLine: item.position!.start.line, endLine: lines.length, title: toString(item).split("\n")[0]!.slice(0, 160) });
    }
  }
  if (!boundaries.length && !exported) boundaries.push({ startLine: 1, endLine: lines.length, title: file });
  if (!exported && boundaries[0]!.startLine > 1 && lines.slice(0, boundaries[0]!.startLine - 1).join("\n").trim()) {
    boundaries.unshift({ startLine: 1, endLine: lines.length, title: file });
  }
  return boundaries.flatMap((boundary, index) => {
    const groupEnd = exported ? tree.children.find(node => node.type === "heading" && node.depth <= 2 && node.position!.start.line > boundary.startLine)?.position!.start.line : undefined;
    const endLine = Math.min(boundary.endLine, (boundaries[index + 1]?.startLine ?? lines.length + 1) - 1, (groupEnd ?? lines.length + 1) - 1);
    const content = lines.slice(boundary.startLine - 1, endLine).join("\n").trim();
    const first = tree.children.find((node) => node.position?.start.line === boundary.startLine);
    if (!exported && first?.type === "heading" && !lines.slice(boundary.startLine, endLine).join("\n").trim()) return [];
    if (exported) {
      const nodes = tree.children.filter(node => node.position!.start.line > boundary.startLine && node.position!.end.line <= endLine);
      const summaryNode = nodes.find(node => node.type === "paragraph");
      const body = nodes.find(node => node.type === "blockquote");
      const scopeNode = [...nodes].reverse().find(node => node !== summaryNode && node.type === "paragraph" && toString(node).startsWith("适用范围："));
      const scopeText = scopeNode ? toString(scopeNode).slice("适用范围：".length).trim() : "";
      const scopes = scopeNode?.type === "paragraph" ? scopeNode.children.flatMap(node => node.type === "inlineCode" ? [node.value] : []) : [];
      return [{ type: boundary.type ?? "context", title: boundary.title, summary: summaryNode ? toString(summaryNode) : boundary.title, content: body?.type === "blockquote" ? toMarkdown({ type: "root", children: body.children }).trim() : toString(tree.children[0]!) === "团队过程性知识" ? "" : content, startLine: boundary.startLine, endLine, files: scopes.length ? scopes : !scopeText || scopeText === "整个项目" ? [] : scopeText.split(",").map(value => value.trim()).filter(Boolean), fallback: true }];
    }
    return [{ type: boundary.type ?? (/must|不得|禁止|required|always|never/i.test(content) ? "constraint" as const : "context" as const), title: boundary.title || file, summary: boundary.title || file, content, startLine: boundary.startLine, endLine, files: [], fallback: true }];
  });
}

const knowledgeTypeEntries = [["decision", "决策"], ["constraint", "约束"], ["risk", "风险"], ["context", "上下文"], ["negative", "负向经验"], ["tutorial", "教程"]] as const;

export function exportAgentsMarkdown(cards: KnowledgeCard[]): string {
  const document: ReturnType<typeof fromMarkdown> = { type: "root", children: [{ type: "heading", depth: 1, children: [{ type: "text", value: "团队过程性知识" }] }] };
  for (const [type, label] of knowledgeTypeEntries) {
    const group = cards.filter((card) => card.scope === "team" && card.status === "reviewed" && card.type === type);
    if (!group.length) continue;
    document.children.push({ type: "heading", depth: 2, children: [{ type: "text", value: label }] });
    for (const card of group) {
      const content = removeKnowledgeEvidenceBlocks(card.content);
      const files = card.appliesTo?.kind === "project" ? [] : card.appliesTo?.kind === "glob" ? card.appliesTo.patterns : card.anchors.map(anchor => anchor.file.workspaceRelativePath);
      document.children.push(
        { type: "heading", depth: 3, children: [{ type: "text", value: card.title.replace(/[\r\n]/g, " ") }] },
        { type: "paragraph", children: [{ type: "text", value: card.summary.replace(/[\r\n]/g, " ") }] },
        ...(content ? [{ type: "blockquote" as const, children: fromMarkdown(content).children as Extract<ReturnType<typeof fromMarkdown>["children"][number], { type: "blockquote" }>["children"] }] : []),
        { type: "paragraph", children: [{ type: "text", value: "适用范围：" }, ...(files.length ? files.flatMap((file, index) => [...(index ? [{ type: "text" as const, value: ", " }] : []), { type: "inlineCode" as const, value: file }]) : [{ type: "text" as const, value: "整个项目" }])] }
      );
    }
  }
  return toMarkdown(document);
}
