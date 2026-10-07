import type { KnowledgeCardType } from "../schema/card.js";
import type { LlmClient } from "../llm/client.js";
import { extractFirstJsonObject } from "./extract.js";
import { correctedIdentifiers, correctedSymbolBindings, validateRecapCheck } from "./recapEvidence.js";
export { correctedIdentifiers, correctedSymbolBindings, recapFileVersions, validateRecapCheck } from "./recapEvidence.js";

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
  fallback?: boolean;
  checkValidation?: ReturnType<typeof validateRecapCheck>;
}

export const agentRecapSystemPrompt = `You create a grounded knowledge rule from an Agent correction. Use only the supplied evidence. Return one strict JSON object with exactly these fields: type, title, summary, whatHappened, correction, rule, appliesTo, notApplicable, scopeSuggestion, checkSuggestion, confidence, evidenceCitations, and unknowns. type must be one of "negative", "constraint", "decision", "risk". appliesTo must be an object with string arrays files, globs, and taskKinds. scopeSuggestion must be an object {"scope":"team"|"personal","reason":string}. checkSuggestion must be null or an object {"kind":"regex-absent"|"regex-present","pattern":string,"fileGlob":string}. confidence must be a number from 0 to 1. evidenceCitations and unknowns must be arrays of strings. title, summary, whatHappened, correction, rule, and notApplicable must be non-empty strings. The rule must describe a checkable code-level action or prohibition and point to a concrete file, function, symbol, or code pattern. Only write a collaboration process rule when the evidence explicitly contains that process requirement. Good example: "In src/session.ts, preserve the shared helper when changing session setup." Bad example: "Agents must ask a member before editing shared files" when the evidence only shows a code correction. Natural-language fields must use the requested language; preserve code identifiers exactly. Every evidence citation must refer to a path in the supplied evidence. Use only citation paths listed in the evidence-path section. Do not include markdown fences, <think> blocks, or extra text.`;

export interface AgentRecapOptions {
  model: string;
  client?: LlmClient;
  maxAttempts?: number;
  onFallback?(): void;
  language?: "zh" | "en";
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
  const confidence = typeof input.confidence === "number" && Number.isFinite(input.confidence) && input.confidence >= 0 && input.confidence <= 1 ? input.confidence : undefined;
  if (!isStringArray(input.evidenceCitations) || !isStringArray(input.unknowns)) return undefined;
  const citations = strings(input.evidenceCitations).filter((citation) => citationExists(citation, evidence));
  const unknowns = strings(input.unknowns);
  if (!applies || !scope || confidence === undefined || !citations.length) return undefined;
  const check = normalizeCheck(input.checkSuggestion);
  if (input.checkSuggestion !== undefined && input.checkSuggestion !== null && !check) return undefined;
  const checkValidation = check ? validateRecapCheck(check, evidence) : undefined;
  if (checkValidation && !checkValidation.retained) unknowns.push("自动检查未通过验证，已移除");
  return { type, title: String(input.title).trim(), summary: String(input.summary).trim(), whatHappened: String(input.whatHappened).trim(), correction: String(input.correction).trim(), rule: String(input.rule).trim(), appliesTo: applies, notApplicable: String(input.notApplicable).trim(), scopeSuggestion: scope, ...(check && checkValidation?.retained ? { checkSuggestion: check } : {}), ...(checkValidation ? {checkValidation} : {}), confidence, evidenceCitations: citations, unknowns, fallback: false };
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
      { role: "system", content: buildAgentRecapSystemPrompt(evidence, options.language ?? "zh") },
      { role: "user", content: `AGENT CORRECTION EVIDENCE (JSON):\n${JSON.stringify(evidence)}` },
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
  return { type: "decision", title: "记录 Agent 修改后的人工纠正", summary: file ? `成员在 ${file} 上纠正了 Agent 的修改。` : "成员纠正了 Agent 的修改。", whatHappened: before, correction, rule: "", appliesTo: { files: file ? [file] : [], globs: [], taskKinds: [] }, notApplicable: "证据不足以覆盖其他任务。", scopeSuggestion: { scope: "personal", reason: "需要成员补充并确认适用规则。" }, confidence: 0.45, evidenceCitations: [citation], unknowns: ["纠正原因需要成员确认。"], fallback: true };
}

export function buildAgentRecapSystemPrompt(evidence: Record<string, unknown>, language: "zh" | "en" = "zh"): string {
  const paths = listEvidencePaths(evidence);
  const examples = paths.filter((path) => path !== "evidence").slice(0, 6);
  if (!examples.length) examples.push("evidence");
  const identifiers = correctedIdentifiers(evidence);
  const bindings = correctedSymbolBindings(evidence);
  return `${agentRecapSystemPrompt}\nThe rule must name the specific corrected function, method, or field from the diff. Candidate code identifiers extracted from the evidence: ${identifiers.join(", ") || "No identifier candidates available; use the concrete evidence without inventing names"}. Choose the object that actually changed and preserve its spelling. TypeScript resolves these expressions to their declaring types: ${JSON.stringify(bindings)}. When the corrected expression has a resolved declaration, the rule MUST include that declaration's qualified identifier (Type.method or Type.field), and may also include the literal call expression. Describe the corrected behavior for this object. Do not replace that concrete constraint with a general instruction to follow prompts. A regex check runs on final file content; do not match diff markers. Propose a check only if it fails on the Agent version and passes on the corrected version; otherwise use null. Do not invent exceptions unsupported by evidence; list uncertain boundaries in unknowns.\n\nOutput language: ${language === "zh" ? "Chinese" : "English"}.\nEvidence paths that exist in this request:\n${paths.map((path) => `- ${path}`).join("\n") || "- evidence"}\nExamples of valid citation syntax: ${examples.join(", ")}`;
}

export function listEvidencePaths(evidence: Record<string, unknown>): string[] {
  const paths: string[] = [];
  const visit = (value: unknown, path: string, depth: number) => {
    if (value === undefined || paths.length >= 200) return;
    paths.push(path);
    if (depth > 4 || value === null || typeof value !== "object") return;
    if (Array.isArray(value)) {
      value.slice(0, 8).forEach((item, index) => visit(item, `${path}[${index}]`, depth + 1));
      return;
    }
    for (const [key, item] of Object.entries(value)) {
      const next = `${path}.${key}`;
      visit(item, next, depth + 1);
    }
  };
  visit(evidence, "evidence", 0);
  return [...new Set(paths)].slice(0, 200);
}

function strings(value: unknown) { return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim()).slice(0, 24) : []; }
function isStringArray(value: unknown): value is string[] { return Array.isArray(value) && value.every((item) => typeof item === "string"); }
function normalizeApplies(value: unknown) { if (!value || typeof value !== "object" || Array.isArray(value)) return undefined; const input = value as Record<string, unknown>; if (![input.files, input.globs, input.taskKinds].every(isStringArray)) return undefined; const files = strings(input.files); const globs = strings(input.globs); const taskKinds = strings(input.taskKinds); return { files, globs, taskKinds }; }
function normalizeScope(value: unknown) { if (!value || typeof value !== "object" || Array.isArray(value)) return undefined; const input = value as Record<string, unknown>; if ((input.scope !== "team" && input.scope !== "personal") || typeof input.reason !== "string" || !input.reason.trim()) return undefined; return { scope: input.scope, reason: input.reason.trim() } as { scope: "team" | "personal"; reason: string }; }
function normalizeCheck(value: unknown) { if (!value || typeof value !== "object" || Array.isArray(value)) return undefined; const input = value as Record<string, unknown>; if ((input.kind !== "regex-absent" && input.kind !== "regex-present") || typeof input.pattern !== "string" || typeof input.fileGlob !== "string") return undefined; return { kind: input.kind, pattern: input.pattern, fileGlob: input.fileGlob } as { kind: "regex-absent" | "regex-present"; pattern: string; fileGlob: string }; }
function citationExists(path: string, evidence: unknown): boolean {
  const normalized = normalizeCitationPath(path);
  if (normalized === "evidence") return true;
  const parts = normalized.startsWith("evidence.") ? normalized.slice("evidence.".length).split(".") : normalized.split(".");
  let value: unknown = evidence;
  for (const part of parts) {
    if (!value || typeof value !== "object" || !Object.prototype.hasOwnProperty.call(value, part)) return false;
    value = (value as Record<string, unknown>)[part];
  }
  return value !== undefined;
}

function normalizeCitationPath(path: string): string {
  const value = String(path ?? "").trim().replace(/^`|`$/g, "");
  if (!value) return "";
  return value
    .replace(/\[\s*["']?(\d+|[^\]"']+)["']?\s*\]/g, ".$1")
    .replace(/\.{2,}/g, ".")
    .replace(/^\./, "");
}
