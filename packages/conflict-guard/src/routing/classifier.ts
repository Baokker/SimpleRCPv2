import * as ts from "typescript";
import type { ActorRef } from "../model/types.js";
import type { RelationPath, SemanticIndex, SymbolInfo } from "../semantic/types.js";
import type { SymbolChange } from "../semantic/changes.js";
import { equivalentFingerprint, isObservabilityOnly, syntaxFingerprint } from "./fingerprints.js";
import { callableSignature, callsTo, contractFingerprint, hasTypeAnnotation, isExported, parseChangeSource, readsProperty, referencesName, requiredMembers, returnedProperties } from "./contracts.js";

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
  const removed = removedReference(input);
  const signature = incompatibleCall(input);
  const interfaceConflict = incompatibleInterface(input);
  const unaffected = !removed && !signature && !interfaceConflict;
  if (unaffected && (left.commentFormatOnly || right.commentFormatOnly)) return result("white", "allow", "comment-format-only", "一侧只修改了注释或空白。", { evidence });
  if (unaffected && (left.observabilityOnly || right.observabilityOnly)) return result("white", "allow", "observability-only", "一侧只增加了日志或可观测性语句。", { evidence });
  if (unaffected && (left.equivalentRefactor || right.equivalentRefactor)) return result("white", "allow", "equivalent-refactor", "一侧是保持语义的局部重构。", { evidence });
  if (removed) return result("black", "lock", removed.ruleId, removed.summary, { evidence: [...evidence, removed.evidence] });
  if (signature) return result("black", "lock", "call-signature-incompatible", "一侧调用无法满足另一侧修改后的函数签名。", { evidence: [...evidence, signature] });
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
  const before = parseChangeSource(change, change.before);
  const after = parseChangeSource(change, change.after);
  if (!before || !after) return { before, after, parseError: true, commentFormatOnly: false, observabilityOnly: false, equivalentRefactor: false, contractChanged: true, detail: "修改文本无法解析" };
  const changed = change.before !== change.after;
  const commentFormatOnly = changed && syntaxFingerprint(before) === syntaxFingerprint(after);
  const observabilityOnly = isObservabilityOnly(before, after);
  const equivalentRefactor = !commentFormatOnly && !observabilityOnly && changed && equivalentFingerprint(before) === equivalentFingerprint(after);
  const contractChanged = contractFingerprint(before) !== contractFingerprint(after) || change.status === "deleted" || (change.status === "added" && change.exported === true);
  return { before, after, parseError: false, commentFormatOnly, observabilityOnly, equivalentRefactor, contractChanged, detail: contractChanged ? "对外接口发生变化" : "对外接口未发生变化" };
}

function removedReference(input: ZoneInput): { ruleId: string; summary: string; evidence: { file: string; detail: string } } | undefined {
  const sides = [input.left, input.right];
  for (const producer of sides) {
    const consumer = producer === input.left ? input.right : input.left;
    const before = parseChangeSource(producer.symbol, producer.symbol.before);
    const after = parseChangeSource(producer.symbol, producer.symbol.after);
    const exportRemoved = producer.symbol.file !== consumer.symbol.file && isExported(before) && !isExported(after);
    if (producer.symbol.status !== "deleted" && producer.symbol.after.length > 0 && !exportRemoved) continue;
    const name = producer.symbol.name;
    if (referencesName(parseChangeSource(consumer.symbol, consumer.symbol.after), name)) {
      const runtimeExport = exportRemoved || producer.symbol.exported;
      return { ruleId: runtimeExport ? "runtime-export-removed" : "referenced-symbol-removed", summary: runtimeExport ? "一侧删除了运行时导出，另一侧仍在使用它。" : "一侧删除了另一侧仍然引用的符号。", evidence: { file: producer.symbol.file, detail: `删除 ${name}` } };
    }
  }
  for (const producer of sides) {
    const consumer = producer === input.left ? input.right : input.left;
    const beforeProperties = returnedProperties(parseChangeSource(producer.symbol, producer.symbol.before));
    const afterProperties = returnedProperties(parseChangeSource(producer.symbol, producer.symbol.after));
    const removed = [...beforeProperties].find((property) => !afterProperties.has(property) && readsProperty(parseChangeSource(consumer.symbol, consumer.symbol.after), property));
    if (removed) return { ruleId: "consumed-return-property-removed", summary: `返回对象属性 ${removed} 被删除，但另一侧仍在读取它。`, evidence: { file: producer.symbol.file, detail: `删除属性 ${removed}` } };
  }
  return undefined;
}

function incompatibleCall(input: ZoneInput): { file: string; detail: string } | undefined {
  for (const producer of [input.left.symbol, input.right.symbol]) {
    const consumer = producer === input.left.symbol ? input.right.symbol : input.left.symbol;
    const before = callableSignature(parseChangeSource(producer, producer.before), producer.name);
    const after = callableSignature(parseChangeSource(producer, producer.after), producer.name);
    if (!before || !after || (after.required <= before.required && after.maximum >= before.maximum)) continue;
    const calls = callsTo(parseChangeSource(consumer, consumer.after), producer.name);
    if (calls.some((call) => !call.arguments.some(ts.isSpreadElement) && (call.arguments.length < after.required || call.arguments.length > after.maximum))) return { file: producer.file, detail: `${producer.name} 的调用参数数量与签名不兼容` };
  }
  return undefined;
}

function incompatibleInterface(input: ZoneInput): { file: string; detail: string } | undefined {
  for (const producer of [input.left.symbol, input.right.symbol]) {
    if (producer.kind !== "interface") continue;
    const consumer = producer === input.left.symbol ? input.right.symbol : input.left.symbol;
    const before = requiredMembers(parseChangeSource(producer, producer.before));
    const after = requiredMembers(parseChangeSource(producer, producer.after));
    const added = [...after].filter((member) => !before.has(member));
    const consumerSource = parseChangeSource(consumer, consumer.after);
    if (added.some((member) => !referencesName(consumerSource, member)) && hasTypeAnnotation(consumerSource)) return { file: producer.file, detail: `接口新增必需成员 ${added.join(", ")}` };
  }
  return undefined;
}

function isTypeDeclaration(kind: SymbolInfo["kind"]) { return kind === "interface" || kind === "type" || kind === "enum"; }
