import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { MemoryFileProvider } from "../replay/files.js";
import { createSemanticIndex } from "../semantic/index.js";
import { extractInvariants, buildAdjudicationInput } from "./invariants.js";
import { defaultAdjudicationConfig } from "./config.js";
import type { ZoneInput } from "../routing/classifier.js";

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
