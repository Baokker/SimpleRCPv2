import * as ts from "typescript";
import type { TextEdit, TrackedRange } from "../model/types.js";
import { scriptKind } from "./symbols.js";

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
