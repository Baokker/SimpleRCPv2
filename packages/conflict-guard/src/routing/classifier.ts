import * as ts from "typescript";
import type { ActorRef } from "../model/types.js";
import type { RelationPath, SemanticIndex, SymbolInfo } from "../semantic/types.js";
import type { SymbolChange } from "../semantic/changes.js";

export type Zone = "white" | "black" | "grey";
export type Decision = "allow" | "warn" | "lock";

export interface PairSide {
  actor: ActorRef;
  symbol: SymbolChange;
}

export interface SemanticIndexReadonly extends Pick<SemanticIndex, "symbolsInFile" | "outgoing" | "incoming"> {
  readFile?(file: string): string;
  listFiles?(): string[];
  checkFourStates?(input: FourStateInput): FourStateResult;
}

export interface ZoneInput {
  left: PairSide;
  right: PairSide;
  path: RelationPath | null;
  nested: boolean;
  typeOnly: boolean;
  project: SemanticIndexReadonly;
}

export interface ZoneVerdict {
  zone: Zone;
  decision: Decision;
  ruleId: string;
  summary: string;
  evidence: Array<{ file: string; symbol?: string; detail: string }>;
  contractChanged: { left: boolean; right: boolean };
  typecheck?: { ran: boolean; skipped?: string; durationMs?: number; mergeOnlyDiagnostics?: string[] };
}

export interface FourStateInput {
  left: PairSide;
  right: PairSide;
  path: RelationPath | null;
}

export interface FourStateResult {
  ran: boolean;
  skipped?: string;
  durationMs?: number;
  mergeOnlyDiagnostics?: string[];
}

const observabilityReceivers = new Set(["audit", "console", "log", "logger", "metric", "metrics", "telemetry", "trace", "tracer"]);
const observabilityMethods = new Set(["debug", "error", "info", "log", "trace", "warn"]);

export function classify(input: ZoneInput): ZoneVerdict {
  const left = analyze(input.left.symbol);
  const right = analyze(input.right.symbol);
  const contractChanged = { left: left.contractChanged, right: right.contractChanged };
  const evidence = [{ file: input.left.symbol.file, symbol: input.left.symbol.key, detail: left.detail }, { file: input.right.symbol.file, symbol: input.right.symbol.key, detail: right.detail }];
  const result = (zone: Zone, decision: Decision, ruleId: string, summary: string, extra: Partial<ZoneVerdict> = {}): ZoneVerdict => ({ zone, decision, ruleId, summary, evidence, contractChanged, ...extra });

  if (input.typeOnly && !isTypeDeclaration(input.left.symbol.kind) && !isTypeDeclaration(input.right.symbol.kind)) {
    return result("white", "allow", "type-only-unchanged", "双方只通过类型关联，当前修改没有改变该类型声明。", { evidence });
  }
  if (input.path === null || input.nested || input.left.symbol.key === input.right.symbol.key) return result("black", "lock", "same-symbol-concurrent-write", input.nested ? "双方修改了同一声明的不同部分。" : "双方正在同时修改同一个声明。", { evidence });
  if (left.commentFormatOnly || right.commentFormatOnly) return result("white", "allow", "comment-format-only", "一侧只修改了注释或空白。", { evidence });
  if (left.observabilityOnly || right.observabilityOnly) return result("white", "allow", "observability-only", "一侧只增加了日志或可观测性语句。", { evidence });
  if (left.equivalentRefactor || right.equivalentRefactor) return result("white", "allow", "equivalent-refactor", "一侧是保持语义的局部重构。", { evidence });
  const removed = removedReference(input);
  if (removed) return result("black", "lock", removed.ruleId, removed.summary, { evidence: [...evidence, removed.evidence] });
  const signature = incompatibleCall(input);
  if (signature) return result("black", "lock", "call-signature-incompatible", "一侧调用无法满足另一侧修改后的函数签名。", { evidence: [...evidence, signature] });
  const interfaceConflict = incompatibleInterface(input);
  if (interfaceConflict) return result("black", "lock", "interface-required-member-incompatible", "一侧增加了接口必需成员，另一侧仍使用旧对象结构。", { evidence: [...evidence, interfaceConflict] });
  const typecheck = input.project.checkFourStates?.({ left: input.left, right: input.right, path: input.path });
  if (typecheck?.ran && (typecheck.mergeOnlyDiagnostics?.length ?? 0) > 0) return result("black", "lock", "merge-only-type-error", "合并双方修改后才出现类型错误。", { typecheck });
  if (left.parseError || right.parseError) return result("grey", "warn", "unparsable-side", "至少一侧修改暂时无法解析，语义关系需要进一步确认。", { evidence, typecheck });
  if (typecheck) return result("grey", "warn", "semantic-interaction-uncertain", "修改可能互相影响，需要进一步判断。", { typecheck });
  return result("grey", "warn", "semantic-interaction-uncertain", "修改可能互相影响，需要进一步判断。", { evidence });
}

export const classifyPairZone = classify;

interface Analysis {
  before?: ts.SourceFile;
  after?: ts.SourceFile;
  parseError: boolean;
  commentFormatOnly: boolean;
  observabilityOnly: boolean;
  equivalentRefactor: boolean;
  contractChanged: boolean;
  detail: string;
}

function analyze(change: SymbolChange): Analysis {
  const before = parse(change.file, change.before);
  const after = parse(change.file, change.after);
  if (!before || !after) return { before, after, parseError: true, commentFormatOnly: false, observabilityOnly: false, equivalentRefactor: false, contractChanged: true, detail: "修改文本无法解析" };
  const beforeText = normalize(change.before);
  const afterText = normalize(change.after);
  const beforeNoComments = normalize(stripComments(change.before));
  const afterNoComments = normalize(stripComments(change.after));
  const commentFormatOnly = beforeNoComments === afterNoComments && beforeText !== afterText;
  const observabilityOnly = isObservabilityOnly(before, after, change.before, change.after);
  const equivalentRefactor = !commentFormatOnly && !observabilityOnly && beforeText !== afterText && equivalentFingerprint(before) === equivalentFingerprint(after);
  const contractChanged = contractFingerprint(before) !== contractFingerprint(after) || change.status === "deleted" || (change.status === "added" && change.exported === true);
  return { before, after, parseError: false, commentFormatOnly, observabilityOnly, equivalentRefactor, contractChanged, detail: contractChanged ? "外部契约发生变化" : "外部契约未发生变化" };
}

function removedReference(input: ZoneInput): { ruleId: string; summary: string; evidence: { file: string; detail: string } } | undefined {
  const sides = [input.left, input.right];
  for (const producer of sides) {
    if (producer.symbol.status !== "deleted" && producer.symbol.after.length > 0) continue;
    const consumer = producer === input.left ? input.right : input.left;
    const name = producer.symbol.name;
    if (new RegExp(`\\b${escapeRegExp(name)}\\s*\\(`).test(consumer.symbol.after) || new RegExp(`\\b${escapeRegExp(name)}\\b`).test(consumer.symbol.after)) {
      return { ruleId: producer.symbol.exported ? "runtime-export-removed" : "referenced-symbol-removed", summary: producer.symbol.exported ? "一侧删除了运行时导出，另一侧仍在使用它。" : "一侧删除了另一侧仍然引用的符号。", evidence: { file: producer.symbol.file, detail: `删除 ${name}` } };
    }
  }
  for (const producer of sides) {
    const consumer = producer === input.left ? input.right : input.left;
    const beforeProperties = returnedProperties(producer.symbol.before);
    const afterProperties = returnedProperties(producer.symbol.after);
    const removed = [...beforeProperties].find((property) => !afterProperties.has(property) && new RegExp(`\\.${escapeRegExp(property)}\\b`).test(consumer.symbol.after));
    if (removed) return { ruleId: "consumed-return-property-removed", summary: `返回对象属性 ${removed} 被删除，但另一侧仍在读取它。`, evidence: { file: producer.symbol.file, detail: `删除属性 ${removed}` } };
  }
  return undefined;
}

function incompatibleCall(input: ZoneInput): { file: string; detail: string } | undefined {
  for (const producer of [input.left.symbol, input.right.symbol]) {
    const consumer = producer === input.left.symbol ? input.right.symbol : input.left.symbol;
    const before = callableSignature(producer.before);
    const after = callableSignature(producer.after);
    if (!before || !after || after.required <= before.required) continue;
    const call = new RegExp(`\\b${escapeRegExp(producer.name)}\\s*\\(([^)]*)\\)`).exec(consumer.after);
    if (call && call[1]!.split(",").map((part) => part.trim()).filter(Boolean).length < after.required) return { file: producer.file, detail: `${producer.name} 新增必填参数` };
  }
  return undefined;
}

function callableSignature(source: string): { required: number } | undefined {
  const match = /(?:function|method)?\s*[A-Za-z_$][\w$]*\s*\(([^)]*)\)/.exec(source);
  if (!match) return undefined;
  return { required: match[1]!.split(",").map((part) => part.trim()).filter((part) => part.length > 0 && !part.includes("?") && !part.includes("=")) .length };
}

function incompatibleInterface(input: ZoneInput): { file: string; detail: string } | undefined {
  for (const producer of [input.left.symbol, input.right.symbol]) {
    if (producer.kind !== "interface") continue;
    const consumer = producer === input.left.symbol ? input.right.symbol : input.left.symbol;
    const before = requiredMembers(producer.before);
    const after = requiredMembers(producer.after);
    const added = [...after].filter((member) => !before.has(member));
    if (added.some((member) => new RegExp(`\\b${escapeRegExp(member)}\\b`).test(consumer.after) === false && /:\s*[A-Z_a-z][\\w$]*/.test(consumer.after))) return { file: producer.file, detail: `接口新增必需成员 ${added.join(", ")}` };
  }
  return undefined;
}

function isObservabilityOnly(before: ts.SourceFile, after: ts.SourceFile, beforeText: string, afterText: string) {
  if (normalize(stripObservability(afterText)) !== normalize(stripObservability(beforeText))) return false;
  return beforeText !== afterText && [...afterText.matchAll(/\b([A-Za-z_$][\w$]*)\.([A-Za-z_$][\w$]*)\s*\(/g)].some((match) => observabilityReceivers.has(match[1]!) && observabilityMethods.has(match[2]!));
}

function fingerprint(source: ts.SourceFile) { return normalize(stripComments(source.getText())); }
function equivalentFingerprint(source: ts.SourceFile) {
  let text = fingerprint(source);
  text = text.replace(/const([A-Za-z_$][\w$]*)=([^;{}]+);return\1;?/g, "return$2;");
  text = text.replace(/let([A-Za-z_$][\w$]*)=([^;{}]+);return\1;?/g, "return$2;");
  return text;
}
function contractFingerprint(source: ts.SourceFile) {
  const values: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node) || ts.isMethodSignature(node)) values.push(`fn:${node.name?.getText(source)}:${node.type?.getText(source) ?? ""}:${node.parameters.map((parameter) => `${parameter.questionToken ? "?" : "!"}${parameter.type?.getText(source) ?? ""}`).join(",")}`);
    if ((ts.isClassDeclaration(node) || ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node)) && node.name) values.push(`${node.kind}:${node.name.text}`);
    ts.forEachChild(node, visit);
  };
  visit(source);
  return values.join("|");
}
function returnedProperties(source: string) { const set = new Set<string>(); for (const match of source.matchAll(/return\s*\{([^}]*)\}/g)) for (const property of match[1]!.matchAll(/\b([A-Za-z_$][\w$]*)\s*:/g)) set.add(property[1]!); return set; }
function requiredMembers(source: string) { const set = new Set<string>(); for (const match of source.matchAll(/\b([A-Za-z_$][\w$]*)\s*(?::|\()/g)) if (!match[0]!.includes("?")) set.add(match[1]!); return set; }
function parse(file: string, source: string) { if (!source) return undefined; const result = ts.createSourceFile(file, source, ts.ScriptTarget.ES2022, true, scriptKind(file)); const diagnostics = (result as ts.SourceFile & { parseDiagnostics?: readonly ts.Diagnostic[] }).parseDiagnostics ?? []; return diagnostics.length === 0 ? result : undefined; }
function isTypeDeclaration(kind: SymbolInfo["kind"]) { return kind === "interface" || kind === "type" || kind === "enum"; }
function scriptKind(file: string) { return /\.tsx$/i.test(file) ? ts.ScriptKind.TSX : /\.jsx$/i.test(file) ? ts.ScriptKind.JSX : /\.js$/i.test(file) ? ts.ScriptKind.JS : ts.ScriptKind.TS; }
function normalize(value: string) { return value.replace(/\s+/g, "").trim(); }
function stripComments(value: string) { return value.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1"); }
function stripObservability(value: string) { return value.replace(/\b(?:audit|console|log|logger|metric|metrics|telemetry|trace|tracer)\.(?:debug|error|info|log|trace|warn)\s*\([^;]*\);?/g, ""); }
function escapeRegExp(value: string) { return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
