import * as ts from "typescript";
import { diffArrays } from "diff";
import type { TextEdit, TrackedRange } from "../model/types.js";
import { scriptKind } from "./symbols.js";
import { mergeRanges } from "../tracking/rangeTransform.js";

export function syntaxFingerprint(source: ts.SourceFile): string {
  const visit = (node: ts.Node): string => {
    if (ts.isJSDoc(node) || node.kind === ts.SyntaxKind.EndOfFileToken) return "";
    const children = node.getChildren(source);
    return children.length ? `${node.kind}[${children.map(visit).filter(Boolean).join(",")}]` : `${node.kind}:${node.getText(source)}`;
  };
  return visit(source);
}

export function commentOnlyEdit(file: string, before: string, after: string) {
  const sources = [before, after].map((text) => ts.createSourceFile(file, text, ts.ScriptTarget.ES2022, true, scriptKind(file)));
  if (sources.some((source) => (source as ts.SourceFile & { parseDiagnostics: readonly ts.Diagnostic[] }).parseDiagnostics.length > 0)) return false;
  return syntaxFingerprint(sources[0]!) === syntaxFingerprint(sources[1]!);
}

export function semanticEditRanges(edit: Pick<TextEdit, "file" | "textBefore" | "textAfter" | "ops">): TrackedRange[] {
  if (commentOnlyEdit(edit.file, edit.textBefore, edit.textAfter)) return [];
  const sources = [edit.textBefore, edit.textAfter].map((text) => ts.createSourceFile(edit.file, text, ts.ScriptTarget.ES2022, true, scriptKind(edit.file)));
  if (sources.every((source) => (source as ts.SourceFile & { parseDiagnostics: readonly ts.Diagnostic[] }).parseDiagnostics.length === 0)) {
    const before = syntaxTokens(sources[0]!);
    const after = syntaxTokens(sources[1]!);
    const ranges: TrackedRange[] = [];
    let position = 0;
    for (const change of diffArrays(before, after, { comparator: (left, right) => left.fingerprint === right.fingerprint })) {
      if (change.added) ranges.push(...change.value.map(({ start, end }) => ({ start, end })));
      else if (change.removed) {
        const start = after[position]?.start ?? edit.textAfter.length;
        ranges.push({ start, end: start });
      }
      if (!change.removed) position += change.value.length;
    }
    return mergeRanges(ranges);
  }
  const replacements: TextEdit["ops"] = [];
  for (const op of edit.ops) {
    const previous = replacements.at(-1);
    if (previous && op.from === previous.from + previous.deleted.length) {
      previous.deleted += op.deleted;
      previous.inserted += op.inserted;
    } else replacements.push({ ...op });
  }
  let offset = 0;
  return replacements.flatMap((op) => {
    const start = op.from + offset;
    offset += op.inserted.length - op.deleted.length;
    const changed = edit.textBefore.slice(0, op.from) + op.inserted + edit.textBefore.slice(op.from + op.deleted.length);
    return commentOnlyEdit(edit.file, edit.textBefore, changed) ? [] : [{ start, end: start + op.inserted.length }];
  });
}

interface SyntaxToken extends TrackedRange { fingerprint: string }

function syntaxTokens(source: ts.SourceFile): SyntaxToken[] {
  const tokens: SyntaxToken[] = [];
  const visit = (node: ts.Node, ancestors: ts.SyntaxKind[]) => {
    if (ts.isJSDoc(node) || node.kind === ts.SyntaxKind.EndOfFileToken) return;
    const path = [...ancestors, node.kind];
    const children = node.getChildren(source);
    if (children.length) for (const child of children) visit(child, path);
    else if (node.end > node.getStart(source)) tokens.push({ start: node.getStart(source), end: node.end, fingerprint: `${path.join(":")}:${node.getText(source)}` });
  };
  visit(source, []);
  return tokens;
}
