import * as ts from "typescript";
import type { ZoneInput, ZoneVerdict } from "../routing/classifier.js";
import type { AdjudicationConfig, AdjudicationInput, FourStateEvidence, SymbolEvidence } from "./types.js";
import { isExported, parseChangeSource } from "../routing/contracts.js";
import type { SymbolChange } from "../semantic/changes.js";
import { declarationSyntax } from "./syntax.js";

export interface InvariantContext { callers: string[]; tests: string[]; comments: string[]; usage: string[] }
const fileFor = (key: string) => key.slice(0, key.indexOf("#"));
function source(file: string, text: string) { return ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, /\.[cm]?jsx?$/.test(file) ? ts.ScriptKind.JS : ts.ScriptKind.TS); }

function declarationSignature(change: SymbolChange, text: string) {
  const parsed = parseChangeSource(change, text);
  if (!parsed) return "";
  let result = "";
  const visit = (node: ts.Node) => {
    if (result) return;
    if ((ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node) || ts.isMethodSignature(node) || ts.isGetAccessorDeclaration(node) || ts.isSetAccessorDeclaration(node)) && (node.name?.getText(parsed) === change.name || ts.isFunctionDeclaration(node) && !node.name && change.name === "default")) {
      const body = "body" in node ? node.body : undefined;
      const text = node.getText(parsed);
      result = text.slice(0, body ? body.getStart(parsed) - node.getStart(parsed) : text.length).trim();
      return;
    }
    if (ts.isVariableDeclaration(node) && node.name.getText(parsed) === change.name && node.initializer && (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))) {
      const initializer = node.initializer;
      result = initializer.getText(parsed).slice(0, initializer.body.getStart(parsed) - initializer.getStart(parsed)).trim();
      return;
    }
    if (ts.isVariableDeclaration(node) && node.name.getText(parsed) === change.name) {
      result = `${node.name.getText(parsed)}${node.type ? `: ${node.type.getText(parsed)}` : ""}`;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(parsed);
  return result || parsed.statements[0]?.getText(parsed) || "";
}

function usageEvidence(input: ZoneInput, target: SymbolChange): SymbolEvidence["uses"] {
  const uses: SymbolEvidence["uses"] = [];
  const project = input.project;
  const scope = new Set([input.left.symbol.key, input.right.symbol.key, ...(input.cluster?.paths ?? [input.path]).flatMap((path) => path?.hops.flatMap((hop) => [hop.from, hop.to]) ?? [])]);
  for (const edge of project.incoming(target.key)) {
    if (edge.kind === "contains" || !scope.has(edge.from)) continue;
    const file = fileFor(edge.from);
    const text = project.readFile?.(file);
    if (text === undefined) continue;
    const tree = source(file, text);
    const caller = project.symbolsInFile(file).find((symbol) => symbol.key === edge.from);
    if (!caller) continue;
    const visit = (node: ts.Node) => {
      if (uses.length >= 3 || node.end < caller.start || node.getStart(tree) > caller.end) return;
      if (ts.isIdentifier(node) && node.getStart(tree) >= caller.start && node.end <= caller.end && project.referenceTargets?.(file, node.getStart(tree)).includes(target.key)) {
        const expression = ts.isPropertyAccessExpression(node.parent) && node.parent.name === node ? node.parent : node;
        const usage = ts.isCallExpression(expression.parent) && expression.parent.expression === expression ? expression.parent : expression;
        uses.push({ file, line: tree.getLineAndCharacterOfPosition(node.getStart(tree)).line + 1, functionName: caller.name, text: usage.getText(tree).slice(0, 300) });
      }
      ts.forEachChild(node, visit);
    };
    visit(tree);
    if (uses.length >= 3) return uses;
  }
  return uses;
}

function symbolEvidence(input: ZoneInput, change: SymbolChange): SymbolEvidence {
  const before = parseChangeSource(change, change.before);
  const after = parseChangeSource(change, change.after);
  const beforeExported = change.beforeExported ?? isExported(before);
  const afterExported = change.status !== "deleted" && (change.exported ?? isExported(after));
  return {
    signature: { before: declarationSignature(change, change.before), after: declarationSignature(change, change.after) },
    status: { beforeExported, afterExported, deleted: change.status === "deleted", becameNonExported: beforeExported && !afterExported && Boolean(after) },
    uses: usageEvidence(input, change)
  };
}

function fourStateEvidence(typecheck: ZoneVerdict["typecheck"]): FourStateEvidence | undefined {
  if (!typecheck?.ran || !typecheck.states) return undefined;
  return { ...typecheck.states, mergedOnlyDiagnostics: typecheck.mergeOnlyDiagnostics ?? [] };
}
function calls(node: ts.Node, keys: ReadonlySet<string>, project: ZoneInput["project"]): ts.CallExpression[] {
  const found: ts.CallExpression[] = [];
  const file = node.getSourceFile().fileName;
  const visit = (entry: ts.Node) => {
    if (ts.isCallExpression(entry)) {
      const target = ts.isPropertyAccessExpression(entry.expression) ? entry.expression.name : entry.expression;
      if (project.referenceTargets?.(file, target.getStart()).some((key) => keys.has(key))) found.push(entry);
    }
    ts.forEachChild(entry, visit);
  };
  visit(node); return found;
}
function usageOf(call: ts.CallExpression, tree: ts.SourceFile) {
  const parent = call.parent;
  if (ts.isPropertyAccessExpression(parent)) return `property access: ${parent.getText(tree)}`;
  if (ts.isBinaryExpression(parent)) return `comparison or arithmetic: ${parent.getText(tree)}`;
  if (ts.isCallExpression(parent)) return `argument passed to ${parent.expression.getText(tree)}: ${parent.getText(tree)}`;
  if (ts.isReturnStatement(parent)) return `returned by caller: ${parent.getText(tree)}`;
  if (ts.isVariableDeclaration(parent)) {
    const name = parent.name.getText(tree);
    const contexts: string[] = [];
    const visit = (node: ts.Node) => { if (ts.isIdentifier(node) && node.text === name && node !== parent.name && (ts.isPropertyAccessExpression(node.parent) || ts.isBinaryExpression(node.parent) || ts.isCallExpression(node.parent))) contexts.push(node.parent.getText(tree)); ts.forEachChild(node, visit); };
    visit(parent.parent.parent.parent);
    return `assigned to ${name}; used as: ${contexts.slice(0, 3).join("; ")}`;
  }
  return `used by caller: ${parent.getText(tree)}`;
}

export function extractInvariants(input: ZoneInput, config: AdjudicationConfig, extraFiles: string[] = []): InvariantContext {
  const result: InvariantContext = { callers: [], tests: [], comments: [], usage: [] };
  if (!config.invariants) return result;
  const left = (input.cluster?.left ?? [input.left.symbol]).map((symbol) => ({ actor: input.left.actor, symbol }));
  const right = (input.cluster?.right ?? [input.right.symbol]).map((symbol) => ({ actor: input.right.actor, symbol }));
  const sides = [...left, ...right];
  const scope = new Set([...sides.map((side) => side.symbol.key), ...(input.cluster?.paths ?? [input.path]).flatMap((path) => path?.hops.flatMap((hop) => [hop.from, hop.to]) ?? [])]);
  for (let sideIndex = 0; sideIndex < sides.length; sideIndex += 1) {
    const side = sides[sideIndex]!; const other = sideIndex < left.length ? right[0]! : left[0]!;
    const aliases = new Set([side.symbol.key]);
    const pending = [side.symbol.key];
    while (pending.length) {
      for (const edge of input.project.incoming(pending.shift()!)) {
        if (edge.kind === "contains" || aliases.has(edge.from)) continue;
        const symbol = input.project.symbolsInFile(fileFor(edge.from)).find((entry) => entry.key === edge.from);
        const text = input.project.readFile?.(fileFor(edge.from)) ?? "";
        let alias = false;
        const find = (node: ts.Node) => {
          if (symbol && node.getStart() === symbol.start && ts.isVariableDeclaration(node) && node.initializer && (ts.isIdentifier(node.initializer) || ts.isPropertyAccessExpression(node.initializer))) alias = true;
          ts.forEachChild(node, find);
        };
        find(source(fileFor(edge.from), text));
        if (alias) { aliases.add(edge.from); pending.push(edge.from); }
      }
    }
    const incoming = [...aliases].flatMap((key) => input.project.incoming(key)).filter((edge) => edge.kind !== "contains" && !aliases.has(edge.from));
    const distance = (key: string) => {
      if (key === other.symbol.key) return 0;
      if (input.path?.hops.some((hop) => hop.from === key || hop.to === key)) return 1;
      if (input.project.outgoing(key).some((edge) => edge.to === other.symbol.key) || input.project.incoming(key).some((edge) => edge.from === other.symbol.key)) return 2;
      return 3;
    };
    const callers = [...new Set(incoming.map((edge) => edge.from))].filter((key) => !config.inputVersion || scope.has(key)).sort((left, right) => distance(left) - distance(right) || left.localeCompare(right)).slice(0, config.topK);
    let callCount = 0;
    for (const key of callers) {
      if (callCount >= config.topK) break;
      const file = fileFor(key); const text = input.project.readFile?.(file) ?? ""; const tree = source(file, text);
      const symbol = input.project.symbolsInFile(file).find((symbol) => symbol.key === key);
      if (!symbol) continue;
      const body = text.slice(symbol.start, symbol.end);
      const declaration = source(file, body).statements[0];
      const signature = declaration && ts.isFunctionDeclaration(declaration) && declaration.body ? body.slice(0, declaration.body.getStart()) : body.split("{")[0];
      for (const call of calls(tree, aliases, input.project).filter((call) => call.getStart() >= symbol.start && call.end <= symbol.end).slice(0, config.topK - callCount)) {
        callCount += 1;
        const line = tree.getLineAndCharacterOfPosition(call.getStart()).line;
        result.callers.push(`${file}:${line + 1} ${signature}\n${text.split("\n").slice(Math.max(0, line - 3), line + 4).join("\n")}`);
        result.usage.push(`${file}:${line + 1} ${usageOf(call, tree)}`);
      }
    }
    const before = source(side.symbol.file, side.symbol.before);
    if (side.symbol.beforeComments) result.comments.push(`${side.symbol.key}: ${side.symbol.beforeComments}`);
    const commentRanges = new Map<number, ts.CommentRange>();
    const visit = (node: ts.Node) => { for (const range of [...(ts.getLeadingCommentRanges(side.symbol.before, node.pos) ?? []), ...(ts.getTrailingCommentRanges(side.symbol.before, node.end) ?? [])]) commentRanges.set(range.pos, range); ts.forEachChild(node, visit); };
    visit(before);
    for (const range of commentRanges.values()) result.comments.push(`${side.symbol.key}: ${side.symbol.before.slice(range.pos, range.end)}`);
    const testFiles = [...new Set([...(input.project.listFiles?.() ?? []), ...extraFiles])].filter((file) => /(?:^|\/)tests?\/|\.(?:test|spec)\.[cm]?[jt]sx?$/.test(file)).sort();
    for (const file of testFiles) {
      const text = input.project.readFile?.(file) ?? ""; const tree = source(file, text);
      const testNames = new Set(["test", "it"]);
      const assertionNames = new Set(["expect"]);
      const assertionRoots = new Set(["assert"]);
      for (const statement of tree.statements.filter(ts.isImportDeclaration)) {
        if (!ts.isStringLiteral(statement.moduleSpecifier)) continue;
        const module = statement.moduleSpecifier.text;
        const clause = statement.importClause;
        if (/^(?:node:)?assert(?:\/strict)?$/.test(module)) {
          if (clause?.name) assertionRoots.add(clause.name.text);
          if (clause?.namedBindings && ts.isNamespaceImport(clause.namedBindings)) assertionRoots.add(clause.namedBindings.name.text);
          if (clause?.namedBindings && ts.isNamedImports(clause.namedBindings)) for (const entry of clause.namedBindings.elements) {
            if ((entry.propertyName ?? entry.name).text === "strict") assertionRoots.add(entry.name.text);
            else assertionNames.add(entry.name.text);
          }
        }
        if (/^(?:node:)?test$/.test(module)) {
          if (clause?.name) testNames.add(clause.name.text);
          if (clause?.namedBindings && ts.isNamedImports(clause.namedBindings)) for (const entry of clause.namedBindings.elements) if (["test", "it"].includes((entry.propertyName ?? entry.name).text)) testNames.add(entry.name.text);
        }
      }
      const visitTest = (node: ts.Node) => {
        const related = new Set([...aliases, ...callers]);
        if (ts.isCallExpression(node) && testNames.has(node.expression.getText(tree)) && calls(node, related, input.project).length > 0) {
          const testName = node.arguments[0]?.getText(tree) ?? "unnamed test";
          const assertions: string[] = [];
          const collect = (entry: ts.Node) => {
            if (ts.isCallExpression(entry)) {
              const expression = entry.expression;
              const assertion = assertionNames.has(expression.getText(tree)) || ts.isPropertyAccessExpression(expression) && assertionRoots.has(expression.expression.getText(tree));
              if (assertion && calls(entry, related, input.project).length > 0) assertions.push(entry.getText(tree));
            }
            ts.forEachChild(entry, collect);
          };
          collect(node);
          if (assertions.length) result.tests.push(`${file}:${tree.getLineAndCharacterOfPosition(node.getStart()).line + 1} ${testName}\n${assertions.join("\n")}`);
        }
        ts.forEachChild(node, visitTest);
      };
      visitTest(tree);
    }
  }
  for (const key of Object.keys(result) as Array<keyof InvariantContext>) result[key] = [...new Set(result[key])];
  return result;
}

export function buildAdjudicationInput(input: ZoneInput, local: ZoneVerdict, config: AdjudicationConfig, extraFiles: string[] = [], _now: () => number = Date.now): AdjudicationInput {
  // 输入版本独立于提示词版本，旧配置可以复现原有录制。
  const completeEvidence = config.inputVersion === "declaration-evidence-v1";
  const bound = (text: string) => text.slice(0, config.contextLimit);
  const side = (value: ZoneInput["left"], symbols = [value.symbol]) => {
    const budget = Math.max(0, Math.floor(config.contextLimit / symbols.length) - 100);
    const text = (state: "before" | "after") => {
      if (symbols.length === 1) return completeEvidence ? symbols[0]![state] : bound(symbols[0]![state]);
      const declarations = symbols.map((symbol) => `${symbol.key}\n${completeEvidence ? symbol[state] : symbol[state].slice(0, budget)}`).join("\n\n");
      return completeEvidence ? declarations : bound(declarations);
    };
    return { actorKind: value.actor.kind, file: [...new Set(symbols.map((symbol) => symbol.file))].join(", "), symbol: symbols.map((symbol) => symbol.key).join(", "), before: text("before"), after: text("after") };
  };
  const context = extractInvariants(input, config, extraFiles);
  const sectionLimit = Math.max(0, Math.floor((config.contextLimit - 44) / 4));
  const sections = Object.entries(context).map(([key, values]) => [key, values.join("\n").slice(0, sectionLimit)] as const);
  const invariantText = sections.map(([key, text]) => `${key}:\n${text}`).join("\n");
  const invariantCoverage = Object.fromEntries(sections.map(([key, text]) => [key, config.invariants && text.length > 0])) as NonNullable<AdjudicationInput["invariantCoverage"]>;
  const left = input.left.symbol;
  const right = input.right.symbol;
  const syntaxFor = (symbols: SymbolChange[]) => symbols.map(declarationSyntax).find((status) => !status.complete) ?? { complete: true };
  const leftSyntax = syntaxFor(input.cluster?.left ?? [left]);
  const rightSyntax = syntaxFor(input.cluster?.right ?? [right]);
  const { states: _states, ...legacyTypecheck } = local.typecheck ?? {};
  return {
    ...(completeEvidence ? { inputVersion: config.inputVersion } : {}),
    promptVersion: config.promptVersion,
    left: side(input.left, input.cluster?.left),
    right: side(input.right, input.cluster?.right),
    relationship: bound((input.cluster?.paths ?? [input.path]).map((path) => path?.hops.map((hop) => `${hop.from} ${hop.kind} ${hop.to} (${hop.direction})`).join("; ") ?? "same declaration").join("\n")),
    invariants: config.invariants ? bound(invariantText) : "",
    invariantCoverage,
    ...(completeEvidence ? {
      structuredEvidence: { left: symbolEvidence(input, left), right: symbolEvidence(input, right), symbols: [...(input.cluster?.left ?? [left]), ...(input.cluster?.right ?? [right])].map((symbol) => ({ symbol: symbol.key, ...symbolEvidence(input, symbol) })), ...(fourStateEvidence(local.typecheck) ? { fourState: fourStateEvidence(local.typecheck) } : {}) },
      syntax: { left: leftSyntax, right: rightSyntax, deferred: !leftSyntax.complete || !rightSyntax.complete }
    } : {}),
    local: { excludedRules: ["same-symbol-concurrent-write", "referenced-symbol-removed", "runtime-export-removed", "call-signature-incompatible", "consumed-return-property-removed", "interface-required-member-incompatible", "merge-only-type-error"], typecheck: local.typecheck ? { ...(completeEvidence ? local.typecheck : legacyTypecheck as NonNullable<ZoneVerdict["typecheck"]>), durationMs: undefined } : undefined }
  };
}
