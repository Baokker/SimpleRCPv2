import { describe, expect, it } from "vitest";
import { createSemanticIndex } from "./index.js";
import { mapSymbolChanges, deletedSymbolKeys } from "./changes.js";
import type { FileChange, TextEdit } from "../model/types.js";

describe("符号级变更", () => {
  it("使用成员基线映射修改、新增和删除声明", () => {
    const baseText = "export function changed() { return 1; }\nexport function removed() { return 2; }\n";
    const after = "export function changed() { return 3; }\nexport function added() { return 4; }\n";
    const file = "src/a.ts";
    const index = createSemanticIndex({ files: { listFiles: () => [file], readFile: () => after, version: () => 1 }, now: () => performance.now() });
    index.update();
    const edit: TextEdit = { file, origin: { kind: "human", memberId: "alice" }, at: 10, revisionAfter: 1, textBefore: baseText, textAfter: after, ops: [{ from: 0, deleted: baseText, inserted: after }] };
    const change: FileChange = { file, baseText, ranges: [{ start: 0, end: after.length }], firstTouchedAt: 10, lastTouchedAt: 10, deletedSymbolKeys: deletedSymbolKeys(edit) };
    expect(mapSymbolChanges(change, after, index).map(({ key, status, before, after }) => ({ key, status, before, after }))).toEqual([
      { key: "src/a.ts#changed", status: "modified", before: "export function changed() { return 1; }", after: "export function changed() { return 3; }" },
      { key: "src/a.ts#added", status: "added", before: "", after: "export function added() { return 4; }" },
      { key: "src/a.ts#removed", status: "deleted", before: "export function removed() { return 2; }", after: "" }
    ]);
  });

  it("省略相同文本，删除归属要求本人删除声明名称", () => {
    const baseText = "export function keep() { return 1; }\n";
    const index = createSemanticIndex({ files: { listFiles: () => ["a.ts"], readFile: () => baseText, version: () => 1 }, now: () => performance.now() });
    index.update();
    const change: FileChange = { file: "a.ts", baseText, ranges: [{ start: 0, end: baseText.length }], firstTouchedAt: 0, lastTouchedAt: 1 };
    expect(mapSymbolChanges(change, baseText, index)).toEqual([]);
    const emptyIndex = createSemanticIndex({ files: { listFiles: () => ["a.ts"], readFile: () => "", version: () => 2 }, now: () => performance.now() });
    emptyIndex.update();
    expect(mapSymbolChanges(change, "", emptyIndex)).toEqual([]);
    expect(mapSymbolChanges({ ...change, deletedSymbolKeys: ["a.ts#keep"] }, "", emptyIndex)[0]?.status).toBe("deleted");
  });

  it("非 TS 与 JS 文件不产生符号变更", () => {
    const text = "function hello() {}";
    const edit: TextEdit = { file: "readme.md", origin: { kind: "human", memberId: "alice" }, at: 0, revisionAfter: 1, textBefore: text, textAfter: "", ops: [{ from: 0, deleted: text, inserted: "" }] };
    expect(deletedSymbolKeys(edit)).toEqual([]);
    const index = createSemanticIndex({ files: { listFiles: () => [], readFile: () => "", version: () => 0 }, now: () => 0 });
    index.update();
    expect(mapSymbolChanges({ file: edit.file, baseText: text, ranges: [{ start: 0, end: 0 }], firstTouchedAt: 0, lastTouchedAt: 0, deletedSymbolKeys: ["readme.md#hello"] }, "", index)).toEqual([]);
  });
});
