import {describe, expect, test} from "vitest";
import {createPatch} from "diff";
import {correctedIdentifiers, correctedSymbolBindings, parseAgentRecapDraft, recapFileVersions, validateRecapCheck, buildAgentRecapSystemPrompt} from "../src/index.js";

const file = "src/session.ts";
const beforeText = "export function setup(state) { return state; }\n";
const afterText = "export function sharedHelper(state) { return state; }\n";
const evidence = {correctionFiles: [{file, beforeText, afterText}]};

describe("复盘代码证据", () => {
  test("检查只保留能够区分纠正前后版本的方向", () => {
    expect(validateRecapCheck({kind: "regex-present", pattern: "sharedHelper", fileGlob: "src/*.ts"}, evidence).retained).toBe(true);
    for (const check of [
      {kind: "regex-absent" as const, pattern: "sharedHelper", fileGlob: "src/*.ts"},
      {kind: "regex-present" as const, pattern: "sharedHelper", fileGlob: "test/*.ts"},
      {kind: "regex-present" as const, pattern: "\\+export function sharedHelper", fileGlob: "src/*.ts"}
    ]) expect(validateRecapCheck(check, evidence).retained).toBe(false);
    expect(validateRecapCheck({kind: "regex-present", pattern: "sharedHelper", fileGlob: file}, {}).retained).toBe(false);
    const parsed = parseAgentRecapDraft(JSON.stringify({type: "constraint", title: "保留函数", summary: "保留共享函数 sharedHelper", whatHappened: "Agent 使用 setup", correction: "成员恢复 sharedHelper", rule: "保留 sharedHelper", appliesTo: {files: [file], globs: [], taskKinds: []}, notApplicable: "其他文件需要确认", scopeSuggestion: {scope: "team", reason: "共享函数约束"}, checkSuggestion: {kind: "regex-absent", pattern: "sharedHelper", fileGlob: file}, confidence: 0.9, evidenceCitations: ["correctionFiles[0].afterText"], unknowns: []}), evidence)!;
    expect(parsed.checkSuggestion).toBeUndefined();
    expect(parsed.checkValidation?.retained).toBe(false);
    expect(parsed.unknowns).toContain("自动检查未通过验证，已移除");
    const invalid = parseAgentRecapDraft(JSON.stringify({...parsed, checkSuggestion: {kind: "regex-present", pattern: "[", fileGlob: file}}), evidence)!;
    expect(invalid.rule).toBe(parsed.rule);
    expect(invalid.checkSuggestion).toBeUndefined();
    expect(invalid.checkValidation?.reason).toBe("invalid-pattern");
  });

  test("diff 使用现有库解析，代码候选来自 TypeScript AST", () => {
    const diffEvidence = {previousDiff: createPatch(file, "", beforeText), correctedDiff: createPatch(file, "", afterText)};
    expect(correctedIdentifiers(evidence)).toContain("sharedHelper");
    expect(buildAgentRecapSystemPrompt(evidence)).toContain("sharedHelper");
    const newFileEvidence = {previousDiff: createPatch(file, "", beforeText).replace(`--- ${file}`, "--- /dev/null"), correctedDiff: createPatch(file, "", afterText).replace(`--- ${file}`, "--- /dev/null")};
    expect(recapFileVersions(newFileEvidence)).toEqual([{file, beforeText, afterText}]);
    expect(correctedIdentifiers(diffEvidence)).toContain("sharedHelper");
    expect(correctedIdentifiers({correctedDiff: createPatch(file, "", "service.store.transaction(value => value);\n")})).toContain("service.store.transaction");
  });

  test("代码调用使用 TypeScript 类型归属生成候选", () => {
    const source = "class InventoryStore { transaction() {} }\nconst store = new InventoryStore(); store.transaction();";
    const typed = {correctionFiles: [{file, beforeText: "", afterText: source}], symbolSources: {[file]: source}};
    expect(correctedSymbolBindings(typed)).toContainEqual({expression: "store.transaction", identifier: "InventoryStore.transaction"});
    expect(buildAgentRecapSystemPrompt(typed)).toContain("InventoryStore.transaction");
  });
});
