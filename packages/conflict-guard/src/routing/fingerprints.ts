// AST 指纹方法参考 GreyLock，Copyright 2026 TypeFox GmbH，MIT License。
import * as ts from "typescript";

const receivers = new Set(["audit", "console", "log", "logger", "metric", "metrics", "telemetry", "trace", "tracer"]);
const methods = new Set(["debug", "error", "info", "log", "trace", "warn"]);
const printer = ts.createPrinter({ removeComments: true });

export function syntaxFingerprint(source: ts.SourceFile) {
  return printer.printFile(source);
}

export function equivalentFingerprint(source: ts.SourceFile) {
  return semanticNode(source, source, new Map());
}

export function isObservabilityOnly(before: ts.SourceFile, after: ts.SourceFile) {
  const left = observabilityFingerprint(before);
  const right = observabilityFingerprint(after);
  return left.structure === right.structure && JSON.stringify(left.observability) !== JSON.stringify(right.observability);
}

function observabilityFingerprint(source: ts.SourceFile) {
  const observability: string[] = [];
  const visit = (node: ts.Node): string => {
    if (ts.isExpressionStatement(node) && safeObservabilityCall(node.expression)) {
      observability.push(printer.printNode(ts.EmitHint.Unspecified, node, source));
      return "";
    }
    if (ts.isJSDoc(node)) return "";
    const children = node.getChildren(source).map(visit).filter(Boolean);
    return children.length > 0 ? `${node.kind}[${children.join(",")}]` : `${node.kind}:${node.getText(source)}`;
  };
  return { structure: visit(source), observability };
}

function safeObservabilityCall(node: ts.Expression) {
  if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression)) return false;
  let receiver = node.expression.expression;
  while (ts.isPropertyAccessExpression(receiver) || ts.isElementAccessExpression(receiver)) receiver = receiver.expression;
  return ts.isIdentifier(receiver) && receivers.has(receiver.text) && methods.has(node.expression.name.text) && node.arguments.every(safeArgument);
}

function safeArgument(node: ts.Expression): boolean {
  if (ts.isIdentifier(node) || ts.isStringLiteralLike(node) || ts.isNumericLiteral(node) || [ts.SyntaxKind.TrueKeyword, ts.SyntaxKind.FalseKeyword, ts.SyntaxKind.NullKeyword].includes(node.kind)) return true;
  if (ts.isPropertyAccessExpression(node)) return safeArgument(node.expression);
  if (ts.isElementAccessExpression(node)) return safeArgument(node.expression) && (!node.argumentExpression || safeArgument(node.argumentExpression));
  if (ts.isParenthesizedExpression(node)) return safeArgument(node.expression);
  if (ts.isArrayLiteralExpression(node)) return node.elements.every((element) => ts.isExpression(element) && safeArgument(element));
  if (ts.isObjectLiteralExpression(node)) return node.properties.every((property) => ts.isShorthandPropertyAssignment(property) || ts.isPropertyAssignment(property) && safeArgument(property.initializer));
  if (ts.isTemplateExpression(node)) return node.templateSpans.every((span) => safeArgument(span.expression));
  return false;
}

function semanticNode(node: ts.Node, source: ts.SourceFile, aliases: ReadonlyMap<string, string>): string {
  if (ts.isJSDoc(node)) return "";
  if (ts.isSourceFile(node)) return `source[${node.statements.map((statement) => semanticNode(statement, source, aliases)).join(",")}]`;
  if (ts.isBlock(node)) return semanticStatements(node.statements, source, aliases);
  if (ts.isIdentifier(node)) return aliases.get(node.text) ?? `${node.kind}:${node.text}`;
  if (ts.isPropertyAccessExpression(node)) return `${node.kind}[${semanticNode(node.expression, source, aliases)},${node.name.text}]`;
  const children = node.getChildren(source);
  return children.length === 0 ? `${node.kind}:${node.getText(source)}` : `${node.kind}[${children.map((child) => semanticNode(child, source, aliases)).filter(Boolean).join(",")}]`;
}

function semanticStatements(statements: ts.NodeArray<ts.Statement>, source: ts.SourceFile, parentAliases: ReadonlyMap<string, string>) {
  const aliases = new Map(parentAliases);
  const fingerprints: string[] = [];
  for (const [index, statement] of statements.entries()) {
    const next = statements[index + 1];
    const declaration = ts.isVariableStatement(statement) && statement.declarationList.flags === ts.NodeFlags.Const && statement.declarationList.declarations.length === 1 ? statement.declarationList.declarations[0] : undefined;
    if (declaration && ts.isIdentifier(declaration.name) && declaration.initializer && !declaration.type
      && next && ts.isReturnStatement(next) && next.expression && ts.isIdentifier(next.expression) && next.expression.text === declaration.name.text
      && statements.slice(index + 2).every((later) => referenceCount(later, declaration.name.getText(source)) === 0)) {
      aliases.set(declaration.name.text, semanticNode(declaration.initializer, source, aliases));
    } else fingerprints.push(semanticNode(statement, source, aliases));
  }
  return `statements[${fingerprints.join(",")}]`;
}

function referenceCount(node: ts.Node, name: string) {
  let count = 0;
  const visit = (current: ts.Node) => {
    if (ts.isIdentifier(current) && current.text === name && !(ts.isPropertyAccessExpression(current.parent) && current.parent.name === current) && !(ts.isPropertyAssignment(current.parent) && current.parent.name === current) && !(ts.isMethodDeclaration(current.parent) && current.parent.name === current)) count += 1;
    ts.forEachChild(current, visit);
  };
  visit(node);
  return count;
}
