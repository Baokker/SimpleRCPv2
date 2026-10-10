import {describe, expect, test} from "vitest";
import {createPatch} from "diff";
import {compactRecapEvidence, correctedIdentifiers, correctedSymbolBindings, parseAgentRecapDraft, recapFileVersions, validateRecapCheck, buildAgentRecapSystemPrompt, listEvidencePaths, citationExists} from "../src/index.js";

const file = "src/session.ts";
const beforeText = "export function setup(state) { return state; }\n";
const afterText = "export function sharedHelper(state) { return state; }\n";
const evidence = {correctionFiles: [{file, beforeText, afterText}]};

describe("复盘代码证据", () => {
  test("发送的代码片段遵守预算，原始版本保留用于检查验证", () => {
    const long = {correctionFiles: [{file, beforeText: beforeText + "// unchanged context\n".repeat(100), afterText: afterText + "// unchanged context\n".repeat(100)}], symbolSources: {[file]: afterText}};
    const prompt = compactRecapEvidence(long);
    const versions = recapFileVersions(prompt);
    expect(versions[0].beforeText.length + versions[0].afterText.length).toBeLessThanOrEqual(800);
    expect(prompt.symbolSources).toBeUndefined();
    expect(correctedIdentifiers(prompt)).toContain("sharedHelper");
    expect(listEvidencePaths(prompt).filter(path => !path.includes("excerpt") && !path.includes("correctedIdentifier") && !path.includes("correctedBindings")).every(path => citationExists(path, long))).toBe(true);
    expect(validateRecapCheck({kind: "regex-present", pattern: "sharedHelper", fileGlob: file}, long).retained).toBe(true);
    expect(recapFileVersions(long)[0].afterText.length).toBeGreaterThan(800);
  });
  test("提示词中的文件证据路径可以完整解析", () => {
    const sourceEvidence = {...evidence, symbolSources: {"src/storage/inventory-store.ts": "export class InventoryStore {}", 'src/quoted"name.ts': "export const value = 1;"}};
    const paths = listEvidencePaths(sourceEvidence);
    expect(paths).toContain('evidence.symbolSources["src/storage/inventory-store.ts"]');
    expect(paths.every(path => citationExists(path, sourceEvidence))).toBe(true);
    for (const path of ["evidence.correctionFiles[0].afterText", "correctionFiles.0.afterText", "`correctionFiles[0].afterText`", 'symbolSources["src/storage/inventory-store.ts"]']) expect(citationExists(path, sourceEvidence)).toBe(true);
    expect(citationExists("evidence.symbolSources.missing", sourceEvidence)).toBe(false);
    const parsed = parseAgentRecapDraft(JSON.stringify({type: "constraint", title: "保留事务入口", summary: "InventoryStore 的事务入口需要保留", whatHappened: "Agent 修改了库存服务", correction: "成员保留事务入口", rule: "保留 InventoryStore.transaction", appliesTo: {files: [file], globs: [], taskKinds: []}, notApplicable: "其他文件需要确认", scopeSuggestion: {scope: "team", reason: "团队库存约束"}, confidence: 0.9, evidenceCitations: ['evidence.symbolSources["src/storage/inventory-store.ts"]'], unknowns: []}), sourceEvidence);
    expect(parsed?.evidenceCitations).toEqual(['evidence.symbolSources["src/storage/inventory-store.ts"]']);
  });
  test("长函数末尾的纠正仍然出现在模型证据中", () => {
    const prefix = "export function updateInventory() {\n" + "  const unchanged = 1;\n".repeat(100);
    const long = {correctionFiles: [{file, beforeText: prefix + "  return unsafeUpdate();\n}\n", afterText: prefix + "  return InventoryStore.transaction();\n}\n"}]};
    const [version] = recapFileVersions(compactRecapEvidence(long));
    expect(version.beforeText).toContain("unsafeUpdate");
    expect(version.afterText).toContain("InventoryStore.transaction");
    expect(version.beforeText.length + version.afterText.length).toBeLessThanOrEqual(800);
  });
  test("长 diff 摘要保留每份文件的修改位置", () => {
    const previousDiff = createPatch("first.ts", "", "firstChange();\n".repeat(100)) + createPatch("last.ts", "", "lastChange();\n");
    const prompt = compactRecapEvidence({previousDiff});
    expect(String(prompt.previousDiff)).toContain("first.ts");
    expect(String(prompt.previousDiff)).toContain("last.ts");
    expect(String(prompt.previousDiff)).toContain("lastChange");
    expect(String(prompt.previousDiff).length).toBeLessThanOrEqual(800);
  });
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
