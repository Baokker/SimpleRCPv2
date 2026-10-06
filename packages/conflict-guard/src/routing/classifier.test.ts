import { describe, expect, test } from "vitest";
import { classify, symbolContractChanged, type PairSide } from "./classifier.js";
import { createFourStateTypeChecker } from "./typecheck.js";
import type { SymbolChange } from "../semantic/changes.js";
import * as ts from "typescript";
import { runInNewContext } from "node:vm";
import { createSemanticIndex } from "../semantic/index.js";
import { MemoryFileProvider } from "../replay/files.js";

const project = { symbolsInFile: () => [], outgoing: () => [], incoming: () => [] };
function side(file: string, name: string, before: string, after: string, extra: Partial<SymbolChange> = {}): PairSide {
  return { actor: { kind: "human", memberId: file }, symbol: { key: `${file}#${name}`, file, name, kind: "function", status: "modified", before, after, startLine: 1, endLine: 3, lastTouchedAt: 1, ...extra } };
}
function input(left: PairSide, right: PairSide, path = { from: left.symbol.key, to: right.symbol.key, hops: [{ from: left.symbol.key, to: right.symbol.key, kind: "call" as const, direction: "forward" as const }], typeOnly: false }) { return { left, right, path, nested: false, typeOnly: false, project }; }

describe("阶段 3 分区规则", () => {
  test("同一声明与注释日志修改分别命中黑区和白区", () => {
    const same = side("a.ts", "run", "function run() { return 1; }", "function run(x: number) { return x; }");
    expect(classify({ ...input(same, { ...same, actor: { kind: "human", memberId: "b" } }, null), nested: false })).toMatchObject({ zone: "black", decision: "lock", ruleId: "same-symbol-concurrent-write" });
    const log = side("a.ts", "run", "function run() { return 1; }", "function run() { console.log('x'); return 1; }");
    expect(classify(input(log, side("b.ts", "call", "function call() { return 1; }", "function call() { return 2; }") ))).toMatchObject({ zone: "white", ruleId: "observability-only" });
  });
  test("必填参数新增命中调用签名不兼容", () => {
    const producer = side("pricing.ts", "price", "function price(value: number) { return value; }", "function price(value: number, currency: string) { return value; }");
    const consumer = side("checkout.ts", "checkout", "function checkout() { return price(1); }", "function checkout() { return price(1); }");
    expect(classify(input(producer, consumer))).toMatchObject({ zone: "black", ruleId: "call-signature-incompatible" });
  });
  test("普通计算修改命中灰区", () => {
    const left = side("pricing.ts", "price", "function price(value: number) { return value; }", "function price(value: number) { return value - 1; }");
    const right = side("checkout.ts", "checkout", "function checkout() { return price(1); }", "function checkout() { return price(2); }");
    expect(classify(input(left, right))).toMatchObject({ zone: "grey", decision: "warn", ruleId: "semantic-interaction-uncertain" });
  });
  test.each([
    ["a b", "ab"],
    ["/* first */value", "/* second */value"],
    ["console.log('first');", "console.log('second');"]
  ])("字符串内容变化保留运行时语义：%s", (before, after) => {
    const left = side("a.ts", "run", `function run() { return ${JSON.stringify(before)}; }`, `function run() { return ${JSON.stringify(after)}; }`);
    const right = side("b.ts", "call", "function call() { return run(); }", "function call() { return run() + '!'; }");
    expect(classify(input(left, right))).toMatchObject({ zone: "grey", decision: "warn" });
  });
  test("日志参数有副作用时继续检查语义关系", () => {
    const left = side("a.ts", "run", "function run() { return 1; }", "function run() { console.log(updateState()); return 1; }");
    const right = side("b.ts", "call", "function call() { return run(); }", "function call() { return run() + 1; }");
    expect(classify(input(left, right))).toMatchObject({ zone: "grey", decision: "warn" });
  });
  test("只增加日志的调用方仍需满足变化后的签名", () => {
    const left = side("a.ts", "run", "function run(value: number) { return value; }", "function run(value: number, currency: string) { return value; }");
    const right = side("b.ts", "call", "function call() { return run(1); }", "function call() { console.log('audit'); return run(1); }");
    expect(classify(input(left, right))).toMatchObject({ zone: "black", decision: "lock", ruleId: "call-signature-incompatible" });
  });
  test("类方法片段支持日志白区与参数签名检查", () => {
    const log = side("a.ts", "apply", "apply(value: number) { return value; }", "apply(value: number) { console.log('audit'); return value; }", { kind: "method", container: "Rule" });
    const caller = side("b.ts", "call", "function call() { return rule.apply(1); }", "function call() { return rule.apply(2); }");
    expect(classify(input(log, caller))).toMatchObject({ ruleId: "observability-only", contractChanged: { left: false } });
  });
  test("箭头函数新增必填参数触发签名冲突", () => {
    const left = side("a.ts", "price", "export const price = (value: number) => value;", "export const price = (value: number, currency: string) => value;", { kind: "variable" });
    const right = side("b.ts", "call", "function call() { return price(1); }", "function call() { return price(2); }");
    expect(classify(input(left, right))).toMatchObject({ ruleId: "call-signature-incompatible" });
  });
  test("嵌套调用参数和剩余参数使用 AST 计数", () => {
    const left = side("a.ts", "price", "function price(value: number) { return value; }", "function price(value: number, currency: number, tax: number) { return value; }");
    const right = side("b.ts", "call", "function call() { return price(pair(1, 2)); }", "function call() { return price(pair(1, 2), 3, 4); }");
    expect(classify(input(left, right)).decision).toBe("warn");
    const rest = side("a.ts", "price", "function price(value: number, ...other: number[]) { return value; }", "function price(value: number, currency: string, ...other: number[]) { return value; }");
    const enough = side("b.ts", "call", "function call() { return price(1); }", "function call() { return price(2, 'USD'); }");
    expect(classify(input(rest, enough)).decision).toBe("warn");
  });
  test("字符串中的调用文本不参与签名判定", () => {
    const left = side("a.ts", "price", "function price(value: number) { return value; }", "function price(value: number, currency: string) { return value; }");
    const right = side("b.ts", "call", "function call() { return price; }", "function call() { const label = 'price()'; return price; }");
    expect(classify(input(left, right)).decision).toBe("warn");
  });
  test("返回对象简称属性变化参与删除规则和 T0 信息", () => {
    const left = side("a.ts", "result", "function result() { const total = 1; const label = 'x'; return { total, label }; }", "function result() { const total = 1; const label = 'x'; return { total }; }");
    const right = side("b.ts", "use", "function use() { return result().label; }", "function use() { return result().label + '!'; }");
    expect(classify(input(left, right))).toMatchObject({ ruleId: "consumed-return-property-removed", contractChanged: { left: true } });
  });
  test("取消运行时导出使跨文件调用失效", () => {
    const left = side("a.ts", "price", "export function price(value: number) { return value; }", "function price(value: number) { return value + 1; }");
    const right = side("b.ts", "call", "function call() { return price(1); }", "function call() { return price(2); }");
    expect(classify(input(left, right))).toMatchObject({ ruleId: "runtime-export-removed", contractChanged: { left: true } });
  });
  test("注释和空白修改命中白区", () => {
    const left = side("a.ts", "run", "function run() { return 1; }", "function run() { /* 说明 */ return 1; }");
    const right = side("b.ts", "call", "function call() { return run(); }", "function call() { return run(); }");
    expect(classify(input(left, right))).toMatchObject({ zone: "white", decision: "allow", ruleId: "comment-format-only" });
  });
  test("等价重构命中白区", () => {
    const left = side("a.ts", "run", "function run(value: number) { return value + 1; }", "function run(value: number) { const next = value + 1; return next; }");
    const right = side("b.ts", "call", "function call() { return run(1); }", "function call() { return run(2); }");
    expect(classify(input(left, right))).toMatchObject({ zone: "white", decision: "allow", ruleId: "equivalent-refactor" });
  });
  test.each([
    ["条件求值", "return enabled && record('value');", "const value = record('value'); return enabled && value;", false, [], ["value"]],
    ["调用顺序", "return record('first') + record('second');", "const value = record('second'); return record('first') + value;", true, ["first", "second"], ["second", "first"]]
  ])("改变%s的临时变量提取保留语义警告", (_name, beforeBody, afterBody, enabled, beforeCalls, afterCalls) => {
    const before = `export function run(enabled: boolean) { ${beforeBody} }`;
    const after = `export function run(enabled: boolean) { ${afterBody} }`;
    const execute = (source: string) => {
      const program = `const calls: string[] = []; function record(value: string) { calls.push(value); return value; } ${source}; run(${enabled}); export { calls };`;
      const output = ts.transpileModule(program, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
      const exports: { calls?: string[] } = {};
      runInNewContext(output, { exports });
      return Array.from(exports.calls!);
    };
    expect(execute(before)).toEqual(beforeCalls);
    expect(execute(after)).toEqual(afterCalls);
    const left = side("a.ts", "run", before, after);
    const right = side("b.ts", "call", "export function call() { return run(false); }", "export function call() { return run(true); }");
    const files = new MemoryFileProvider({ "a.ts": after, "b.ts": `import { run } from './a'; ${right.symbol.after}` });
    const index = createSemanticIndex({ files, now: () => 0 });
    index.update();
    expect(classify({ ...input(left, right), project: index })).toMatchObject({ zone: "grey", decision: "warn", ruleId: "semantic-interaction-uncertain" });
  });
  test("删除被引用符号命中黑区", () => {
    const left = side("a.ts", "run", "function run() { return 1; }", "", { status: "deleted" });
    const right = side("b.ts", "call", "function call() { return run(); }", "function call() { return run(); }");
    expect(classify(input(left, right))).toMatchObject({ zone: "black", decision: "lock", ruleId: "referenced-symbol-removed" });
  });
  test("删除返回属性命中黑区", () => {
    const left = side("a.ts", "result", "function result() { return { total: 1, label: 'x' }; }", "function result() { return { total: 1 }; }");
    const right = side("b.ts", "use", "function use() { return result().label; }", "function use() { return result().label; }");
    expect(classify(input(left, right))).toMatchObject({ zone: "black", decision: "lock", ruleId: "consumed-return-property-removed" });
  });
  test("无法解析的一侧命中灰区", () => {
    const left = side("a.ts", "run", "function run() { return 1; }", "function run( {");
    const right = side("b.ts", "call", "function call() { return run(); }", "function call() { return run(); }");
    expect(classify(input(left, right))).toMatchObject({ zone: "grey", decision: "warn", ruleId: "unparsable-side" });
  });
  test("类型关联且双方未修改类型声明时放行", () => {
    const left = side("a.ts", "use", "function use(value: Item) { return value; }", "function use(value: Item) { return value.id; }");
    const right = side("b.ts", "other", "function other(value: Item) { return value; }", "function other(value: Item) { return value; }");
    expect(classify({ ...input(left, right), typeOnly: true, path: { ...input(left, right).path!, typeOnly: true } })).toMatchObject({ zone: "white", ruleId: "type-only-unchanged" });
  });
  test("合并后新增类型错误进入黑区", () => {
    const left = side("pricing.ts", "formatMoney", "function formatMoney(): string { return '1'; }", "function formatMoney(): number { return 1; }");
    const right = side("checkout.ts", "checkout", "function checkout() { return formatMoney(); }", "function checkout() { return formatMoney().toUpperCase(); }");
    const result = classify({ ...input(left, right), project: { ...project, checkFourStates: () => ({ ran: true, durationMs: 4, mergeOnlyDiagnostics: ["2339:Property toUpperCase does not exist"] }) } });
    expect(result).toMatchObject({ zone: "black", decision: "lock", ruleId: "merge-only-type-error" });
  });
  test("四状态检查记录合并状态新增诊断", () => {
    const files = new Map([
      ["pricing.ts", "export function formatMoney(): string { return '1'; }"],
      ["checkout.ts", "import { formatMoney } from './pricing'; export function checkout() { return formatMoney(); }"]
    ]);
    const checker = createFourStateTypeChecker({ files: { listFiles: () => [...files.keys()], readFile: (file) => files.get(file)!, version: () => 1 }, now: () => 1 });
    const left = side("pricing.ts", "formatMoney", "export function formatMoney(): string { return '1'; }", "export function formatMoney(): number { return 1; }");
    const right = side("checkout.ts", "checkout", "import { formatMoney } from './pricing'; export function checkout() { return formatMoney(); }", "import { formatMoney } from './pricing'; export function checkout() { return formatMoney().toUpperCase(); }");
    const result = checker({ left, right, path: { from: left.symbol.key, to: right.symbol.key, hops: [{ from: left.symbol.key, to: right.symbol.key, kind: "call", direction: "forward" }], typeOnly: false } });
    expect(result.ran).toBe(true);
    expect(result.durationMs).toBeTypeOf("number");
    expect(result.mergeOnlyDiagnostics).toHaveLength(1);
  });
  test("四状态从当前共享文本中的符号范围构造，保留同文件的其他声明", () => {
    const left = side("shop.ts", "formatMoney", "export function formatMoney(): string { return '1'; }", "export function formatMoney(): number { return 100; }", { startLine: 2 });
    const right = side("shop.ts", "checkout", "export function checkout() { return formatMoney(); }", "export function checkout() { return formatMoney().toUpperCase(); }", { startLine: 3 });
    const merged = `export const sentinel = 123;\n${left.symbol.after}\n${right.symbol.after}\nexport function unrelated() { return true; }\n`;
    const files = new Map([["shop.ts", merged]]);
    const checker = createFourStateTypeChecker({ files: { listFiles: () => [...files.keys()], readFile: (file) => files.get(file)!, version: () => 1 }, now: () => 1 });
    const result = checker({ left, right, path: input(left, right).path });
    expect(result).toMatchObject({ ran: true });
    expect(result.mergeOnlyDiagnostics).toHaveLength(1);
    expect(result.mergeOnlyDiagnostics?.[0]).toContain("2339");
    expect(result.mergeOnlyDiagnostics?.[0]).toContain("toUpperCase");
    expect(files.get("shop.ts")).toBe(merged);
  });
  test("连续四状态检查读取非替换文件的新版本", () => {
    const left = side("pricing.ts", "price", "export function price(): string { return '1'; }", "export function price(): number { return 1; }");
    const right = side("checkout.ts", "checkout", "export function checkout() { return price(); }", "export function checkout() { return verify(price()); }");
    const files = new Map([
      ["pricing.ts", left.symbol.after],
      ["checkout.ts", `import { price } from './pricing'; import { verify } from './validation';\n${right.symbol.after}`],
      ["validation.ts", "export function verify(value: any) { return value; }"]
    ]);
    const versions = new Map([...files.keys()].map((file) => [file, 1]));
    const checker = createFourStateTypeChecker({ files: { listFiles: () => [...files.keys()], readFile: (file) => files.get(file)!, version: (file) => versions.get(file)! }, now: () => 1 });
    const request = { left, right, path: input(left, right).path };
    expect(checker(request).mergeOnlyDiagnostics).toEqual([]);
    files.set("validation.ts", "export function verify(value: string) { return value; }");
    versions.set("validation.ts", 2);
    expect(checker(request).mergeOnlyDiagnostics?.some((diagnostic) => diagnostic.includes("2345"))).toBe(true);
  });
  test("内部箭头函数变化不报告外部接口变化", () => {
    const change = side("a.ts", "run", "export function run(): number { const helper = () => 'x'; return 1; }", "export function run(): number { const helper = (value: string) => value; return 1; }").symbol;
    expect(symbolContractChanged(change)).toBe(false);
  });
  test("公开箭头函数属性的参数和返回类型变化报告外部接口变化", () => {
    const change = side("box.ts", "apply", "apply = (value: number): number => value;", "apply = (value: string): string => value;", { key: "box.ts#Box.apply", kind: "property", container: "Box" }).symbol;
    expect(symbolContractChanged(change)).toBe(true);
  });
  test("新增符号的空文本按新增处理", () => {
    const left = side("a.ts", "run", "", "export function run() { return 1; }", { status: "added" });
    const right = side("b.ts", "call", "function call() { return 1; }", "function call() { return run(); }");
    expect(classify(input(left, right)).ruleId).not.toBe("unparsable-side");
  });
  test("返回局部对象变量保留其属性集合", () => {
    const left = side("a.ts", "result", "function result() { return { total: 1, label: 'x' }; }", "function result() { const value = { total: 2, label: 'x' }; return value; }");
    const right = side("b.ts", "use", "function use() { return result().label; }", "function use() { return result().label + '!'; }");
    expect(classify(input(left, right)).ruleId).not.toBe("consumed-return-property-removed");
  });
  test("同一符号的类型关联仍然冻结", () => {
    const left = side("a.ts", "run", "function run() { return 1; }", "function run() { return 2; }");
    expect(classify({ ...input(left, { ...left, actor: { kind: "human", memberId: "b" } }), path: null, typeOnly: true }).ruleId).toBe("same-symbol-concurrent-write");
  });
  test("返回未知对象变量时保留返回属性的不确定性", () => {
    const left = side("a.ts", "result", "function result() { return { total: 1, label: 'x' }; }", "function result() { const value = readResult(); return value; }");
    const right = side("b.ts", "use", "function use() { return result().label; }", "function use() { return result().label + '!'; }");
    expect(classify(input(left, right)).ruleId).not.toBe("consumed-return-property-removed");
  });
  test("调用签名规则在返回属性规则之前求值", () => {
    const left = side("a.ts", "result", "function result() { return { total: 1, label: 'x' }; }", "function result(currency: string) { return { total: 2 }; }");
    const right = side("b.ts", "use", "function use() { return result().label; }", "function use() { return result().label + '!'; }");
    expect(classify(input(left, right)).ruleId).toBe("call-signature-incompatible");
  });
  test("接口新增必需成员冻结旧对象消费者", () => {
    const left = side("contract.ts", "Handler", "export interface Handler { run(): void; }", "export interface Handler { run(): void; stop(): void; }", { kind: "interface" });
    const right = side("consumer.ts", "createHandler", "function createHandler(): Handler { const handler: Handler = { run() {} }; return handler; }", "function createHandler(): Handler { const handler: Handler = { run() {} }; return handler; }");
    expect(classify({ ...input(left, right), typeOnly: true }).ruleId).toBe("interface-required-member-incompatible");
  });
});
