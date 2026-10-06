import fs from "node:fs/promises";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import * as ts from "typescript";
import { expect, test } from "vitest";
import { classify, type PairSide, type ZoneVerdict } from "./classifier.js";
import { createSemanticIndex } from "../semantic/index.js";
import { parseSymbols } from "../semantic/symbols.js";
import type { RelationKind } from "../semantic/types.js";
import { MemoryFileProvider } from "../replay/files.js";

const sourcePath = fileURLToPath(new URL("../../../../../collaboration-tools/packages/open-collaboration-vscode/test/pair-zone-classifier.test.ts", import.meta.url));
const reportPath = fileURLToPath(new URL("../../../../docs/conflict-guard/evidence/checkpoint-a-greylock-parity.json", import.meta.url));
type Literal = string | number | boolean | null | Literal[] | { [key: string]: Literal };
type Environment = Map<string, Literal>;
interface LegacyPairSide { fileName: string; path: string; name: string; beforeSource: string; afterSource: string }
interface LegacyPairOptions {
  origin: LegacyPairSide;
  proposal: LegacyPairSide;
  relationship: { kind: string; depth: number; symbolPath?: { from: { path: string; name: string }; to: { path: string; name: string }; relationKind: string; reference: string; via: string[] } };
  projectSources?: Array<{ path: string; source: string }>;
}
interface Sample { title: string; line: number; binding: string; options: LegacyPairOptions; interface: boolean }

function literal(node: ts.Expression, environment: Environment): Literal {
  if (ts.isStringLiteralLike(node)) return node.text;
  if (ts.isNumericLiteral(node)) return Number(node.text);
  if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
  if (node.kind === ts.SyntaxKind.NullKeyword) return null;
  if (ts.isIdentifier(node) && environment.has(node.text)) return environment.get(node.text)!;
  if (ts.isArrayLiteralExpression(node)) return node.elements.map((item) => literal(item as ts.Expression, environment));
  if (ts.isObjectLiteralExpression(node)) {
    const result: Record<string, Literal> = {};
    for (const property of node.properties) {
      if (ts.isPropertyAssignment(property)) result[property.name.getText().replace(/^['"]|['"]$/g, "")] = literal(property.initializer, environment);
      else if (ts.isShorthandPropertyAssignment(property)) result[property.name.text] = environment.get(property.name.text)!;
      else throw new Error(`不支持的 GreyLock 样例字段：${property.getText()}`);
    }
    return result;
  }
  throw new Error(`不支持的 GreyLock 样例表达式：${node.getText()}`);
}

function options(overrides: Record<string, Literal>): LegacyPairOptions {
  return {
    origin: { fileName: String(overrides.originPath ?? "/checkout.ts"), path: String(overrides.originPath ?? "/checkout.ts"), name: String(overrides.originName ?? "checkout"), beforeSource: String(overrides.originBefore ?? "function checkout(items: number[]) { return calculateTotal(items); }"), afterSource: String(overrides.originAfter ?? "function checkout(items: number[]) { return Math.floor(calculateTotal(items)); }") },
    proposal: { fileName: String(overrides.proposalPath ?? "/pricing.ts"), path: String(overrides.proposalPath ?? "/pricing.ts"), name: String(overrides.proposalName ?? "calculateTotal"), beforeSource: String(overrides.proposalBefore ?? "function calculateTotal(items: number[]) { return items.length; }"), afterSource: String(overrides.proposalAfter ?? "function calculateTotal(items: number[]) { return items.length * 100; }") },
    relationship: { kind: String(overrides.relationshipKind ?? "call"), depth: 1, symbolPath: overrides.relationshipSymbolPath as unknown as LegacyPairOptions["relationship"]["symbolPath"] },
    projectSources: overrides.projectSources as unknown as LegacyPairOptions["projectSources"]
  };
}

function extract(source: string): Sample[] {
  const file = ts.createSourceFile(sourcePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const samples: Sample[] = [];
  const visit = (node: ts.Node) => {
    if (!ts.isCallExpression(node) || node.arguments.length !== 2 || !ts.isStringLiteral(node.arguments[0]!) || !ts.isArrowFunction(node.arguments[1]!)) { ts.forEachChild(node, visit); return; }
    const title = node.arguments[0]!.text;
    const callback = node.arguments[1]! as ts.ArrowFunction;
    if (!ts.isBlock(callback.body)) throw new Error(`GreyLock 测试缺少函数体：${title}`);
    let rows: Literal[] = [{}];
    if (ts.isCallExpression(node.expression) && ts.isPropertyAccessExpression(node.expression.expression) && node.expression.expression.name.text === "each") rows = literal(node.expression.arguments[0]!, new Map()) as Literal[];
    else if (!ts.isIdentifier(node.expression) || node.expression.text !== "test") { ts.forEachChild(node, visit); return; }
    for (const row of rows) {
      const environment: Environment = new Map(Object.entries(row as Record<string, Literal>));
      for (const statement of callback.body.statements) {
        if (!ts.isVariableStatement(statement)) continue;
        for (const declaration of statement.declarationList.declarations) {
          if (!ts.isIdentifier(declaration.name) || !declaration.initializer) throw new Error(`GreyLock 样例变量无法读取：${statement.getText()}`);
          const value = declaration.initializer;
          if (ts.isCallExpression(value) && ts.isIdentifier(value.expression) && ["classifyPairZone", "classifyPairZoneWithInterfaceContract"].includes(value.expression.text)) {
            const wrapped = value.arguments[0]!;
            if (!ts.isCallExpression(wrapped) || !ts.isIdentifier(wrapped.expression) || wrapped.expression.text !== "pairOptions") throw new Error(`GreyLock 分类输入无法读取：${wrapped.getText()}`);
            const overrides = literal(wrapped.arguments[0]!, environment) as Record<string, Literal>;
            samples.push({ title: typeof (row as Record<string, Literal>).label === "string" ? title.replace("$label", String((row as Record<string, Literal>).label)) : title, line: file.getLineAndCharacterOfPosition(value.getStart()).line + 1, binding: declaration.name.text, options: options(overrides), interface: value.expression.text === "classifyPairZoneWithInterfaceContract" });
          } else environment.set(declaration.name.text, literal(value, environment));
        }
      }
    }
  };
  visit(file);
  return samples;
}

function current(sample: Sample): ZoneVerdict {
  const legacy = sample.options;
  const entries: Record<string, string> = {};
  for (const source of legacy.projectSources ?? []) entries[source.path.replace(/^\//, "")] = source.source;
  for (const source of [legacy.origin, legacy.proposal]) entries[source.path.replace(/^\//, "")] ??= source.afterSource;
  const files = new MemoryFileProvider(entries);
  const project = createSemanticIndex({ files, now: () => 0 });
  project.update();
  const side = (source: LegacyPairSide, actor: string): PairSide => {
    const file = source.path.replace(/^\//, "");
    const declarations = project.symbolsInFile(file);
    const symbol = declarations.find((declaration) => declaration.name === source.name);
    const previous = parseSymbols(file, source.beforeSource).find((declaration) => declaration.name === source.name);
    const latest = parseSymbols(file, source.afterSource).find((declaration) => declaration.name === source.name);
    const before = ts.createSourceFile(file, source.beforeSource, ts.ScriptTarget.Latest, true);
    const interfaceDeclaration = before.statements.some((statement) => ts.isInterfaceDeclaration(statement) && statement.name.text === source.name);
    const kind = interfaceDeclaration ? "interface" : previous?.kind ?? symbol?.kind ?? "function";
    return { actor: { kind: "human", memberId: actor }, symbol: { key: previous?.key ?? symbol?.key ?? `${file}#${source.name}`, file, name: source.name, container: previous?.container ?? symbol?.container, kind, status: previous && !latest ? "deleted" : source.afterSource.length ? "modified" : "deleted", before: kind === "method" && previous ? source.beforeSource.slice(previous.start, previous.end) : source.beforeSource, after: kind === "method" && latest ? source.afterSource.slice(latest.start, latest.end) : source.afterSource, startLine: symbol?.startLine ?? 1, endLine: symbol?.endLine ?? 1, lastTouchedAt: 0 } };
  };
  const left = side(legacy.origin, "origin");
  const right = side(legacy.proposal, "proposal");
  const kind = legacy.relationship.kind as RelationKind;
  return classify({ left, right, path: { from: left.symbol.key, to: right.symbol.key, hops: [{ from: left.symbol.key, to: right.symbol.key, kind, direction: "forward" }], typeOnly: kind === "type-reference" }, nested: false, typeOnly: kind === "type-reference", project: { symbolsInFile: project.symbolsInFile, incoming: project.incoming, outgoing: project.outgoing, readFile: (file) => files.readFile(file), listFiles: () => files.listFiles() } });
}

test("GreyLock 原始分区样例逐条执行并保存来源与当前结果", async () => {
  if (process.env.GREYLOCK_PARITY_WRITE !== "1") {
    const recorded = JSON.parse(await fs.readFile(reportPath, "utf8")) as { cases: number; rows: Array<{ sample: Sample; current: { zone: string; ruleId: string } }> };
    expect(recorded.rows).toHaveLength(47);
    for (const row of recorded.rows) {
      const actual = current(row.sample);
      expect({ zone: actual.zone, ruleId: actual.ruleId }, row.sample.title).toEqual(row.current);
    }
    return;
  }
  const source = await fs.readFile(sourcePath, "utf8");
  const samples = extract(source);
  expect(samples).toHaveLength(47);
  const zoneModuleUrl = new URL("../../../../../collaboration-tools/packages/open-collaboration-vscode/src/dal/pair-zone-classifier.ts", import.meta.url);
  const interfaceModuleUrl = new URL("../../../../../collaboration-tools/packages/open-collaboration-vscode/src/dal/pair-interface-contract-classifier.ts", import.meta.url);
  const { classifyPairZone } = await import(fileURLToPath(zoneModuleUrl)) as { classifyPairZone(input: LegacyPairOptions): { zone: string; reason: string } };
  const { classifyPairZoneWithInterfaceContract } = await import(fileURLToPath(interfaceModuleUrl)) as { classifyPairZoneWithInterfaceContract(input: LegacyPairOptions): { zone: string; reason: string } };
  const rows = samples.map((sample) => {
    const original = (sample.interface ? classifyPairZoneWithInterfaceContract : classifyPairZone)(sample.options);
    const actual = current(sample);
    return { title: sample.title, line: sample.line, binding: sample.binding, sample, source: { zone: original.zone, ruleId: original.reason }, current: { zone: actual.zone, ruleId: actual.ruleId }, matchedZone: original.zone === actual.zone, matchedRule: (original.reason === "strict-observability" ? "observability-only" : original.reason === "unparseable-edit-batch" ? "unparsable-side" : original.reason) === actual.ruleId };
  });
  const report = { sourceFile: "packages/open-collaboration-vscode/test/pair-zone-classifier.test.ts", sourceSha256: createHash("sha256").update(source).digest("hex"), cases: rows.length, matchedZones: rows.filter((row) => row.matchedZone).length, matchedRules: rows.filter((row) => row.matchedRule).length, rows };
  await fs.writeFile(reportPath, JSON.stringify(report, null, 2) + "\n");
}, 30000);
