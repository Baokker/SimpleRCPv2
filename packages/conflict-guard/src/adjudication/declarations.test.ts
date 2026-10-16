import { expect, it } from "vitest";
import { MemoryFileProvider } from "../replay/files.js";
import { createSemanticIndex } from "../semantic/index.js";
import { mapSymbolChanges } from "../semantic/changes.js";
import { buildAdjudicationInput } from "./invariants.js";
import { defaultAdjudicationConfig } from "./config.js";

function evidence(before: string, after: string) {
  const files = new MemoryFileProvider({ "a.ts": after, "b.ts": "export function use() { return 1; }" });
  const project = createSemanticIndex({ files, now: () => 0 });
  project.update();
  const changes = mapSymbolChanges({ file: "a.ts", baseText: before, ranges: [{ start: 0, end: after.length }], firstTouchedAt: 0, lastTouchedAt: 1 }, after, project);
  const left = changes.find((change) => change.name === "foo");
  const right = project.symbolsInFile("b.ts")[0]!;
  if (!left) throw new Error("未找到变量修改");
  return buildAdjudicationInput({ left: { actor: { kind: "human", memberId: "alice" }, symbol: left }, right: { actor: { kind: "human", memberId: "bob" }, symbol: { ...right, before: files.readFile("b.ts"), after: files.readFile("b.ts"), status: "modified", lastTouchedAt: 1 } }, project, path: null, typeOnly: false, nested: false }, { zone: "grey", decision: "warn", ruleId: "semantic-interaction-uncertain", summary: "关联修改", evidence: [], contractChanged: { left: false, right: false } }, { ...defaultAdjudicationConfig, invariants: false });
}

it.each(["export const", "let", "var"])("完整的 %s 数组声明可以进入研判", (prefix) => {
  const input = evidence(`${prefix} foo: number[] = [1];`, `${prefix} foo: number[] = [2];`);
  expect(input.syntax).toEqual({ left: { complete: true }, right: { complete: true }, deferred: false });
  expect(input.left.before).toBe(`${prefix} foo: number[] = [1]`);
  expect(input.left.after).toBe(`${prefix} foo: number[] = [2]`);
  expect(input.structuredEvidence!.left.signature).toEqual({ before: "foo: number[]", after: "foo: number[]" });
});

it("箭头函数的函数体修改保持相同的结构化签名", () => {
  const input = evidence("export const foo = (value: number): number => value + 1;", "export const foo = (value: number): number => value + 2;");
  expect(input.syntax!.deferred).toBe(false);
  expect(input.structuredEvidence!.left.signature).toEqual({ before: "foo = (value: number): number =>", after: "foo = (value: number): number =>" });
});

it("变量上的函数类型标注属于结构化签名", () => {
  const input = evidence("export const foo: (value: number) => number = value => 1;", "export const foo: (value: string) => number = value => 1;");
  expect(input.structuredEvidence!.left.signature).toEqual({ before: "foo: (value: number) => number = value =>", after: "foo: (value: string) => number = value =>" });
});

it("多变量声明使用各自的初始化表达式", () => {
  const input = evidence("export const other = 1, foo: number[] = [1];", "export const other = 1, foo: number[] = [2];");
  expect(input.syntax!.deferred).toBe(false);
  expect(input.left.after).toBe("export const foo: number[] = [2]");
});

it("函数表达式的函数体内容不进入结构化签名", () => {
  const input = evidence("export const foo = function(value: number): number { return value + 1; };", "export const foo = function(value: number): number { return value + 2; };");
  expect(input.structuredEvidence!.left.signature).toEqual({ before: "foo = function(value: number): number", after: "foo = function(value: number): number" });
});

it("新增变量保留完整声明及导出状态", () => {
  const input = evidence("", "export const foo: number[] = [2];");
  expect(input.syntax!.deferred).toBe(false);
  expect(input.left.before).toBe("");
  expect(input.structuredEvidence!.left.status).toEqual({ beforeExported: false, afterExported: true, deleted: false, becameNonExported: false });
});

it("删除变量保留修改前的声明", () => {
  const input = evidence("export const foo: number[] = [1];", "export const replacement = 1;");
  expect(input.syntax!.deferred).toBe(false);
  expect(input.left.before).toBe("export const foo: number[] = [1]");
  expect(input.left.after).toBe("");
  expect(input.structuredEvidence!.left.status).toEqual({ beforeExported: true, afterExported: false, deleted: true, becameNonExported: false });
});

it("数组初始化尚未结束时保持等待", () => {
  const input = evidence("export const foo: number[] = [1];", "export const foo: number[] = [2,");
  expect(input.syntax).toEqual({ left: { complete: false, reason: "after declaration has syntax diagnostics" }, right: { complete: true }, deferred: true });
});
