import * as ts from "typescript";
import type { ZoneInput, ZoneVerdict } from "../routing/classifier.js";
import type { AdjudicationConfig, AdjudicationInput } from "./types.js";

export interface InvariantContext { callers: string[]; tests: string[]; comments: string[]; usage: string[] }
const fileFor = (key: string) => key.slice(0, key.indexOf("#"));
function source(file: string, text: string) { return ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, /\.[cm]?jsx?$/.test(file) ? ts.ScriptKind.JS : ts.ScriptKind.TS); }
function calls(node: ts.Node, key: string, project: ZoneInput["project"]): ts.CallExpression[] {
  const found: ts.CallExpression[] = [];
  const file = node.getSourceFile().fileName;
  const visit = (entry: ts.Node) => {
    if (ts.isCallExpression(entry)) {
      const target = ts.isPropertyAccessExpression(entry.expression) ? entry.expression.name : entry.expression;
      if (project.referenceTargets?.(file, target.getStart()).includes(key)) found.push(entry);
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
  const sides = [input.left, input.right];
  for (let sideIndex = 0; sideIndex < sides.length; sideIndex += 1) {
    const side = sides[sideIndex]!; const other = sides[1 - sideIndex]!;
    const incoming = input.project.incoming(side.symbol.key).filter((edge) => edge.kind !== "contains");
    const distance = (key: string) => {
      if (key === other.symbol.key) return 0;
      if (input.path?.hops.some((hop) => hop.from === key || hop.to === key)) return 1;
      if (input.project.outgoing(key).some((edge) => edge.to === other.symbol.key) || input.project.incoming(key).some((edge) => edge.from === other.symbol.key)) return 2;
      return 3;
    };
    const callers = [...new Set(incoming.map((edge) => edge.from))].sort((left, right) => distance(left) - distance(right) || left.localeCompare(right)).slice(0, config.topK);
    let callCount = 0;
    for (const key of callers) {
      if (callCount >= config.topK) break;
      const file = fileFor(key); const text = input.project.readFile?.(file) ?? ""; const tree = source(file, text);
      const symbol = input.project.symbolsInFile(file).find((symbol) => symbol.key === key);
      if (!symbol) continue;
      const body = text.slice(symbol.start, symbol.end);
      const declaration = source(file, body).statements[0];
      const signature = declaration && ts.isFunctionDeclaration(declaration) && declaration.body ? body.slice(0, declaration.body.getStart()) : body.split("{")[0];
      for (const call of calls(tree, side.symbol.key, input.project).filter((call) => call.getStart() >= symbol.start && call.end <= symbol.end).slice(0, config.topK - callCount)) {
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
      const visitTest = (node: ts.Node) => {
        if (ts.isCallExpression(node) && /^(test|it)$/.test(node.expression.getText(tree)) && calls(node, side.symbol.key, input.project).length > 0) {
          const testName = node.arguments[0]?.getText(tree) ?? "unnamed test";
          const assertions: string[] = [];
          const collect = (entry: ts.Node) => { if (ts.isCallExpression(entry) && /^(assert\.|expect\()/u.test(entry.getText(tree))) assertions.push(entry.getText(tree)); ts.forEachChild(entry, collect); };
          collect(node);
          result.tests.push(`${file}:${tree.getLineAndCharacterOfPosition(node.getStart()).line + 1} ${testName}\n${assertions.join("\n")}`);
        }
        ts.forEachChild(node, visitTest);
      };
      visitTest(tree);
    }
  }
  for (const key of Object.keys(result) as Array<keyof InvariantContext>) result[key] = [...new Set(result[key])];
  return result;
}

export function buildAdjudicationInput(input: ZoneInput, local: ZoneVerdict, config: AdjudicationConfig, extraFiles: string[] = []): AdjudicationInput {
  const bound = (text: string) => text.slice(0, config.contextLimit);
  const side = (value: ZoneInput["left"]) => ({ actorKind: value.actor.kind, file: value.symbol.file, symbol: value.symbol.key, before: bound(value.symbol.before), after: bound(value.symbol.after) });
  const context = extractInvariants(input, config, extraFiles);
  const invariantText = Object.entries(context).map(([key, values]) => `${key}:\n${values.join("\n")}`).join("\n");
  return { promptVersion: config.promptVersion, left: side(input.left), right: side(input.right), relationship: bound(input.path?.hops.map((hop) => `${hop.from} ${hop.kind} ${hop.to} (${hop.direction})`).join("; ") ?? "same declaration"), invariants: config.invariants ? bound(invariantText) : "", local: { excludedRules: ["same-symbol-concurrent-write", "referenced-symbol-removed", "runtime-export-removed", "call-signature-incompatible", "consumed-return-property-removed", "interface-required-member-incompatible", "merge-only-type-error"], typecheck: local.typecheck ? { ...local.typecheck, durationMs: undefined } : undefined } };
}
