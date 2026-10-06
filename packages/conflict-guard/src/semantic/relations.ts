// 标识符解析与关系分类移植自 GreyLock；Copyright 2026 TypeFox GmbH，MIT License。
import * as ts from "typescript";
import type { IndexedSymbol } from "./symbols.js";
import type { RelationEdge, RelationKind } from "./types.js";

export function collectTypeDependencies(source: ts.SourceFile, checker: ts.TypeChecker): Set<string> {
  const files = new Set<string>();
  const visited = new Set<ts.Type>();
  function collect(type: ts.Type) {
    if (visited.has(type)) return;
    visited.add(type);
    for (const symbol of [type.getSymbol(), type.aliasSymbol]) for (const declaration of symbol?.declarations ?? []) files.add(relativeFile(declaration.getSourceFile().fileName));
    if (type.isUnionOrIntersection()) for (const member of type.types) collect(member);
    for (const argument of type.aliasTypeArguments ?? []) collect(argument);
    if (type.flags & ts.TypeFlags.Object && (type as ts.ObjectType).objectFlags & ts.ObjectFlags.Reference) for (const argument of checker.getTypeArguments(type as ts.TypeReference)) collect(argument);
    if (type.flags & ts.TypeFlags.Object && (type as ts.ObjectType).objectFlags & ts.ObjectFlags.ClassOrInterface) for (const base of checker.getBaseTypes(type as ts.InterfaceType) ?? []) collect(base);
  }
  function visit(node: ts.Node) {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) return;
    if (ts.isExpression(node)) collect(checker.getTypeAtLocation(node));
    ts.forEachChild(node, visit);
  }
  visit(source);
  files.delete(relativeFile(source.fileName));
  return files;
}

export function collectRelations(source: ts.SourceFile, checker: ts.TypeChecker, symbolsByNode: Map<ts.Node, IndexedSymbol>): RelationEdge[] {
  const edges = new Map<string, RelationEdge>();
  const allSymbols = [...symbolsByNode.values()].filter((symbol) => symbol.file === relativeFile(source.fileName));
  const addEdge = (edge: RelationEdge) => edges.set(JSON.stringify([edge.from, edge.to, edge.kind]), edge);
  function visit(node: ts.Node) {
    if (ts.isIdentifier(node) && !isDeclarationName(node)) {
      const from = containingSymbol(node, symbolsByNode);
      const resolved = resolveSymbol(checker, checker.getSymbolAtLocation(node));
      if (ts.isPropertyAccessExpression(node.parent) && node.parent.name === node) {
        const namespace = resolveSymbol(checker, checker.getSymbolAtLocation(node.parent.expression));
        resolved.via.push(...namespace.via);
        if (namespace.symbol && resolved.symbol) resolved.via.push(...exportRoute(checker, namespace.symbol, resolved.symbol));
      }
      if (from && resolved.symbol) for (const declaration of resolved.symbol.declarations ?? []) {
        const to = symbolsByNode.get(declaration) ?? (ts.isEnumMember(declaration) ? symbolsByNode.get(declaration.parent) : undefined);
        if (!to || to.key === from.key) continue;
        const edge: RelationEdge = { from: from.key, to: to.key, kind: classifyRelation(node, declaration), via: [...new Set(resolved.via)].filter((file) => file !== from.file && file !== to.file) };
        addEdge(edge);
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  const byContainer = new Map<string, IndexedSymbol>();
  for (const symbol of allSymbols) byContainer.set(symbol.key, symbol);
  for (const member of allSymbols) {
    if (!member.container) continue;
    const container = byContainer.get(`${member.file}#${member.container}`);
    if (!container || container.kind !== "class") continue;
    addEdge({ from: container.key, to: member.key, kind: "contains", via: [] });
    if (!ts.isMethodDeclaration(member.node) && !ts.isGetAccessorDeclaration(member.node) && !ts.isSetAccessorDeclaration(member.node)) continue;
    const classNode = member.node.parent;
    if (!ts.isClassDeclaration(classNode) && !ts.isClassExpression(classNode)) continue;
    const classType = checker.getTypeAtLocation(classNode) as ts.InterfaceType;
    for (const baseType of checker.getBaseTypes(classType) ?? []) {
      const baseMember = checker.getPropertyOfType(baseType, member.name);
      for (const declaration of baseMember?.declarations ?? []) {
        const target = symbolsByNode.get(declaration);
        if (target) addEdge({ from: member.key, to: target.key, kind: "override", via: [] });
      }
    }
    for (const heritage of classNode.heritageClauses ?? []) {
      if (heritage.token !== ts.SyntaxKind.ImplementsKeyword) continue;
      for (const typeNode of heritage.types) {
        const interfaceType = checker.getTypeAtLocation(typeNode);
        const interfaceMember = checker.getPropertyOfType(interfaceType, member.name);
        for (const declaration of interfaceMember?.declarations ?? []) {
          const target = symbolsByNode.get(declaration);
          if (target) addEdge({ from: member.key, to: target.key, kind: "implements-member", via: [] });
        }
      }
    }
  }
  return [...edges.values()].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
}

export function collectUnresolvedReferences(source: ts.SourceFile, checker: ts.TypeChecker, symbolsByNode: Map<ts.Node, IndexedSymbol>) {
  const references = new Map<string, Array<{ name: string; via: string[] }>>();
  const visit = (node: ts.Node) => {
    if (ts.isIdentifier(node) && !isDeclarationName(node)) {
      const from = containingSymbol(node, symbolsByNode);
      const original = checker.getSymbolAtLocation(node);
      const resolved = resolveSymbol(checker, original);
      if (from && !resolved.symbol?.declarations?.length) {
        const imported = original?.declarations?.find(ts.isImportSpecifier);
        const name = imported ? (imported.propertyName ?? imported.name).text : node.text;
        if (ts.isPropertyAccessExpression(node.parent) && node.parent.name === node) {
          resolved.via.push(...resolveSymbol(checker, checker.getSymbolAtLocation(node.parent.expression)).via);
        }
        const entries = references.get(from.key) ?? [];
        entries.push({ name, via: [...new Set(resolved.via)].filter((file) => file !== from.file) });
        references.set(from.key, entries);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return references;
}

function containingSymbol(node: ts.Node, symbols: Map<ts.Node, IndexedSymbol>): IndexedSymbol | undefined {
  for (let current: ts.Node | undefined = node; current; current = current.parent) { const symbol = symbols.get(current); if (symbol) return symbol; }
  return undefined;
}

function resolveSymbol(checker: ts.TypeChecker, symbol: ts.Symbol | undefined) {
  const via: string[] = [];
  const visited = new Set<ts.Symbol>();
  let current = symbol;
  while (current && (current.flags & ts.SymbolFlags.Alias) && !visited.has(current)) {
    visited.add(current);
    for (const declaration of current.declarations ?? []) {
      via.push(relativeFile(declaration.getSourceFile().fileName));
      const statement = ancestor(declaration, (node): node is ts.ImportDeclaration | ts.ExportDeclaration => ts.isImportDeclaration(node) || ts.isExportDeclaration(node));
      if (statement?.moduleSpecifier) {
        const module = checker.getSymbolAtLocation(statement.moduleSpecifier);
        for (const moduleDeclaration of module?.declarations ?? []) via.push(relativeFile(moduleDeclaration.getSourceFile().fileName));
        const target = checker.getAliasedSymbol(current);
        if (module) via.push(...exportRoute(checker, module, target));
      }
    }
    current = checker.getImmediateAliasedSymbol(current);
  }
  return { symbol: current, via };
}

function exportRoute(checker: ts.TypeChecker, module: ts.Symbol, target: ts.Symbol, visited = new Set<ts.Symbol>()): string[] {
  if (visited.has(module)) return [];
  visited.add(module);
  const route: string[] = [];
  for (const declaration of module.declarations ?? []) {
    if (!ts.isSourceFile(declaration)) continue;
    for (const statement of declaration.statements) {
      if (!ts.isExportDeclaration(statement) || !statement.moduleSpecifier) continue;
      const child = checker.getSymbolAtLocation(statement.moduleSpecifier);
      if (!child || !checker.getExportsOfModule(child).some((symbol) => (symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol) === target)) continue;
      for (const childDeclaration of child.declarations ?? []) route.push(relativeFile(childDeclaration.getSourceFile().fileName));
      route.push(...exportRoute(checker, child, target, visited));
    }
  }
  return route;
}

function classifyRelation(node: ts.Identifier, declaration: ts.Declaration): RelationKind {
  const heritage = ancestor(node, ts.isHeritageClause);
  if (heritage) return heritage.token === ts.SyntaxKind.ImplementsKeyword ? "implementation" : "inheritance";
  for (let current: ts.Node | undefined = node.parent; current; current = current.parent) {
    if (ts.isTypeNode(current)) return "type-reference";
    if (ts.isExpression(current) || ts.isStatement(current)) break;
  }
  const parent = node.parent;
  if ((ts.isCallExpression(parent) && parent.expression === node) || (ts.isPropertyAccessExpression(parent) && parent.name === node && ts.isCallExpression(parent.parent) && parent.parent.expression === parent)) return "call";
  if (ts.isPropertyDeclaration(declaration) || ts.isPropertySignature(declaration) || ts.isPropertyAssignment(declaration)) return isWriteTarget(node) ? "state-write" : "state-read";
  if (ts.isVariableDeclaration(declaration)) {
    const initializer = declaration.initializer && unwrap(declaration.initializer);
    if (initializer && ts.isCallExpression(initializer) && (initializer.expression.getText() === "Symbol" || initializer.expression.getText() === "Symbol.for") && ts.isElementAccessExpression(parent) && parent.argumentExpression === node) return isWriteTarget(node) ? "state-write" : "state-read";
    if (initializer && ts.isNewExpression(initializer) && ts.isIdentifier(initializer.expression) && ["Map", "WeakMap", "Set", "WeakSet"].includes(initializer.expression.text) && ts.isPropertyAccessExpression(parent) && parent.expression === node) {
      if (parent.name.text === "size") return "state-read";
      if (ts.isCallExpression(parent.parent) && parent.parent.expression === parent) {
        if (["set", "add", "delete", "clear"].includes(parent.name.text)) return "state-write";
        if (["get", "has", "entries", "keys", "values", "forEach"].includes(parent.name.text)) return "state-read";
      }
    }
  }
  return "value-reference";
}

function isWriteTarget(node: ts.Identifier) {
  const access = ts.isPropertyAccessExpression(node.parent) && node.parent.name === node || ts.isElementAccessExpression(node.parent) ? node.parent : node;
  const parent = access.parent;
  return ts.isBinaryExpression(parent) && parent.left === access && parent.operatorToken.kind >= ts.SyntaxKind.FirstAssignment && parent.operatorToken.kind <= ts.SyntaxKind.LastAssignment
    || (ts.isPrefixUnaryExpression(parent) || ts.isPostfixUnaryExpression(parent)) && (parent.operator === ts.SyntaxKind.PlusPlusToken || parent.operator === ts.SyntaxKind.MinusMinusToken);
}

function unwrap(expression: ts.Expression): ts.Expression {
  while (ts.isParenthesizedExpression(expression) || ts.isAsExpression(expression) || ts.isSatisfiesExpression(expression) || ts.isNonNullExpression(expression)) expression = expression.expression;
  return expression;
}

function isDeclarationName(node: ts.Identifier) {
  const parent = node.parent;
  const named = ts.isFunctionDeclaration(parent) || ts.isFunctionExpression(parent) || ts.isClassDeclaration(parent) || ts.isClassExpression(parent)
    || ts.isInterfaceDeclaration(parent) || ts.isTypeAliasDeclaration(parent) || ts.isEnumDeclaration(parent) || ts.isEnumMember(parent)
    || ts.isMethodDeclaration(parent) || ts.isMethodSignature(parent) || ts.isPropertyDeclaration(parent) || ts.isPropertySignature(parent)
    || ts.isGetAccessorDeclaration(parent) || ts.isSetAccessorDeclaration(parent) || ts.isVariableDeclaration(parent)
    || ts.isParameter(parent) || ts.isBindingElement(parent) || ts.isTypeParameterDeclaration(parent) || ts.isModuleDeclaration(parent);
  return named && parent.name === node || ts.isImportSpecifier(parent) || ts.isExportSpecifier(parent)
    || ancestor(node, ts.isImportDeclaration) !== undefined || ancestor(node, ts.isExportDeclaration) !== undefined;
}

function ancestor<T extends ts.Node>(node: ts.Node, predicate: (node: ts.Node) => node is T): T | undefined {
  for (let current = node.parent; current; current = current.parent) if (predicate(current)) return current;
  return undefined;
}

function relativeFile(file: string) { return file.replace(/^\//, ""); }
