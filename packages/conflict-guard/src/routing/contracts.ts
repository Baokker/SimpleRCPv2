import * as ts from "typescript";
import type { SymbolChange } from "../semantic/changes.js";

export function parseChangeSource(change: SymbolChange, text: string): ts.SourceFile | undefined {
  if (!text) return undefined;
  const member = change.kind === "method" || change.kind === "property" || change.kind === "accessor";
  const source = member ? `class Declaration { ${text} }` : text;
  const kind = /\.tsx$/i.test(change.file) ? ts.ScriptKind.TSX : /\.jsx$/i.test(change.file) ? ts.ScriptKind.JSX : /\.js$/i.test(change.file) ? ts.ScriptKind.JS : ts.ScriptKind.TS;
  const parsed = ts.createSourceFile(change.file, source, ts.ScriptTarget.ES2022, true, kind);
  return ((parsed as ts.SourceFile & { parseDiagnostics?: readonly ts.Diagnostic[] }).parseDiagnostics ?? []).length ? undefined : parsed;
}

function visit(source: ts.Node, callback: (node: ts.Node) => void) {
  callback(source);
  ts.forEachChild(source, (child) => visit(child, callback));
}

function nameOf(node: ts.Node): string | undefined {
  if (ts.isIdentifier(node) || ts.isStringLiteralLike(node) || ts.isNumericLiteral(node)) return node.text;
  return undefined;
}

export function referencesName(source: ts.SourceFile | undefined, name: string) {
  let found = false;
  if (source) visit(source, (node) => {
    if (!ts.isIdentifier(node) || node.text !== name) return;
    const parent = node.parent;
    if ((ts.isFunctionDeclaration(parent) || ts.isMethodDeclaration(parent) || ts.isVariableDeclaration(parent) || ts.isParameter(parent) || ts.isPropertyAssignment(parent)) && parent.name === node) return;
    found = true;
  });
  return found;
}

export function isExported(source: ts.SourceFile | undefined) {
  return source?.statements.some((statement) => ts.canHaveModifiers(statement) && ts.getModifiers(statement)?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)) ?? false;
}

export function callableSignature(source: ts.SourceFile | undefined, name: string) {
  let signature: { required: number; maximum: number } | undefined;
  if (source) visit(source, (node) => {
    const parameters = (ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node)) && node.name && nameOf(node.name) === name ? node.parameters
      : ts.isVariableDeclaration(node) && nameOf(node.name) === name && node.initializer && (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer)) ? node.initializer.parameters : undefined;
    if (parameters) signature = {
      required: parameters.filter((parameter) => !parameter.questionToken && !parameter.initializer && !parameter.dotDotDotToken).length,
      maximum: parameters.some((parameter) => parameter.dotDotDotToken) ? Infinity : parameters.length
    };
  });
  return signature;
}

export function callsTo(source: ts.SourceFile | undefined, name: string) {
  const calls: ts.CallExpression[] = [];
  if (source) visit(source, (node) => {
    if (!ts.isCallExpression(node)) return;
    const expression = node.expression;
    if ((ts.isIdentifier(expression) && expression.text === name) || (ts.isPropertyAccessExpression(expression) && expression.name.text === name)) calls.push(node);
  });
  return calls;
}

export function returnedProperties(source: ts.SourceFile | undefined) {
  const properties = new Set<string>();
  if (source) visit(source, (node) => {
    const expression = ts.isReturnStatement(node) ? node.expression : ts.isArrowFunction(node) && !ts.isBlock(node.body) ? node.body : undefined;
    const value = expression && ts.isParenthesizedExpression(expression) ? expression.expression : expression;
    if (value && ts.isObjectLiteralExpression(value)) for (const property of value.properties) {
      if (!ts.isSpreadAssignment(property)) { const name = nameOf(property.name); if (name) properties.add(name); }
    }
  });
  return properties;
}

export function readsProperty(source: ts.SourceFile | undefined, name: string) {
  let found = false;
  if (source) visit(source, (node) => {
    if (ts.isPropertyAccessExpression(node) && node.name.text === name) found = true;
    if (ts.isElementAccessExpression(node) && nameOf(node.argumentExpression) === name) found = true;
  });
  return found;
}

export function requiredMembers(source: ts.SourceFile | undefined) {
  const members = new Set<string>();
  if (source) visit(source, (node) => {
    if ((ts.isPropertySignature(node) || ts.isMethodSignature(node)) && !node.questionToken) { const name = nameOf(node.name); if (name) members.add(name); }
  });
  return members;
}

export function hasTypeAnnotation(source: ts.SourceFile | undefined) {
  let found = false;
  if (source) visit(source, (node) => { if ((ts.isVariableDeclaration(node) || ts.isParameter(node)) && node.type) found = true; });
  return found;
}

export function contractFingerprint(source: ts.SourceFile) {
  const values = [`export:${isExported(source)}`, `properties:${[...returnedProperties(source)].sort().join(",")}`];
  visit(source, (node) => {
    if (ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node) || ts.isMethodSignature(node) || ts.isArrowFunction(node) || ts.isFunctionExpression(node) || ts.isGetAccessorDeclaration(node) || ts.isSetAccessorDeclaration(node)) {
      values.push(`fn:${node.type?.getText(source) ?? ""}:${node.parameters.map((parameter) => `${parameter.dotDotDotToken ? "..." : ""}${parameter.questionToken || parameter.initializer ? "?" : "!"}${parameter.type?.getText(source) ?? ""}`).join(",")}`);
    }
    if (ts.isPropertySignature(node)) values.push(`member:${node.name.getText(source)}:${node.questionToken ? "?" : "!"}:${node.type?.getText(source) ?? ""}`);
    if (ts.isReturnStatement(node) && node.expression) {
      const expression = node.expression;
      if (ts.isStringLiteralLike(expression)) values.push("return:string");
      if (ts.isNumericLiteral(expression)) values.push("return:number");
      if (expression.kind === ts.SyntaxKind.TrueKeyword || expression.kind === ts.SyntaxKind.FalseKeyword) values.push("return:boolean");
    }
  });
  return [...new Set(values)].sort().join("|");
}
