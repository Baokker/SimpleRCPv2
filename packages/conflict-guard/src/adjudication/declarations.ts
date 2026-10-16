import * as ts from "typescript";
import type { SymbolChange } from "../semantic/changes.js";
import { parseChangeSource } from "../routing/contracts.js";
import { scriptKind } from "../semantic/symbols.js";

export function completeDeclarationText(change: SymbolChange, state: "before" | "after") {
  const text = change[state];
  if (!text || change.kind !== "variable") return text;
  const parsed = ts.createSourceFile(change.file, text, ts.ScriptTarget.ES2022, true, scriptKind(change.file));
  if (parsed.statements.some((statement) => ts.isVariableStatement(statement) && statement.declarationList.declarations.some((node) => node.name.getText(parsed) === change.name))) return text;
  const prefix = state === "before" ? change.beforeDeclarationPrefix : change.declarationPrefix;
  if (prefix === undefined) throw new Error(`变量声明缺少前缀：${change.key}`);
  return prefix + text;
}

export function parseDeclaration(change: SymbolChange, state: "before" | "after") {
  return parseChangeSource(change, completeDeclarationText(change, state));
}
