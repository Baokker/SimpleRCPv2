import * as ts from "typescript";
import type { SymbolInfo } from "./types.js";

export interface IndexedSymbol extends SymbolInfo {
  node: ts.Node;
  nameStart: number;
  nameEnd: number;
}

export function collectSymbols(source: ts.SourceFile, file: string): IndexedSymbol[] {
  const symbols: IndexedSymbol[] = [];
  const counts = new Map<string, number>();
  function visit(node: ts.Node, container?: string, exported = false) {
    const declaration = namedDeclaration(node);
    const isExported = exported || hasModifier(node, ts.SyntaxKind.ExportKeyword) || hasModifier(node, ts.SyntaxKind.DefaultKeyword)
      || (ts.isVariableDeclaration(node) && hasModifier(node.parent.parent, ts.SyntaxKind.ExportKeyword));
    let nextContainer = container;
    if (declaration) {
      const symbolPath = container ? `${container}.${declaration.name}` : declaration.name;
      const count = (counts.get(symbolPath) ?? 0) + 1;
      counts.set(symbolPath, count);
      const uniquePath = `${symbolPath}${count > 1 ? `@${count}` : ""}`;
      const start = node.getStart(source);
      const end = node.getEnd();
      symbols.push({ key: `${file}#${uniquePath}`, file, name: declaration.name, container, kind: declaration.kind,
        start, end, startLine: source.getLineAndCharacterOfPosition(start).line + 1,
        endLine: source.getLineAndCharacterOfPosition(Math.max(start, end - 1)).line + 1, exported: isExported,
        node, nameStart: declaration.nameNode?.getStart(source) ?? start, nameEnd: declaration.nameNode?.getEnd() ?? start });
      nextContainer = uniquePath;
    } else if (ts.isModuleDeclaration(node)) {
      nextContainer = container ? `${container}.${node.name.text}` : node.name.text;
    }
    ts.forEachChild(node, (child) => visit(child, nextContainer, isExported));
  }
  visit(source);
  return symbols;
}

export function symbolInfo({ node: _node, nameStart: _nameStart, nameEnd: _nameEnd, ...symbol }: IndexedSymbol): SymbolInfo { return symbol; }

export function innermostSymbols(symbols: SymbolInfo[], start: number, end: number) {
  const intersections = symbols.filter((symbol) => start === end ? symbol.start <= start && start < symbol.end : symbol.start < end && start < symbol.end);
  return intersections.filter((symbol) => !intersections.some((inner) => inner.key !== symbol.key && inner.start >= symbol.start && inner.end <= symbol.end));
}

export function parseSymbols(file: string, text: string) {
  return collectSymbols(ts.createSourceFile(`/${file}`, text, ts.ScriptTarget.ES2022, true, scriptKind(file)), file);
}

export function scriptKind(file: string) {
  if (/\.tsx$/i.test(file)) return ts.ScriptKind.TSX;
  if (/\.jsx$/i.test(file)) return ts.ScriptKind.JSX;
  return /\.js$/i.test(file) ? ts.ScriptKind.JS : ts.ScriptKind.TS;
}

function namedDeclaration(node: ts.Node): { name: string; nameNode?: ts.Node; kind: SymbolInfo["kind"] } | undefined {
  let kind: SymbolInfo["kind"];
  if (ts.isFunctionDeclaration(node)) kind = "function";
  else if (ts.isClassDeclaration(node)) kind = "class";
  else if (ts.isInterfaceDeclaration(node)) kind = "interface";
  else if (ts.isTypeAliasDeclaration(node)) kind = "type";
  else if (ts.isEnumDeclaration(node)) kind = "enum";
  else if (ts.isMethodDeclaration(node) || ts.isMethodSignature(node)) kind = "method";
  else if (ts.isPropertyDeclaration(node) || ts.isPropertySignature(node)) kind = "property";
  else if (ts.isGetAccessorDeclaration(node) || ts.isSetAccessorDeclaration(node)) kind = "accessor";
  else if (ts.isVariableDeclaration(node) && ts.isVariableDeclarationList(node.parent) && ts.isVariableStatement(node.parent.parent)
    && (ts.isSourceFile(node.parent.parent.parent) || ts.isModuleBlock(node.parent.parent.parent))) kind = "variable";
  else return undefined;
  const name = (node as ts.NamedDeclaration).name;
  if (name && (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name) || ts.isPrivateIdentifier(name))) return { name: name.text, nameNode: name, kind };
  if (hasModifier(node, ts.SyntaxKind.DefaultKeyword)) return { name: "default", kind };
  return undefined;
}

function hasModifier(node: ts.Node, kind: ts.SyntaxKind) { return ts.canHaveModifiers(node) && ts.getModifiers(node)?.some((modifier) => modifier.kind === kind) === true; }
