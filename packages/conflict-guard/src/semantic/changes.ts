import type { FileChange, TextEdit } from "../model/types.js";
import type { SemanticIndex } from "./types.js";
import { parseSymbols } from "./symbols.js";
import { isSemanticFile } from "./index.js";

export interface SymbolChange {
  key: string;
  file: string;
  name: string;
  status: "modified" | "added" | "deleted";
  before: string;
  after: string;
  startLine: number;
  endLine: number;
  lastTouchedAt: number;
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
  const current = index.symbolsInFile(change.file);
  const currentKeys = new Set(current.map((symbol) => symbol.key));
  const touched = new Map(change.ranges.flatMap((range) => index.symbolsInRange(change.file, range.start, range.end)).map((symbol) => [symbol.key, symbol]));
  const changes: SymbolChange[] = [];
  for (const symbol of touched.values()) {
    const previous = baselineByKey.get(symbol.key);
    const before = previous ? change.baseText.slice(previous.start, previous.end) : "";
    const after = text.slice(symbol.start, symbol.end);
    if (before === after) continue;
    changes.push({ key: symbol.key, file: change.file, name: symbol.name, status: previous ? "modified" : "added", before, after, startLine: symbol.startLine, endLine: symbol.endLine, lastTouchedAt: change.lastTouchedAt });
  }
  for (const symbol of baseline) if (!currentKeys.has(symbol.key) && change.deletedSymbolKeys?.includes(symbol.key)) {
    changes.push({ key: symbol.key, file: change.file, name: symbol.name, status: "deleted", before: change.baseText.slice(symbol.start, symbol.end), after: "", startLine: symbol.startLine, endLine: symbol.endLine, lastTouchedAt: change.lastTouchedAt });
  }
  return changes;
}
