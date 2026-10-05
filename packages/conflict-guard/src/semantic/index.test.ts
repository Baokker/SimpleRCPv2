import { describe, expect, it } from "vitest";
import { createSemanticIndex } from "./index.js";
import type { SemanticFileProvider } from "./types.js";
import fs from "node:fs";

function shopFiles() {
  const root = new URL("../../../../demo/conflict-shop/src/", import.meta.url);
  return memoryFiles(Object.fromEntries(fs.readdirSync(root).filter((file) => file.endsWith(".ts")).map((file) => [`src/${file}`, fs.readFileSync(new URL(file, root), "utf8")])));
}

export function memoryFiles(sources: Record<string, string>) {
  const versions = new Map<string, number>();
  const provider: SemanticFileProvider = {
    listFiles: () => Object.keys(sources),
    readFile: (file) => sources[file]!,
    version: (file) => versions.get(file) ?? 0
  };
  return { provider, set(file: string, source: string) { sources[file] = source; versions.set(file, (versions.get(file) ?? 0) + 1); }, remove(file: string) { delete sources[file]; } };
}

describe("TypeScript 语义索引", () => {
  it("演示项目全部声明的键、种类与行号准确", () => {
    const files = shopFiles();
    const index = createSemanticIndex({ files: files.provider, now: () => performance.now() });
    index.update();
    const expected = {
      "src/cart.ts": [["Cart", "class", 4, 16], ["Cart.items", "property", 5, 5], ["Cart.add", "method", 7, 9], ["Cart.total", "method", 11, 15]],
      "src/checkout.ts": [["checkout", "function", 4, 6]],
      "src/index.ts": [],
      "src/pricing.ts": [["applyDiscount", "function", 3, 5], ["formatMoney", "function", 7, 9], ["PriceRule", "class", 11, 13], ["PriceRule.apply", "method", 12, 12], ["SeasonalRule", "class", 15, 17], ["SeasonalRule.apply", "method", 16, 16], ["defaultDiscount", "variable", 19, 19]],
      "src/report.ts": [["discountedReport", "function", 3, 5], ["reportTime", "function", 7, 9]],
      "src/types.ts": [["CartItem", "interface", 1, 5], ["CartItem.title", "property", 2, 2], ["CartItem.price", "property", 3, 3], ["CartItem.quantity", "property", 4, 4], ["Money", "type", 7, 7], ["Currency", "enum", 9, 9], ["DiscountRule", "interface", 11, 11], ["DiscountRule.apply", "method", 11, 11]]
    };
    for (const [file, declarations] of Object.entries(expected)) {
      expect(index.symbolsInFile(file).map(({ key, kind, startLine, endLine }) => [key, kind, startLine, endLine])).toEqual(declarations.map(([name, ...rest]) => [`${file}#${name}`, ...rest]));
    }
  });
  it("提取稳定声明键、重载后缀与准确行号", () => {
    const files = memoryFiles({ "src/cart.ts": "export class Cart {\n  items = 0;\n  total() { return this.items; }\n  get count() { return this.items; }\n  set count(value: number) { this.items = value; }\n}\nexport function price(value: string): number;\nexport function price(value: number): number;\nexport function price(value: string | number) { return 1; }\nexport const discount = (price: number) => price;\n" });
    const index = createSemanticIndex({ files: files.provider, now: () => performance.now() });
    index.update();
    expect(index.symbolsInFile("src/cart.ts").map(({ key, kind, startLine, endLine }) => ({ key, kind, startLine, endLine }))).toEqual([
      { key: "src/cart.ts#Cart", kind: "class", startLine: 1, endLine: 6 },
      { key: "src/cart.ts#Cart.items", kind: "property", startLine: 2, endLine: 2 },
      { key: "src/cart.ts#Cart.total", kind: "method", startLine: 3, endLine: 3 },
      { key: "src/cart.ts#Cart.count", kind: "accessor", startLine: 4, endLine: 4 },
      { key: "src/cart.ts#Cart.count@2", kind: "accessor", startLine: 5, endLine: 5 },
      { key: "src/cart.ts#price", kind: "function", startLine: 7, endLine: 7 },
      { key: "src/cart.ts#price@2", kind: "function", startLine: 8, endLine: 8 },
      { key: "src/cart.ts#price@3", kind: "function", startLine: 9, endLine: 9 },
      { key: "src/cart.ts#discount", kind: "variable", startLine: 10, endLine: 10 }
    ]);
    expect(index.symbolsInFile("src/cart.ts").find((symbol) => symbol.key === "src/cart.ts#Cart.total")?.exported).toBe(false);
    const total = files.provider.readFile("src/cart.ts").indexOf("return this.items");
    expect(index.symbolsInRange("src/cart.ts", total, total + 6).map((symbol) => symbol.key)).toEqual(["src/cart.ts#Cart.total"]);
  });

  it("记录全部关系种类与重导出路径", () => {
    const files = shopFiles();
    const index = createSemanticIndex({ files: files.provider, now: () => performance.now() });
    index.update();
    const edges = files.provider.listFiles().flatMap((file) => index.symbolsInFile(file).flatMap((symbol) => index.outgoing(symbol.key)));
    expect(new Set(edges.map((edge) => edge.kind))).toEqual(new Set(["call", "value-reference", "type-reference", "inheritance", "implementation", "state-read", "state-write", "contains", "override", "implements-member"]));
    expect(index.outgoing("src/report.ts#discountedReport")).toContainEqual({ from: "src/report.ts#discountedReport", to: "src/pricing.ts#applyDiscount", kind: "call", via: ["src/index.ts"] });
    expect(index.incoming("src/pricing.ts#applyDiscount")).toContainEqual({ from: "src/cart.ts#Cart.total", to: "src/pricing.ts#applyDiscount", kind: "call", via: [] });
    expect(index.findPaths(["src/checkout.ts#checkout"], ["src/pricing.ts#applyDiscount"], 1)).toEqual([]);
    expect(index.findPaths(["src/checkout.ts#checkout"], ["src/pricing.ts#applyDiscount"], 2)).toEqual([{ from: "src/checkout.ts#checkout", to: "src/pricing.ts#applyDiscount", hops: [
      { from: "src/checkout.ts#checkout", to: "src/cart.ts#Cart.total", kind: "call", direction: "forward" },
      { from: "src/cart.ts#Cart.total", to: "src/pricing.ts#applyDiscount", kind: "call", direction: "forward" }
    ], typeOnly: false }]);
    expect(index.findPaths(["src/pricing.ts#applyDiscount"], ["src/checkout.ts#checkout"])[0]?.hops.map((hop) => hop.direction)).toEqual(["backward", "backward"]);
  });

  it("增量更新修改文件与直接引用者，结果与全量一致", () => {
    const files = shopFiles();
    const index = createSemanticIndex({ files: files.provider, now: () => performance.now() });
    index.update();
    files.set("src/pricing.ts", files.provider.readFile("src/pricing.ts").replace("price * (1 - rate)", "price - price * rate"));
    const result = index.update(["src/pricing.ts"]);
    expect(result.files).toBe(4);
    expect(result.full).toBe(false);
    const rebuilt = createSemanticIndex({ files: files.provider, now: () => performance.now() });
    rebuilt.update();
    for (const file of files.provider.listFiles()) {
      expect(index.symbolsInFile(file)).toEqual(rebuilt.symbolsInFile(file));
      for (const symbol of index.symbolsInFile(file)) expect(index.outgoing(symbol.key)).toEqual(rebuilt.outgoing(symbol.key));
    }
  });

  it("更新新增与删除文件并报告文件上限", () => {
    const files = memoryFiles({ "src/a.ts": "export function a() { return 1; }", "node_modules/ignored.ts": "export const ignored = 1;", "dist/output.js": "export const output = 1;" });
    const index = createSemanticIndex({ files: files.provider, now: () => performance.now(), maxFiles: 1 });
    index.update();
    expect(index.stats()).toEqual({ files: 1, symbols: 1, edges: 0, truncated: false });
    files.set("src/b.ts", "export const b = 2;");
    index.update(["src/b.ts"]);
    expect(index.stats().truncated).toBe(true);
    files.remove("src/a.ts");
    index.update(["src/a.ts"]);
    expect(index.symbolsInFile("src/a.ts")).toEqual([]);
    expect(index.symbolsInFile("src/b.ts")[0]?.key).toBe("src/b.ts#b");
  });

  it("文件删除后增量索引不读取已经不存在的版本", () => {
    const files = memoryFiles({ "src/a.ts": "export function a() { return 1; }", "src/b.ts": "export function b() { return 2; }" });
    const index = createSemanticIndex({ files: files.provider, now: () => performance.now() });
    index.update();
    files.remove("src/a.ts");
    expect(() => index.update(["src/a.ts"])).not.toThrow();
    expect(index.symbolsInFile("src/a.ts")).toEqual([]);
    expect(index.stats().files).toBe(1);
  });

  it("新增文件满足未解析 import，删除及重命名后与全量一致", () => {
    const files = memoryFiles({ "consumer.ts": "import { price } from './pricing'; export function total() { return price(); }" });
    const index = createSemanticIndex({ files: files.provider, now: () => performance.now() });
    index.update();
    files.set("pricing.ts", "export function price() { return 1; }");
    index.update(["pricing.ts"]);
    expect(index.outgoing("consumer.ts#total")).toContainEqual({ from: "consumer.ts#total", to: "pricing.ts#price", kind: "call", via: [] });
    files.remove("pricing.ts");
    files.set("renamed.ts", "export function price() { return 1; }");
    files.set("consumer.ts", "import { price } from './renamed'; export function total() { return price(); }");
    index.update(["pricing.ts", "renamed.ts", "consumer.ts"]);
    const rebuilt = createSemanticIndex({ files: files.provider, now: () => performance.now() });
    rebuilt.update();
    expect(index.outgoing("consumer.ts#total")).toEqual(rebuilt.outgoing("consumer.ts#total"));
    expect(index.symbolsInFile("pricing.ts")).toEqual([]);
  });

  it("新增引用文件及修改既有引用文件时使用当前声明节点", () => {
    const files = memoryFiles({ "a.ts": "export function a() { return 1; }", "b.ts": "import { a } from './a'; export function b() { return a(); }" });
    const index = createSemanticIndex({ files: files.provider, now: () => performance.now() });
    index.update();
    files.set("z.ts", "import { a } from './a'; export function z() { return a(); }");
    index.update(["z.ts"]);
    expect(index.outgoing("z.ts#z")).toContainEqual({ from: "z.ts#z", to: "a.ts#a", kind: "call", via: [] });
    files.set("b.ts", "import { a } from './a'; export function b() { return a() + 1; }");
    index.update(["b.ts"]);
    const rebuilt = createSemanticIndex({ files: files.provider, now: () => performance.now() });
    rebuilt.update();
    for (const file of files.provider.listFiles()) for (const symbol of index.symbolsInFile(file)) expect(index.outgoing(symbol.key)).toEqual(rebuilt.outgoing(symbol.key));
  });

  it("多层 export * 保留每个重导出文件及其增量更新关系", () => {
    const files = memoryFiles({ "pricing.ts": "export function price() { return 1; }", "middle.ts": "export * from './pricing';", "index.ts": "export * from './middle';", "consumer.ts": "import { price } from './index'; export function total() { return price(); }", "namespace.ts": "import * as shop from './index'; export function total() { return shop.price(); }" });
    const index = createSemanticIndex({ files: files.provider, now: () => performance.now() });
    index.update();
    expect(index.outgoing("consumer.ts#total")).toEqual([{ from: "consumer.ts#total", to: "pricing.ts#price", kind: "call", via: ["index.ts", "middle.ts"] }]);
    expect(index.outgoing("namespace.ts#total")).toEqual([{ from: "namespace.ts#total", to: "pricing.ts#price", kind: "call", via: ["index.ts", "middle.ts"] }]);
    files.set("middle.ts", "export function price() { return 2; }");
    index.update(["middle.ts"]);
    expect(index.outgoing("consumer.ts#total")).toEqual([{ from: "consumer.ts#total", to: "middle.ts#price", kind: "call", via: ["index.ts"] }]);
    expect(index.outgoing("namespace.ts#total")).toEqual([{ from: "namespace.ts#total", to: "middle.ts#price", kind: "call", via: ["index.ts"] }]);
  });

  it("推断返回类型新增属性时重算直接使用该类型的文件", () => {
    const files = memoryFiles({ "a.ts": "export class A {}", "b.ts": "import { A } from './a'; export function make() { return new A(); }", "c.ts": "import { make } from './b'; export function read() { return make().fresh; }" });
    const index = createSemanticIndex({ files: files.provider, now: () => performance.now() });
    index.update();
    files.set("a.ts", "export class A { fresh = 1; }");
    index.update(["a.ts"]);
    const rebuilt = createSemanticIndex({ files: files.provider, now: () => performance.now() });
    rebuilt.update();
    expect(index.outgoing("c.ts#read")).toEqual(rebuilt.outgoing("c.ts#read"));
    expect(index.outgoing("c.ts#read")).toContainEqual({ from: "c.ts#read", to: "a.ts#A.fresh", kind: "state-read", via: [] });
  });

  it("推断类型的继承来源与 mapped type 参数参与增量依赖", () => {
    for (const signature of ["A", "Copy<A>", "A & { known: number }"]) {
      const files = memoryFiles({ "base.ts": "export class Base {}", "a.ts": "import { Base } from './base'; export class A extends Base {}", "b.ts": `import { A } from './a'; type Copy<T> = { [K in keyof T]: T[K] }; export function make(): ${signature} { return new A() as ${signature}; }`, "c.ts": "import { make } from './b'; export function read() { return make().fresh; }" });
      const index = createSemanticIndex({ files: files.provider, now: () => performance.now() });
      index.update();
      files.set("base.ts", "export class Base { fresh = 1; }");
      index.update(["base.ts"]);
      const rebuilt = createSemanticIndex({ files: files.provider, now: () => performance.now() });
      rebuilt.update();
      expect(index.outgoing("c.ts#read")).toEqual(rebuilt.outgoing("c.ts#read"));
      expect(index.outgoing("c.ts#read").some((edge) => edge.to === "base.ts#Base.fresh" && edge.kind === "state-read")).toBe(true);
    }
  });

  it("随机混合版本变化时增量结果与全量结果一致", () => {
    for (let seed = 1; seed <= 5; seed += 1) {
      const files = memoryFiles({
        "src/a.ts": "export function a() { return 1; }",
        "src/b.ts": "import { a } from './a'; export function b() { return a(); }",
        "src/c.ts": "import { b } from './b'; export function c() { return b(); }",
        "src/d.ts": "export const d = 1;"
      });
      const index = createSemanticIndex({ files: files.provider, now: () => performance.now() });
      index.update();
      let state = seed;
      for (let step = 0; step < 12; step += 1) {
        state = (state * 1664525 + 1013904223) >>> 0;
        const file = ["src/a.ts", "src/b.ts", "src/c.ts", "src/d.ts"][state % 4]!;
        const value = state % 10;
        const source = file === "src/a.ts"
          ? `export function a() { return ${value}; }`
          : file === "src/b.ts"
            ? `import { a } from './a'; export function b() { return a() + ${value}; }`
            : file === "src/c.ts"
              ? `import { b } from './b'; export function c() { return b() + ${value}; }`
              : `export const d = ${value};`;
        files.set(file, source);
        index.update(step % 2 === 0 ? [file] : []);
        const rebuilt = createSemanticIndex({ files: files.provider, now: () => performance.now() });
        rebuilt.update();
        for (const currentFile of files.provider.listFiles()) {
          expect(index.symbolsInFile(currentFile)).toEqual(rebuilt.symbolsInFile(currentFile));
          for (const symbol of index.symbolsInFile(currentFile)) expect(index.outgoing(symbol.key)).toEqual(rebuilt.outgoing(symbol.key));
        }
      }
    }
  });

  it("记录三百个文件的全量索引耗时", () => {
    const sources = Object.fromEntries(Array.from({ length: 300 }, (_, index) => {
      const previous = index === 0 ? "" : `import { value${index - 1} } from './file-${index - 1}';\n`;
      return [`src/file-${index}.ts`, `${previous}export const value${index} = ${index}${index === 0 ? "" : ` + value${index - 1}`};\n`];
    }));
    const files = memoryFiles(sources);
    const index = createSemanticIndex({ files: files.provider, now: () => performance.now() });
    const update = index.update();
    console.log(JSON.stringify({ semanticSyntheticPerformance: { files: update.files, durationMs: update.durationMs } }));
    expect(index.stats().files).toBe(300);
  });
});
