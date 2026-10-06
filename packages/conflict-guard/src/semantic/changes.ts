import type { FileChange, TextEdit } from "../model/types.js";
import type { SemanticIndex, SymbolInfo } from "./types.js";
import { innermostSymbols, parseSymbols } from "./symbols.js";
import { isSemanticFile } from "./index.js";

export interface SymbolChange {
  key: string;
  file: string;
  name: string;
  kind: SymbolInfo["kind"];
  container?: string;
  exported?: boolean;
  status: "modified" | "added" | "deleted";
  before: string;
  after: string;
  startLine: number;
  endLine: number;
  lastTouchedAt: number;
  beforeComments?: string;
}

export function deletedSymbolKeys(edit: TextEdit) {
  if (!isSemanticFile(edit.file)) return [];
  if (!edit.ops.some((op) => op.deleted.length > 0)) return [];
  return parseSymbols(edit.file, edit.textBefore).filter((symbol) => edit.ops.some((op) => op.deleted.length > 0 && op.from <= symbol.nameStart && op.from + op.deleted.length >= symbol.nameEnd)).map((symbol) => symbol.key);
}

export function mapSymbolChanges(change: FileChange, text: string, index: SemanticIndex): SymbolChange[] {
  if (!isSemanticFile(change.file)) return [];
  const baseline = parseSymbols(change.file, change.baseText);
  const baselineByKey = new Map(baseline.map((symbol) => [symbol.key, symbol]));
  const current = change.proposalText === undefined ? index.symbolsInFile(change.file) : parseSymbols(change.file, text);
  const currentKeys = new Set(current.map((symbol) => symbol.key));
  const touched = new Map(change.ranges.flatMap((range) => innermostSymbols(current, range.start, range.end)).map((symbol) => [symbol.key, symbol]));
  const changes: SymbolChange[] = [];
  for (const symbol of touched.values()) {
    const previous = baselineByKey.get(symbol.key);
    const before = previous ? change.baseText.slice(previous.start, previous.end) : "";
    const after = text.slice(symbol.start, symbol.end);
    if (before === after) continue;
    changes.push({ key: symbol.key, file: change.file, name: symbol.name, kind: symbol.kind, container: symbol.container, exported: symbol.exported, status: previous ? "modified" : "added", before, after, startLine: symbol.startLine, endLine: symbol.endLine, lastTouchedAt: change.lastTouchedAt, beforeComments: previous ? change.baseText.slice(previous.node.getFullStart(), previous.start).trim() : undefined });
  }
  const touchedBase = baseline.filter((symbol) => change.ranges.some((range) => range.start <= symbol.end && symbol.start <= range.end));
  const addedTouched = [...touched.values()].filter((symbol) => !baselineByKey.has(symbol.key));
  const renamedBaselineKeys = new Set(addedTouched.flatMap((added) => {
    const currentSiblings = current.filter((candidate) => candidate.container === added.container && candidate.kind === added.kind);
    const baselineSiblings = baseline.filter((candidate) => candidate.container === added.container && candidate.kind === added.kind);
    const slot = currentSiblings.findIndex((candidate) => candidate.key === added.key);
    const candidate = slot >= 0 ? baselineSiblings[slot] : undefined;
    return candidate && !currentKeys.has(candidate.key) ? [candidate.key] : [];
  }));
  const deletedCandidates = [...new Map([...touchedBase, ...baseline.filter((symbol) => renamedBaselineKeys.has(symbol.key) || change.deletedSymbolKeys?.includes(symbol.key))].map((symbol) => [symbol.key, symbol])).values()];
  for (const symbol of deletedCandidates) if (!currentKeys.has(symbol.key) && (change.deletedSymbolKeys?.includes(symbol.key) || renamedBaselineKeys.has(symbol.key) || addedTouched.some((added) => added.start <= symbol.end && symbol.start <= added.end))) {
    changes.push({ key: symbol.key, file: change.file, name: symbol.name, kind: symbol.kind, container: symbol.container, exported: symbol.exported, status: "deleted", before: change.baseText.slice(symbol.start, symbol.end), after: "", startLine: symbol.startLine, endLine: symbol.endLine, lastTouchedAt: change.lastTouchedAt, beforeComments: change.baseText.slice(symbol.node.getFullStart(), symbol.start).trim() });
  }
  return changes;
}
