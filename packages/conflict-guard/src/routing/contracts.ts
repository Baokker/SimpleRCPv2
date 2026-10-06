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
  return returnedPropertyShape(source).properties;
}

export function returnedPropertyShape(source: ts.SourceFile | undefined) {
  const properties = new Set<string>();
  let known = true;
  if (!source) return { properties, known: false };
  for (const node of source.statements.flatMap((statement) => declarationNodes(statement))) {
    const body = (node as ts.FunctionLikeDeclaration).body;
    if ((ts.isVariableDeclaration(node) || ts.isPropertyDeclaration(node)) && node.initializer && (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))) {
      if (ts.isBlock(node.initializer.body)) known = collectDirectReturnProperties(node.initializer.body, properties) && known;
      else known = addObjectProperties(node.initializer.body, properties) && known;
    }
    if (body && ts.isBlock(body)) known = collectDirectReturnProperties(body, properties) && known;
  }
  return { properties, known };
}

function collectDirectReturnProperties(body: ts.Block, properties: Set<string>) {
  let known = true;
  const variables = new Map<string, ts.Expression>();
  for (const statement of body.statements) if (ts.isVariableStatement(statement)) {
    for (const declaration of statement.declarationList.declarations) if (ts.isIdentifier(declaration.name) && declaration.initializer) variables.set(declaration.name.text, declaration.initializer);
  }
  const visitStatement = (statement: ts.Statement) => {
    if (ts.isReturnStatement(statement) && statement.expression) {
      const expression = ts.isIdentifier(statement.expression) ? variables.get(statement.expression.text) ?? statement.expression : statement.expression;
      known = addObjectProperties(expression, properties) && known;
    }
    if (ts.isBlock(statement)) for (const child of statement.statements) visitStatement(child);
    else if (ts.isIfStatement(statement)) { visitStatement(statement.thenStatement); if (statement.elseStatement) visitStatement(statement.elseStatement); }
    else if (ts.isTryStatement(statement)) { visitStatement(statement.tryBlock); if (statement.catchClause) visitStatement(statement.catchClause.block); if (statement.finallyBlock) visitStatement(statement.finallyBlock); }
  };
  for (const statement of body.statements) visitStatement(statement);
  return known;
}

function addObjectProperties(expression: ts.Expression, properties: Set<string>) {
  const value = ts.isParenthesizedExpression(expression) ? expression.expression : expression;
  if (!ts.isObjectLiteralExpression(value)) return ts.isStringLiteralLike(value) || ts.isNumericLiteral(value) || [ts.SyntaxKind.TrueKeyword, ts.SyntaxKind.FalseKeyword, ts.SyntaxKind.NullKeyword].includes(value.kind);
  let known = true;
  for (const property of value.properties) {
    if (!ts.isSpreadAssignment(property)) { const name = nameOf(property.name); if (name) properties.add(name); }
    else known = false;
  }
  return known;
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
  const values = [`export:${isExported(source)}`];
  const declarations = source.statements.flatMap((statement) => declarationNodes(statement));
  for (const node of declarations) {
    if (ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node) || ts.isMethodSignature(node) || ts.isGetAccessorDeclaration(node) || ts.isSetAccessorDeclaration(node)) {
      values.push(`fn:${node.type?.getText(source) ?? ""}:${parametersFingerprint(node.parameters, source)}`);
      values.push(...directReturnFingerprint(node, source));
    } else if (ts.isVariableDeclaration(node) || ts.isPropertyDeclaration(node)) {
      if (ts.isPropertyDeclaration(node)) values.push(`member:${node.name.getText(source)}:${node.questionToken ? "?" : "!"}:${node.type?.getText(source) ?? ""}`);
      const initializer = node.initializer;
      if (initializer && (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer))) {
        values.push(`fn:${initializer.type?.getText(source) ?? ""}:${parametersFingerprint(initializer.parameters, source)}`);
        values.push(...directReturnFingerprint(initializer, source));
      } else if (ts.isVariableDeclaration(node) && node.type) values.push(`variable:${node.type.getText(source)}`);
    } else if (ts.isPropertySignature(node)) {
      values.push(`member:${node.name.getText(source)}:${node.questionToken ? "?" : "!"}:${node.type?.getText(source) ?? ""}`);
    }
  }
  values.push(`properties:${[...returnedProperties(source)].sort().join(",")}`);
  return [...new Set(values)].sort().join("|");
}

function declarationNodes(node: ts.Node): ts.Node[] {
  if (ts.isClassDeclaration(node) || ts.isInterfaceDeclaration(node)) return [node, ...node.members.flatMap((member) => declarationNodes(member))];
  if (ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node) || ts.isMethodSignature(node) || ts.isGetAccessorDeclaration(node) || ts.isSetAccessorDeclaration(node) || ts.isPropertyDeclaration(node) || ts.isPropertySignature(node)) return [node];
  if (ts.isVariableStatement(node)) return node.declarationList.declarations.flatMap((declaration) => [declaration]);
  return [];
}

function parametersFingerprint(parameters: ts.NodeArray<ts.ParameterDeclaration>, source: ts.SourceFile) {
  return parameters.map((parameter) => `${parameter.dotDotDotToken ? "..." : ""}${parameter.questionToken || parameter.initializer ? "?" : "!"}${parameter.type?.getText(source) ?? ""}`).join(",");
}

function directReturnFingerprint(node: ts.Node, source: ts.SourceFile) {
  const values: string[] = [];
  const body = (node as ts.FunctionLikeDeclaration).body;
  if (!body || !ts.isBlock(body)) return values;
  const visitStatement = (statement: ts.Statement) => {
    if (ts.isReturnStatement(statement) && statement.expression) {
      const expression = statement.expression;
      if (ts.isStringLiteralLike(expression)) values.push("return:string");
      if (ts.isNumericLiteral(expression)) values.push("return:number");
      if (expression.kind === ts.SyntaxKind.TrueKeyword || expression.kind === ts.SyntaxKind.FalseKeyword) values.push("return:boolean");
      if (ts.isObjectLiteralExpression(expression)) values.push(`return:object:${expression.properties.map((property) => property.name?.getText(source) ?? "").sort().join(",")}`);
    }
    if (ts.isBlock(statement)) for (const child of statement.statements) visitStatement(child);
    else if (ts.isIfStatement(statement)) { visitStatement(statement.thenStatement); if (statement.elseStatement) visitStatement(statement.elseStatement); }
    else if (ts.isTryStatement(statement)) { visitStatement(statement.tryBlock); if (statement.catchClause) visitStatement(statement.catchClause.block); if (statement.finallyBlock) visitStatement(statement.finallyBlock); }
  };
  for (const statement of body.statements) visitStatement(statement);
  return values;
}
