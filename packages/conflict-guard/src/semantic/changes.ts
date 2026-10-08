import type { FileChange, TextEdit, TrackedRange } from "../model/types.js";
import type { SemanticIndex, SymbolInfo } from "./types.js";
import { innermostSymbols, parseSymbols } from "./symbols.js";
import { isSemanticFile } from "./index.js";
import { commentOnlyEdit } from "./trivia.js";
import { textDiffOps } from "../tracking/textDiff.js";

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
  editedLineRanges?: Array<{ start: number; end: number }>;
}

export function deletedSymbolKeys(edit: TextEdit) {
  if (!isSemanticFile(edit.file)) return [];
  if (!edit.ops.some((op) => op.deleted.length > 0)) return [];
  return parseSymbols(edit.file, edit.textBefore).filter((symbol) => edit.ops.some((op) => op.deleted.length > 0 && op.from <= symbol.nameStart && op.from + op.deleted.length >= symbol.nameEnd)).map((symbol) => symbol.key);
}

export function mapSymbolChanges(change: FileChange, text: string, index: SemanticIndex): SymbolChange[] {
  if (!isSemanticFile(change.file)) return [];
  if (commentOnlyEdit(change.file, change.baseText, text)) return [];
  const ranges = change.semanticRanges ?? change.ranges;
  const baseline = parseSymbols(change.file, change.baseText);
  const baselineByKey = new Map(baseline.map((symbol) => [symbol.key, symbol]));
  const current = change.proposalText === undefined ? index.symbolsInFile(change.file) : parseSymbols(change.file, text);
  const currentKeys = new Set(current.map((symbol) => symbol.key));
  const touched = new Map(ranges.flatMap((range) => innermostSymbols(current, range.start, range.end)).map((symbol) => [symbol.key, symbol]));
  const changes: SymbolChange[] = [];
  for (const symbol of touched.values()) {
    const previous = baselineByKey.get(symbol.key);
    const after = text.slice(symbol.start, symbol.end);
    const before = previous ? reconstructOwnedBefore(change.baseText.slice(previous.start, previous.end), after, symbol.start, change.ranges) : "";
    if (before === after || previous && commentOnlyEdit(change.file, replaceSymbol(change.baseText, previous, before), replaceSymbol(change.baseText, previous, after))) continue;
    const editedLineRanges = ranges.filter((range) => innermostSymbols([symbol], range.start, range.end).length > 0).map((range) => ({ start: lineAt(text, Math.max(symbol.start, range.start)), end: lineAt(text, Math.max(symbol.start, Math.min(symbol.end - 1, range.end > range.start ? range.end - 1 : range.end))) }));
    changes.push({ key: symbol.key, file: change.file, name: symbol.name, kind: symbol.kind, container: symbol.container, exported: symbol.exported, status: previous ? "modified" : "added", before, after, startLine: symbol.startLine, endLine: symbol.endLine, editedLineRanges, lastTouchedAt: change.lastTouchedAt, beforeComments: previous ? change.baseText.slice(previous.node.getFullStart(), previous.start).trim() : undefined });
  }
  const touchedBase = baseline.filter((symbol) => ranges.some((range) => range.start < symbol.end && symbol.start <= range.end));
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

function replaceSymbol(text: string, symbol: SymbolInfo, after: string) { return text.slice(0, symbol.start) + after + text.slice(symbol.end); }
function lineAt(text: string, position: number) { return text.slice(0, position).split("\n").length; }

export function reconstructOwnedBefore(baseline: string, current: string, start: number, ranges: TrackedRange[]) {
  const replacements: TextEdit["ops"] = [];
  for (const op of textDiffOps(baseline, current)) {
    const previous = replacements.at(-1);
    if (previous && op.from === previous.from + previous.deleted.length) {
      previous.deleted += op.deleted;
      previous.inserted += op.inserted;
    } else replacements.push({ ...op });
  }
  let offset = 0;
  const owned = replacements.flatMap((op) => {
    const from = op.from + offset;
    offset += op.inserted.length - op.deleted.length;
    const to = from + op.inserted.length;
    return ranges.some((range) => op.inserted.length === 0 ? range.start <= start + from && start + from <= range.end : range.start === range.end ? start + from <= range.start && range.start <= start + to : range.start < start + to && start + from < range.end) ? [{ from, to, deleted: op.deleted }] : [];
  });
  return owned.reverse().reduce((text, op) => text.slice(0, op.from) + op.deleted + text.slice(op.to), current);
}
