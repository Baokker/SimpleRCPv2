import { describe, expect, it } from "vitest";
import { classify } from "./classifier.js";
import { validateBodyUnrelatedMaxAdjacentLines } from "./config.js";
import { createSemanticIndex } from "../semantic/index.js";
import { MemoryFileProvider } from "../replay/files.js";
import { mapSymbolChanges } from "../semantic/changes.js";
import { commentOnlyEdit, semanticEditRanges } from "../semantic/trivia.js";
import { parseSymbols } from "../semantic/symbols.js";
import { textDiffOps } from "../tracking/textDiff.js";
import type { PairSide } from "./classifier.js";
import { ConflictGuardTracker } from "../tracking/tracker.js";

const file = "body.ts";
const base = `export function calculate(value: number): number {
  console.log('aaa');
  let total = value;
  total += 1;
  total += 2;
  total += 3;
  total += 4;
  total += 5;
  return total;
}`;
function indexFor(text: string) {
  const index = createSemanticIndex({ files: new MemoryFileProvider({ [file]: text }), now: () => performance.now() });
  index.update();
  return index;
}
function side(memberId: string, before: string, after: string): PairSide {
  const index = indexFor(after);
  const ranges = semanticEditRanges({ file, textBefore: before, textAfter: after, ops: textDiffOps(before, after) });
  const symbol = mapSymbolChanges({ file, baseText: before, proposalText: after, ranges, firstTouchedAt: 0, lastTouchedAt: 1 }, after, index)[0];
  if (!symbol) throw new Error("测试需要符号修改");
  return { actor: { kind: "human", memberId }, symbol };
}
function decision(left: PairSide, right: PairSide, threshold = 3) {
  return classify({ left, right, path: null, nested: false, typeOnly: false, project: indexFor(right.symbol.after), bodyUnrelatedMaxAdjacentLines: threshold });
}

describe("注释与声明内部编辑", () => {
  it.each([
    ["类体增加注释", "export class Cart { total() { return 1; } }", "export class Cart { // 说明\n total() { return 1; } }"],
    ["注释前面回车并增加注释", "function read() {\n  // 原注释\n  return 1;\n}", "function read() {\n\n  // 新注释\n  // 原注释\n  return 1;\n}"],
    ["注释文字中间修改", "function read() { /* 原说明 */ return 1; }", "function read() { /* 新的说明 */ return 1; }"],
    ["两个声明之间增加注释", "function first() {}\n\nfunction second() {}", "function first() {}\n\n// 说明\n\nfunction second() {}"],
    ["仅调整缩进", "function read() {\n return 1;\n}", "function read() {\n    return 1;\n}"]
  ])("%s 不产生符号变更", (_name, before, after) => {
    const index = indexFor(after);
    expect(commentOnlyEdit(file, before, after)).toBe(true);
    const ranges = [{ start: 0, end: after.length }];
    expect(mapSymbolChanges({ file, baseText: before, ranges, firstTouchedAt: 0, lastTouchedAt: 1 }, after, index)).toEqual([]);
    expect(semanticEditRanges({ file, textBefore: before, textAfter: after, ops: textDiffOps(before, after) })).toEqual([]);
  });
  it("混合修改仅为改变代码的声明生成符号变更", () => {
    const before = "function first() { /* 原说明 */ return 1; }\nfunction second() { return 2; }";
    const after = before.replace("原说明", "新说明").replace("return 2", "return 3");
    const ranges = semanticEditRanges({ file, textBefore: before, textAfter: after, ops: textDiffOps(before, after) });
    expect(mapSymbolChanges({ file, baseText: before, ranges, firstTouchedAt: 0, lastTouchedAt: 1 }, after, indexFor(after)).map((symbol) => symbol.key)).toEqual(["body.ts#second"]);
  });
  it("同位置替换后保留双方的语义修改范围与黑区判定", () => {
    const before = 'export function reportTime(): string { return "Shop report"; }';
    const first = before.replace("Shop", "Daily");
    const second = first.replace("Daily", "Weekly");
    const tracker = new ConflictGuardTracker({ clock: { now: () => Date.now(), setTimeout: (callback, delay) => setTimeout(callback, delay), clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>) } });
    try {
      tracker.openDocument(file, before);
      for (const [memberId, textBefore, textAfter] of [["Alice", before, first], ["Bob", first, second]]) {
        const from = textBefore.indexOf('"');
        const deleted = textBefore.slice(from, textBefore.lastIndexOf('"') + 1);
        const inserted = textAfter.slice(from, textAfter.lastIndexOf('"') + 1);
        tracker.edit({ file, origin: { kind: "human", memberId }, at: Date.now(), revisionAfter: 1, textBefore, textAfter, ops: [{ from, deleted, inserted: "" }, { from: from + deleted.length, deleted: "", inserted }] });
      }
      const index = indexFor(second);
      const sides = tracker.getActiveChangeSets().map((set) => ({ actor: set.actor, symbol: mapSymbolChanges(set.files.get(file)!, second, index)[0]! }));
      expect(sides).toHaveLength(2);
      expect(sides.every((entry) => entry.symbol !== undefined)).toBe(true);
      expect(sides.map((entry) => entry.symbol.before)).toEqual([before, first]);
      expect(decision(sides[0], sides[1])).toMatchObject({ zone: "black", ruleId: "same-symbol-concurrent-write" });
    } finally {
      tracker.flush();
    }
  });
  it("console.log 内容修改与同函数计算修改放行", () => {
    expect(decision(side("Alice", base, base.replace("aaa", "bbb")), side("Bob", base, base.replace("total += 1", "total += 10")))).toMatchObject({ zone: "white", decision: "allow", ruleId: "observability-only" });
  });
  it("带有副作用的日志参数仍然参与同符号检查", () => {
    expect(decision(side("Alice", base, base.replace("'aaa'", "updateState()")), side("Bob", base, base.replace("total += 1", "total += 10")))).toMatchObject({ zone: "black", decision: "lock" });
  });
  it("双方仅修改注释时在同符号规则之前放行", () => {
    const symbol = parseSymbols(file, base)[0]!;
    const change = { key: symbol.key, file, name: symbol.name, kind: symbol.kind, status: "modified" as const, before: base, after: base.replace("let total", "/* 说明 */ let total"), startLine: 1, endLine: 10, lastTouchedAt: 1 };
    const left: PairSide = { actor: { kind: "human", memberId: "Alice" }, symbol: change };
    expect(decision(left, { actor: { kind: "human", memberId: "Bob" }, symbol: { ...change, after: base.replace("let total", "// 说明\n  let total") } })).toMatchObject({ zone: "white", ruleId: "comment-only-edit" });
    expect(decision(left, side("Bob", base, base.replace("total += 1", "total += 10")))).toMatchObject({ zone: "white", ruleId: "comment-format-only" });
  });
  it("两处相隔较远的计算修改进入灰区并保持本地警告", () => {
    const left = side("Alice", base, base.replace("total += 1", "total += 10"));
    const right = side("Bob", base, base.replace("total += 5", "total += 50"));
    expect(left.symbol.editedLineRanges).toEqual([{ start: 4, end: 4 }]);
    expect(right.symbol.editedLineRanges).toEqual([{ start: 8, end: 8 }]);
    expect(decision(left, right)).toMatchObject({ zone: "grey", decision: "warn", ruleId: "declaration-body-unrelated", localOnly: true });
    expect(decision(left, right, 4)).toMatchObject({ zone: "black", decision: "lock" });
  });
  it.each([
    ["参数签名", base.replace("value: number", "value: number, currency: string")],
    ["返回类型", base.replace("): number", "): unknown")],
    ["导出状态", base.replace("export function", "function")]
  ])("%s变化保持黑区", (_name, after) => {
    expect(decision(side("Alice", base, after), side("Bob", base, base.replace("total += 5", "total += 50")))).toMatchObject({ zone: "black", decision: "lock" });
  });
  it("字符串内部空白与换行引起的语法变化参与检查", () => {
    expect(commentOnlyEdit(file, "function read() { return 'a b'; }", "function read() { return 'ab'; }")).toBe(false);
    expect(commentOnlyEdit(file, "function read() { return 1; }", "function read() { return\n1; }")).toBe(false);
  });
  it("相邻行参数必须为非负整数", () => {
    for (const value of [-1, 1.5, Number.NaN]) expect(() => validateBodyUnrelatedMaxAdjacentLines(value)).toThrow();
    expect(validateBodyUnrelatedMaxAdjacentLines(3)).toBe(3);
  });
});
