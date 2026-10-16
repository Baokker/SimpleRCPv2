import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import { expect, it } from "vitest";
import { MemoryFileProvider } from "../replay/files.js";
import { createSemanticIndex } from "../semantic/index.js";
import { extractInvariants, buildAdjudicationInput } from "./invariants.js";
import { defaultAdjudicationConfig } from "./config.js";
import type { ZoneInput } from "../routing/classifier.js";
import type { BenchManifest } from "../bench/types.js";
import { parseSymbols } from "../semantic/symbols.js";

it("conflict-shop supplies caller signatures, assertion names and return usage", () => {
  const root = fileURLToPath(new URL("../../../../demo/conflict-shop/", import.meta.url));
  const files = new MemoryFileProvider(Object.fromEntries([...fs.readdirSync(`${root}/src`).map((file) => `src/${file}`), "test/shop.test.mjs"].map((file) => [file, fs.readFileSync(`${root}/${file}`, "utf8")])));
  const index = createSemanticIndex({ files, now: () => 0 }); index.update();
  const make = (file: string, name: string) => { const symbol = index.symbolsInFile(file).find((symbol) => symbol.name === name)!; const before = files.readFile(file).slice(symbol.start, symbol.end); return { ...symbol, status: "modified" as const, before, after: before, lastTouchedAt: 0 }; };
  const input: ZoneInput = { left: { actor: { kind: "human", memberId: "a" }, symbol: make("src/pricing.ts", "applyDiscount") }, right: { actor: { kind: "human", memberId: "b" }, symbol: make("src/cart.ts", "total") }, project: { ...index, readFile: (file) => files.readFile(file) }, path: index.findPaths(["src/pricing.ts#applyDiscount"], ["src/cart.ts#Cart.total"])[0]!, nested: false, typeOnly: false };
  const result = extractInvariants(input, defaultAdjudicationConfig, ["test/shop.test.mjs"]);
  expect(result.callers.join("\n")).toContain("applyDiscount(amount, 0.1)");
  expect(result.callers[0]).toContain("src/cart.ts");
  expect(result.tests.join("\n")).toContain("折扣返回折后价格");
  expect(result.tests.join("\n")).toContain("assert.equal(applyDiscount(100, 0.1), 90)");
  expect(result.usage.join("\n")).toContain("returned by caller");
  const local = { zone: "grey" as const, decision: "warn" as const, ruleId: "semantic-interaction-uncertain", summary: "关联修改", evidence: [], contractChanged: { left: false, right: false } };
  expect(buildAdjudicationInput(input, local, { ...defaultAdjudicationConfig, invariants: false }).invariants).toBe("");
});

it("topK bounds call sites even when one caller invokes a symbol repeatedly", () => {
  const files = new MemoryFileProvider({ "price.ts": "export function price(){ return 10; }", "buy.ts": 'import { price } from "./price"; export function buy(){ return (price()+1)+(price()+2)+(price()+3)+(price()+4)+(price()+5); }' });
  const index = createSemanticIndex({ files, now: () => 0 }); index.update();
  const make = (file: string, name: string) => { const symbol = index.symbolsInFile(file).find((entry) => entry.name === name)!; const before = files.readFile(file).slice(symbol.start, symbol.end); return { ...symbol, before, after: before, status: "modified" as const, lastTouchedAt: 0 }; };
  const input: ZoneInput = { left: { actor: { kind: "human", memberId: "a" }, symbol: make("price.ts", "price") }, right: { actor: { kind: "human", memberId: "b" }, symbol: make("buy.ts", "buy") }, project: { ...index, readFile: (file) => files.readFile(file) }, path: null, nested: false, typeOnly: false };
  const result = extractInvariants(input, defaultAdjudicationConfig);
  expect(result.usage).toHaveLength(3);
});

it("caller and test evidence resolves the modified method across namesakes", () => {
  const files = new MemoryFileProvider({
    "price.ts": "export class Price { apply(value: number){ return value * 2; } }",
    "format.ts": "export class Format { apply(value: number){ return `USD ${value}`; } }",
    "buy.ts": 'import { Price } from "./price"; import { Format } from "./format"; export function buy(){ const formatter = new Format(); const price = new Price(); const label = formatter.apply(10); return price.apply(10); }',
    "test/buy.test.mjs": 'import { Price } from "../price.ts"; import { Format } from "../format.ts"; test("formatter", () => { expect(new Format().apply(5)).toBe("USD 5"); }); test("price", () => { expect(new Price().apply(5)).toBe(10); });'
  });
  const index = createSemanticIndex({ files, now: () => 0 }); index.update();
  const make = (file: string, name: string) => { const symbol = index.symbolsInFile(file).find((entry) => entry.name === name)!; const before = files.readFile(file).slice(symbol.start, symbol.end); return { ...symbol, before, after: before, status: "modified" as const, lastTouchedAt: 0 }; };
  const input: ZoneInput = { left: { actor: { kind: "human", memberId: "a" }, symbol: make("price.ts", "apply") }, right: { actor: { kind: "human", memberId: "b" }, symbol: make("buy.ts", "buy") }, project: index, path: null, nested: false, typeOnly: false };
  const result = extractInvariants(input, { ...defaultAdjudicationConfig, topK: 1 }, ["test/buy.test.mjs"]);
  expect(result.usage).toEqual(["buy.ts:1 returned by caller: return price.apply(10);"]);
  expect(result.tests.join("\n")).toContain('"price"');
  expect(result.tests.join("\n")).not.toContain('"formatter"');
});

it("anonymous default functions retain their caller and test evidence", () => {
  const files = new MemoryFileProvider({ "price.ts": "export default function (value: number){ return value * 2; }", "buy.ts": 'import price from "./price"; export function buy(){ return price(10); }', "test/price.test.mjs": 'import price from "../price.ts"; test("default price", () => { expect(price(5)).toBe(10); });' });
  const index = createSemanticIndex({ files, now: () => 0 }); index.update();
  const make = (file: string, name: string) => { const symbol = index.symbolsInFile(file).find((entry) => entry.name === name)!; const before = files.readFile(file).slice(symbol.start, symbol.end); return { ...symbol, before, after: before, status: "modified" as const, lastTouchedAt: 0 }; };
  const input: ZoneInput = { left: { actor: { kind: "human", memberId: "a" }, symbol: make("price.ts", "default") }, right: { actor: { kind: "human", memberId: "b" }, symbol: make("buy.ts", "buy") }, project: index, path: null, nested: false, typeOnly: false };
  const result = extractInvariants(input, defaultAdjudicationConfig);
  expect(result.usage).toEqual(["buy.ts:1 returned by caller: return price(10);"]);
  expect(result.tests.join("\n")).toContain('"default price"');
});

it("follows an exported alias and keeps only relevant assertions", () => {
  const files = new MemoryFileProvider({ "price.ts": "export function price(value: number){ return value * 2; } export const evaluate = price;", "buy.ts": 'import { evaluate } from "./price"; export function buy(){ return evaluate(10)+1; }', "test/price.test.mjs": 'import { evaluate } from "../price.ts"; test("price", () => { assert.equal(evaluate(5), 10); assert.equal(2+2, 4); });' });
  const index = createSemanticIndex({ files, now: () => 0 }); index.update();
  const make = (file: string, name: string) => { const symbol = index.symbolsInFile(file).find((entry) => entry.name === name)!; const before = files.readFile(file).slice(symbol.start, symbol.end); return { ...symbol, before, after: before, status: "modified" as const, lastTouchedAt: 0 }; };
  const input: ZoneInput = { left: { actor: { kind: "human", memberId: "a" }, symbol: make("price.ts", "price") }, right: { actor: { kind: "human", memberId: "b" }, symbol: make("buy.ts", "buy") }, project: index, path: null, nested: false, typeOnly: false };
  const result = extractInvariants(input, defaultAdjudicationConfig);
  expect(result.callers.join("\n")).toContain("evaluate(10)");
  expect(result.tests.join("\n")).toContain("assert.equal(evaluate(5), 10)");
  expect(result.tests.join("\n")).not.toContain("assert.equal(2+2, 4)");
});

it("sends complete declarations and structured local evidence", () => {
  const files = new MemoryFileProvider({ "price.ts": "export function price(value: number){ return value * 2; }", "buy.ts": 'import { price } from "./price"; export function buy(){ return price(10); }' });
  const index = createSemanticIndex({ files, now: () => 0 }); index.update();
  const price = index.symbolsInFile("price.ts").find((symbol) => symbol.name === "price")!;
  const buy = index.symbolsInFile("buy.ts").find((symbol) => symbol.name === "buy")!;
  const left = { ...price, status: "modified" as const, before: files.readFile("price.ts").slice(price.start, price.end), after: files.readFile("price.ts").slice(price.start, price.end).replace("value: number", "value: string"), lastTouchedAt: 0 };
  const right = { ...buy, status: "modified" as const, before: files.readFile("buy.ts").slice(buy.start, buy.end), after: files.readFile("buy.ts").slice(buy.start, buy.end), lastTouchedAt: 0 };
  const project = { ...index, readFile: (file: string) => files.readFile(file) };
  const input: ZoneInput = { left: { actor: { kind: "human", memberId: "a" }, symbol: left }, right: { actor: { kind: "human", memberId: "b" }, symbol: right }, project, path: index.findPaths([price.key], [buy.key])[0]!, nested: false, typeOnly: false };
  const local = { zone: "grey" as const, decision: "warn" as const, ruleId: "semantic-interaction-uncertain", summary: "关联修改", evidence: [], contractChanged: { left: true, right: false }, typecheck: project.checkFourStates!(input) };
  const result = buildAdjudicationInput(input, local, { ...defaultAdjudicationConfig, contextLimit: 40 });
  expect(result.left.after).toContain("return value * 2;");
  expect(result.structuredEvidence?.left.signature.before).not.toBe(result.structuredEvidence?.left.signature.after);
  expect(result.structuredEvidence?.left.status.beforeExported).toBe(true);
  expect(result.structuredEvidence?.left.status.afterExported).toBe(true);
  expect(result.structuredEvidence?.left.uses).toEqual([{ file: "buy.ts", line: 1, functionName: "buy", text: "price(10)" }]);
  expect(result.structuredEvidence?.fourState?.mergedOnlyDiagnostics).toEqual([]);
  expect(result.structuredEvidence?.fourState?.baseline.diagnostics).toEqual([]);
  expect(result.structuredEvidence?.fourState?.leftOnly.diagnostics.some((diagnostic) => diagnostic.includes("arithmetic"))).toBe(true);
  const incomplete = buildAdjudicationInput({ ...input, left: { ...input.left, symbol: { ...left, after: "export function price(value: number) {" } } }, local, defaultAdjudicationConfig);
  expect(incomplete.syntax?.deferred).toBe(true);
  expect(incomplete.syntax?.left.complete).toBe(false);
  expect(incomplete.structuredEvidence?.left.status.deleted).toBe(false);
  const clustered = buildAdjudicationInput({ ...input, cluster: { left: [left, { ...left, key: "price.ts#pending", name: "pending", after: "export function pending() {" }], right: [right], paths: [input.path] } }, local, defaultAdjudicationConfig);
  expect(clustered.syntax?.left.complete).toBe(false);
  expect(clustered.structuredEvidence?.symbols).toHaveLength(3);
});

it.each([
  ["d1-0005", "applyDiscount", true],
  ["d1-0010", "usageCharge", true],
  ["d1-0021", "applyDiscount", false],
  ["d1-0026", "usageCharge", false],
  ["d1-0045", "taxableAmount", false]
] as const)("核对开发集关系组 %s 的完整声明、签名、导出状态和四状态证据", (id, producerName, signatureChanged) => {
  const archive = JSON.parse(gunzipSync(fs.readFileSync(new URL("../../bench/datasets/d1-v3/dataset.json.gz", import.meta.url))).toString()) as { manifest: BenchManifest };
  const group = archive.manifest.groups.find((entry) => entry.id === id)!;
  expect(group.split).toBe("dev");
  const variant = group.variants.safe;
  const files = new MemoryFileProvider(variant.merged);
  const index = createSemanticIndex({ files, now: () => 0 }); index.update();
  const make = (key: string) => {
    const file = key.slice(0, key.indexOf("#"));
    const beforeSymbol = parseSymbols(file, variant.baseline[file]!).find((symbol) => symbol.key === key)!;
    const afterSymbol = index.symbolsInFile(file).find((symbol) => symbol.key === key)!;
    return { ...afterSymbol, beforeExported: beforeSymbol.exported, status: "modified" as const, before: variant.baseline[file]!.slice(beforeSymbol.start, beforeSymbol.end), after: variant.merged[file]!.slice(afterSymbol.start, afterSymbol.end), lastTouchedAt: 0 };
  };
  const left = make(variant.site!.producerKey);
  const right = make(variant.site!.consumerKey);
  const input: ZoneInput = { left: { actor: { kind: "human", memberId: "a" }, symbol: left }, right: { actor: { kind: "human", memberId: "b" }, symbol: right }, project: index, path: index.findPaths([left.key], [right.key])[0] ?? null, nested: false, typeOnly: false };
  const typecheck = index.checkFourStates!(input);
  const local = { zone: "grey" as const, decision: "warn" as const, ruleId: "semantic-interaction-uncertain", summary: "关联修改", evidence: [], contractChanged: { left: false, right: false }, typecheck };
  const result = buildAdjudicationInput(input, local, defaultAdjudicationConfig);
  expect(result.left.before).toBe(left.before);
  expect(result.left.after).toBe(left.after);
  expect(result.right.after).toBe(right.after);
  expect(result.structuredEvidence!.left.signature.before.startsWith(`export function ${producerName}(`)).toBe(true);
  expect(result.structuredEvidence!.left.signature.before !== result.structuredEvidence!.left.signature.after).toBe(signatureChanged);
  expect(result.structuredEvidence!.left.status).toEqual({ beforeExported: true, afterExported: true, deleted: false, becameNonExported: false });
  expect(result.structuredEvidence!.fourState).toEqual({ ...typecheck.states, mergedOnlyDiagnostics: typecheck.mergeOnlyDiagnostics });
  expect(result.syntax).toEqual({ left: { complete: true }, right: { complete: true }, deferred: false });
  expect(result.structuredEvidence!.left.uses.length).toBeLessThanOrEqual(3);
  if (id === "d1-0045") {
    expect(result.structuredEvidence!.left.uses).toHaveLength(1);
    expect(result.structuredEvidence!.left.uses[0]).toMatchObject({ functionName: "corporateTax", text: 'pricing.taxableAmount(Math.max(1, price), 0.1, "CNY")' });
  }
});

it("删除声明与取消导出的证据分别记录真实状态", () => {
  const files = new MemoryFileProvider({ "a.ts": "export function price() { return 10; }", "b.ts": 'import { price } from "./a"; export function buy() { return price(); }' });
  const project = createSemanticIndex({ files, now: () => 0 });
  project.update();
  const side = (file: string, name: string, memberId: string) => {
    const symbol = project.symbolsInFile(file).find((symbol) => symbol.name === name)!;
    const before = files.readFile(file).slice(symbol.start, symbol.end);
    return { actor: { kind: "human" as const, memberId }, symbol: { ...symbol, beforeExported: symbol.exported, status: "modified" as const, before, after: before, lastTouchedAt: 0 } };
  };
  const input: ZoneInput = { left: side("a.ts", "price", "a"), right: side("b.ts", "buy", "b"), project, path: project.findPaths(["a.ts#price"], ["b.ts#buy"])[0]!, nested: false, typeOnly: false };
  const local = { zone: "grey" as const, decision: "warn" as const, ruleId: "semantic-interaction-uncertain", summary: "关联修改", evidence: [], contractChanged: { left: true, right: false } };
  input.left.symbol.after = "function price() { return 10; }";
  input.left.symbol.exported = false;
  expect(buildAdjudicationInput(input, local, defaultAdjudicationConfig).structuredEvidence!.left.status).toEqual({ beforeExported: true, afterExported: false, deleted: false, becameNonExported: true });
  const deleted = { ...input, left: { ...input.left, symbol: { ...input.left.symbol, status: "deleted" as const, after: "" } } };
  const evidence = buildAdjudicationInput(deleted, local, defaultAdjudicationConfig);
  expect(evidence.structuredEvidence!.left.status).toEqual({ beforeExported: true, afterExported: false, deleted: true, becameNonExported: false });
  expect(evidence.syntax!.left.complete).toBe(true);
  expect(evidence.structuredEvidence!.left.uses).toEqual([{ file: "b.ts", line: 1, functionName: "buy", text: "price()" }]);
});
