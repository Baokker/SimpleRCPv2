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
import { VirtualClock } from "../replay/clock.js";
import { evaluateAgentChanges, proposalFileChange } from "../coordination/agentGuard.js";

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
  const symbol = mapSymbolChanges(proposalFileChange({ file, before, after }, 1), after, index)[0];
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
  it.each(["independent", "shared"])("%s 文本的远距离修改保留合并独有类型错误检查", (mode) => {
    const first = base.replace("let total = value;", "const shared = 1;\n  let total = value;");
    const second = base.replace("return total;", "const shared = 2;\n  return total;");
    const merged = first.replace("return total;", "const shared = 2;\n  return total;");
    const left = mode === "independent" ? side("Alice", base, first) : side("Alice", second, merged);
    const right = mode === "independent" ? side("Bob", base, second) : side("Bob", first, merged);
    const project = indexFor(merged);
    const input = { left, right, path: null, nested: false, typeOnly: false, project };
    const checked = project.checkFourStates!(input);
    expect(checked.ran).toBe(true);
    expect(checked.mergeOnlyDiagnostics?.some((entry) => entry.includes("2451"))).toBe(true);
    expect(classify(input)).toMatchObject({ zone: "black", decision: "lock", ruleId: "merge-only-type-error", typecheck: { ran: true } });
  });
  it("未声明返回类型的函数改变推断返回类型时保持黑区", () => {
    const before = base.replace("): number", ")");
    const first = before.replace("total += 1", "total += 10");
    const second = before.replace("return total;", "return `${total}`;");
    const merged = first.replace("return total;", "return `${total}`;");
    expect(classify({ left: side("Alice", before, first), right: side("Bob", before, second), path: null, nested: false, typeOnly: false, project: indexFor(merged) })).toMatchObject({ zone: "black", decision: "lock", contractChanged: { left: false, right: true } });
  });
  it.each(["(value: number) =>", "function (value: number)"])("类属性 %s 的推断返回类型变化保持黑区", (initializer) => {
    const before = `export class Cart {\n  calculate = ${initializer} {\n    let total = value;\n    total += 1;\n    total += 2;\n    total += 3;\n    total += 4;\n    total += 5;\n    return total;\n  };\n}`;
    const first = before.replace("total += 1", "total += 10");
    const second = before.replace("return total;", "return `${total}`;");
    const merged = first.replace("return total;", "return `${total}`;");
    expect(classify({ left: side("Alice", before, first), right: side("Bob", before, second), path: null, nested: false, typeOnly: false, project: indexFor(merged) })).toMatchObject({ zone: "black", decision: "lock", contractChanged: { left: false, right: true }, typecheck: { ran: true } });
  });
  it("混合代码与成对块注释只记录代码修改范围", () => {
    const before = base.replace("  total += 5;", "  // 金额说明\n  // 保留说明\n  total += 5;");
    const first = before.replace("total += 1", "total += 10").replace("  // 金额说明", "  /*\n  // 金额说明").replace("  // 保留说明", "  // 保留说明\n  */");
    const second = before.replace("return total;", "return total + 1;");
    const merged = first.replace("return total;", "return total + 1;");
    const left = side("Alice", before, first);
    expect(left.symbol.editedLineRanges).toEqual([{ start: 4, end: 4 }]);
    expect(classify({ left, right: side("Bob", before, second), path: null, nested: false, typeOnly: false, project: indexFor(merged) })).toMatchObject({ zone: "grey", decision: "warn", ruleId: "declaration-body-unrelated" });
  });
  it.each([
    ["换行改变 return 语法", "function read() { let value = 1; return value; }", "function read() { let value = 2; return\nvalue; }"],
    ["正则内容", "function read() { let value = 1; return /a b/; }", "function read() { let value = 2; return /ab/; }"],
    ["JSX 文字", "function read() { let value = 1; return <div>a b</div>; }", "function read() { let value = 2; return <div>ab</div>; }"]
  ])("%s 的范围保留", (_name, before, after) => {
    const file = "body.tsx";
    const ranges = semanticEditRanges({ file, textBefore: before, textAfter: after, ops: textDiffOps(before, after) });
    expect(ranges.some((range) => range.start >= after.indexOf("return"))).toBe(true);
  });
  it("注释包围有效代码时仍然记录符号修改", () => {
    const before = "function read() { let value = 1; value += 2; return value; }";
    const after = "function read() { let value = 2; /* value += 2; */ return value; }";
    const ranges = semanticEditRanges({ file, textBefore: before, textAfter: after, ops: textDiffOps(before, after) });
    expect(ranges.some((range) => range.start === after.indexOf("return"))).toBe(true);
    expect(mapSymbolChanges(proposalFileChange({ file, before, after }, 1), after, indexFor(after))).toMatchObject([{ key: "body.ts#read", status: "modified" }]);
  });
  it("注释包围整个声明时记录本人删除并保护仍然存在的调用", () => {
    const before = "export function price() { return 1; }\nexport function cart() { return price(); }\n";
    const first = before.replace("export function price() { return 1; }", "/* export function price() { return 1; } */");
    const merged = first.replace("return price();", "return price() + 1;");
    const tracker = new ConflictGuardTracker({ clock: new VirtualClock() });
    tracker.openDocument(file, before);
    for (const [memberId, textBefore, textAfter] of [["Alice", before, first], ["Bob", first, merged]]) tracker.edit({ file, origin: { kind: "human", memberId }, at: 1, revisionAfter: 1, textBefore, textAfter, ops: textDiffOps(textBefore, textAfter) });
    const project = indexFor(merged);
    const sides = tracker.getActiveChangeSets().map((set) => ({ actor: set.actor, symbol: mapSymbolChanges(set.files.get(file)!, merged, project)[0]! }));
    expect(sides[0]!.symbol).toMatchObject({ key: "body.ts#price", status: "deleted" });
    expect(sides[1]!.symbol).toMatchObject({ key: "body.ts#cart", status: "modified" });
    expect(classify({ left: sides[0]!, right: sides[1]!, path: { from: "body.ts#cart", to: "body.ts#price", hops: [{ from: "body.ts#cart", to: "body.ts#price", kind: "value-reference", direction: "forward" }], typeOnly: false }, nested: false, typeOnly: false, project })).toMatchObject({ zone: "black", decision: "lock" });
    tracker.flush();
  });
  it("全文替换后其他成员删除无关声明时保持删除归属", () => {
    const before = "export function first() { return 1; }\nexport function second() { return 2; }\n";
    const first = before.replace("return 1", "return 3");
    const merged = first.replace("export function second() { return 2; }\n", "");
    const tracker = new ConflictGuardTracker({ clock: new VirtualClock() });
    tracker.openDocument(file, before);
    tracker.edit({ file, origin: { kind: "human", memberId: "Alice" }, at: 1, revisionAfter: 1, textBefore: before, textAfter: first, ops: [{ from: 0, deleted: before, inserted: first }] });
    tracker.edit({ file, origin: { kind: "human", memberId: "Bob" }, at: 2, revisionAfter: 2, textBefore: first, textAfter: merged, ops: textDiffOps(first, merged) });
    const project = indexFor(merged);
    const changes = tracker.getActiveChangeSets().map((set) => mapSymbolChanges(set.files.get(file)!, merged, project).map(({ key, status }) => ({ key, status })));
    expect(changes).toEqual([[{ key: "body.ts#first", status: "modified" }], [{ key: "body.ts#second", status: "deleted" }]]);
    tracker.flush();
  });
  it("同一次替换中的代码与长注释仅记录代码行", () => {
    const before = base.replace("let total = value", "let total = 1");
    const first = before.replace("let total = 1;", "let total = 2 /*\n  说明甲\n  说明乙\n  说明丙\n  说明丁\n  */;");
    const second = before.replace("return total", "return total + 1");
    const merged = first.replace("return total", "return total + 1");
    const left = side("Alice", before, first);
    expect(left.symbol.editedLineRanges.every((range) => range.start === 3 && range.end === 3)).toBe(true);
    expect(classify({ left, right: side("Bob", before, second), path: null, nested: false, typeOnly: false, project: indexFor(merged) })).toMatchObject({ zone: "grey", decision: "warn", ruleId: "declaration-body-unrelated" });
  });
  it.each(["text-diff", "whole-file"])("%s 共享文本中的长注释替换空白时，远距离代码修改仍然保持灰区", (mode) => {
    const before = "export function calculate(): number {\n  let total = 1;\n\n\n\n\n  return total;\n}";
    const first = before.replace("let total = 1;\n\n\n\n\n", "let total = 2 /*\n  说明甲\n  说明乙\n  说明丙\n  */;\n");
    const merged = first.replace("return total", "return total + 1");
    const tracker = new ConflictGuardTracker({ clock: new VirtualClock() });
    tracker.openDocument(file, before);
    for (const [memberId, textBefore, textAfter] of [["Alice", before, first], ["Bob", first, merged]]) tracker.edit({ file, origin: { kind: "human", memberId }, at: 1, revisionAfter: 1, textBefore, textAfter, ops: mode === "whole-file" ? [{ from: 0, deleted: textBefore, inserted: textAfter }] : textDiffOps(textBefore, textAfter) });
    const project = indexFor(merged);
    const sides = tracker.getActiveChangeSets().map((set) => ({ actor: set.actor, symbol: mapSymbolChanges(set.files.get(file)!, merged, project)[0]! }));
    expect(sides[0]!.symbol.editedLineRanges).toEqual([{ start: 2, end: 2 }]);
    expect(sides[1]!.symbol.editedLineRanges).toEqual([{ start: 7, end: 7 }]);
    expect(classify({ left: sides[0]!, right: sides[1]!, path: null, nested: false, typeOnly: false, project })).toMatchObject({ zone: "grey", decision: "warn", ruleId: "declaration-body-unrelated" });
    tracker.flush();
  });
  it.each(["mjs", "cjs"])("%s 文件的远距离修改可以完成真实四状态检查", (extension) => {
    const file = `body.${extension}`;
    const before = base.replace("value: number", "value").replace("): number", ")");
    const first = before.replace("total += 1", "total += 10");
    const second = before.replace("total += 5", "total += 50");
    const merged = first.replace("total += 5", "total += 50");
    const project = createSemanticIndex({ files: new MemoryFileProvider({ [file]: merged }), now: () => performance.now() });
    project.update();
    const side = (memberId: string, after: string): PairSide => ({ actor: { kind: "human", memberId }, symbol: mapSymbolChanges(proposalFileChange({ file, before, after }, 1), after, project)[0]! });
    expect(classify({ left: side("Alice", first), right: side("Bob", second), path: null, nested: false, typeOnly: false, project })).toMatchObject({ zone: "grey", decision: "warn", ruleId: "declaration-body-unrelated", typecheck: { ran: true } });
  });
  it("代码修改后逐字符输入注释，仅保留有效代码的语义范围", () => {
    const before = base.replace("  return total;", "  \n  return total;");
    const tracker = new ConflictGuardTracker({ clock: new VirtualClock() });
    tracker.openDocument(file, before);
    let text = before;
    const edit = (memberId: string, after: string) => {
      tracker.edit({ file, origin: { kind: "human", memberId }, at: 1, revisionAfter: 1, textBefore: text, textAfter: after, ops: textDiffOps(text, after) });
      text = after;
    };
    edit("Alice", text.replace("total += 1", "total += 10"));
    edit("Alice", text.replace("  \n  return", "  /\n  return"));
    edit("Alice", text.replace("  /\n  return", "  //\n  return"));
    edit("Bob", text.replace("return total", "return total + 1"));
    const project = indexFor(text);
    const sides = tracker.getActiveChangeSets().map((set) => ({ actor: set.actor, symbol: mapSymbolChanges(set.files.get(file)!, text, project)[0]! }));
    expect(sides[0]!.symbol.editedLineRanges).toEqual([{ start: 4, end: 4 }]);
    expect(classify({ left: sides[0]!, right: sides[1]!, path: null, nested: false, typeOnly: false, project })).toMatchObject({ zone: "grey", decision: "warn", ruleId: "declaration-body-unrelated" });
    tracker.flush();
  });
  it("Agent 的混合提案仅使用有效代码范围检查远距离修改", async () => {
    const before = base.replace("  return total;", "  \n  return total;");
    const human = before.replace("return total;", "return total + 1;");
    const agent = before.replace("total += 1", "total += 10").replace("  \n  return", "  // 金额说明\n  return");
    const result = await evaluateAgentChanges({ actor: { kind: "agent", runId: "mixed-comment", ownerId: "Alice" }, proposals: [{ file, before, after: agent }], active: [{ actor: { kind: "human", memberId: "Bob" }, status: "settled", files: new Map([[file, proposalFileChange({ file, before, after: human }, 1)]]) }], files: new MemoryFileProvider({ [file]: human }), now: () => performance.now(), signal: new AbortController().signal, mergeShared: true });
    expect(result.records).toHaveLength(1);
    expect(result.records[0]!.verdict).toMatchObject({ zone: "grey", decision: "warn", ruleId: "declaration-body-unrelated" });
    expect(result.inputs[0]!.left.symbol.editedLineRanges).toEqual([{ start: 4, end: 4 }]);
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
