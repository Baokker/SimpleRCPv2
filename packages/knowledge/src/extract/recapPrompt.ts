import type { KnowledgeCardType } from "../schema/card.js";
import type { LlmClient } from "../llm/client.js";
import { extractFirstJsonObject } from "./extract.js";

export interface AgentRecapDraft {
  type: Extract<KnowledgeCardType, "negative" | "constraint" | "decision" | "risk">;
  title: string;
  summary: string;
  whatHappened: string;
  correction: string;
  rule: string;
  appliesTo: { files: string[]; globs: string[]; taskKinds: string[] };
  notApplicable: string;
  scopeSuggestion: { scope: "team" | "personal"; reason: string };
  checkSuggestion?: { kind: "regex-absent" | "regex-present"; pattern: string; fileGlob: string };
  confidence: number;
  evidenceCitations: string[];
  unknowns: string[];
}

export const agentRecapSystemPrompt = `You create a grounded knowledge rule from an Agent correction. Use only the supplied evidence. Return one strict JSON object with type, title, summary, whatHappened, correction, rule, appliesTo, notApplicable, scopeSuggestion, checkSuggestion, confidence, evidenceCitations, and unknowns. The rule must be checkable, and every evidence citation must refer to a path in the supplied evidence. Do not include markdown fences or extra text.`;

export interface AgentRecapOptions {
  model: string;
  client?: LlmClient;
  maxAttempts?: number;
  onFallback?(): void;
}

export function parseAgentRecapDraft(text: string, evidence: Record<string, unknown>): AgentRecapDraft | undefined {
  const json = extractFirstJsonObject(text);
  if (!json) return undefined;
  let value: unknown;
  try { value = JSON.parse(json); } catch { return undefined; }
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const input = value as Record<string, unknown>;
  const type = input.type;
  if (type !== "negative" && type !== "constraint" && type !== "decision" && type !== "risk") return undefined;
  if (!["title", "summary", "whatHappened", "correction", "rule", "notApplicable"].every((key) => typeof input[key] === "string" && String(input[key]).trim())) return undefined;
  const applies = normalizeApplies(input.appliesTo);
  const scope = normalizeScope(input.scopeSuggestion);
  const confidence = typeof input.confidence === "number" && Number.isFinite(input.confidence) ? Math.max(0, Math.min(1, input.confidence)) : undefined;
  const citations = strings(input.evidenceCitations);
  const unknowns = strings(input.unknowns);
  if (!applies || !scope || confidence === undefined || !citations.length || citations.some((citation) => !citationExists(citation, evidence))) return undefined;
  const check = normalizeCheck(input.checkSuggestion);
  if (input.checkSuggestion !== undefined && input.checkSuggestion !== null && !check) return undefined;
  return { type, title: String(input.title).trim(), summary: String(input.summary).trim(), whatHappened: String(input.whatHappened).trim(), correction: String(input.correction).trim(), rule: String(input.rule).trim(), appliesTo: applies, notApplicable: String(input.notApplicable).trim(), scopeSuggestion: scope, ...(check ? { checkSuggestion: check } : {}), confidence, evidenceCitations: citations, unknowns };
}

export async function extractAgentRecapDraft(evidence: Record<string, unknown>, options: AgentRecapOptions): Promise<{ draft: AgentRecapDraft; fallback: boolean }> {
  if (!options.client) {
    options.onFallback?.();
    return { draft: createAgentRecapFallback(evidence), fallback: true };
  }
  const maxAttempts = Math.max(1, Math.min(3, Math.floor(options.maxAttempts ?? 3)));
  let previous = "";
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const result = await options.client.complete({ model: options.model, messages: [
      { role: "system", content: agentRecapSystemPrompt },
      { role: "user", content: `AGENT CORRECTION EVIDENCE (JSON):\n${JSON.stringify(evidence).slice(0, 24_000)}` },
      ...(previous ? [{ role: "user" as const, content: `Previous output was invalid. Return strict JSON only:\n${previous.slice(0, 8_000)}` }] : [])
    ], responseFormat: { type: "json_object" }, timeoutMs: 30_000 });
    previous = result.text;
    const draft = parseAgentRecapDraft(result.text, evidence);
    if (draft) return { draft, fallback: false };
  }
  options.onFallback?.();
  return { draft: createAgentRecapFallback(evidence), fallback: true };
}

export function createAgentRecapFallback(evidence: Record<string, unknown>): AgentRecapDraft {
  const file = typeof evidence.file === "string" ? evidence.file : undefined;
  const before = typeof evidence.whatHappened === "string" ? evidence.whatHappened : "Agent 修改了工作区内容。";
  const correction = typeof evidence.correction === "string" ? evidence.correction : "成员随后修改了 Agent 的结果。";
  const firstEvidenceKey = Object.keys(evidence)[0];
  const citation = file ? "evidence.file" : firstEvidenceKey ? `evidence.${firstEvidenceKey}` : "evidence";
  return { type: "decision", title: "记录 Agent 修改后的人工纠正", summary: file ? `成员在 ${file} 上纠正了 Agent 的修改。` : "成员纠正了 Agent 的修改。", whatHappened: before, correction, rule: "执行相同任务时先核对 Agent 修改涉及的文件和已有约束。", appliesTo: { files: file ? [file] : [], globs: [], taskKinds: [] }, notApplicable: "证据不足以覆盖其他任务。", scopeSuggestion: { scope: "personal", reason: "需要另一名成员确认后再扩大适用范围。" }, confidence: 0.45, evidenceCitations: [citation], unknowns: ["纠正原因需要成员确认。"] };
}

function strings(value: unknown) { return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim()).slice(0, 24) : []; }
function normalizeApplies(value: unknown) { if (!value || typeof value !== "object" || Array.isArray(value)) return undefined; const input = value as Record<string, unknown>; const files = strings(input.files); const globs = strings(input.globs); const taskKinds = strings(input.taskKinds); return { files, globs, taskKinds }; }
function normalizeScope(value: unknown) { if (!value || typeof value !== "object" || Array.isArray(value)) return undefined; const input = value as Record<string, unknown>; if ((input.scope !== "team" && input.scope !== "personal") || typeof input.reason !== "string" || !input.reason.trim()) return undefined; return { scope: input.scope, reason: input.reason.trim() } as { scope: "team" | "personal"; reason: string }; }
function normalizeCheck(value: unknown) { if (!value || typeof value !== "object" || Array.isArray(value)) return undefined; const input = value as Record<string, unknown>; if ((input.kind !== "regex-absent" && input.kind !== "regex-present") || typeof input.pattern !== "string" || typeof input.fileGlob !== "string") return undefined; try { new RegExp(input.pattern); } catch { return undefined; } return { kind: input.kind, pattern: input.pattern, fileGlob: input.fileGlob } as { kind: "regex-absent" | "regex-present"; pattern: string; fileGlob: string }; }
function citationExists(path: string, evidence: unknown): boolean {
  if (path === "evidence") return true;
  const parts = path.startsWith("evidence.") ? path.slice("evidence.".length).split(".") : path.split(".");
  let value: unknown = evidence;
  for (const part of parts) {
    if (!value || typeof value !== "object" || !(part in value)) return false;
    value = (value as Record<string, unknown>)[part];
  }
  return value !== undefined;
}
