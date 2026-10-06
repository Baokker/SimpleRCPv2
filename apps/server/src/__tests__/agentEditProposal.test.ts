import fs from "node:fs/promises";
import path from "node:path";
import { createPatch } from "diff";
import { afterEach, expect, it } from "vitest";
import { reconstructAgentEdit } from "../agent/conflictGuardEditHandler.js";
import { createTestWorkspace } from "./testWorkspace.js";
const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true }))); });

it("reconstructs an OpenCode edit and rejects a diff whose baseline has changed", async () => {
  const root = await createTestWorkspace("agent-edit-proposal-"); roots.push(root);
  const before = "export const amount = 10;\n";
  const after = "export const amount = 20;\n";
  await fs.writeFile(path.join(root, "pricing.ts"), before);
  const metadata = { filepath: path.join(root, "pricing.ts"), diff: createPatch("pricing.ts", before, after) };
  expect(await reconstructAgentEdit(root, metadata)).toEqual([{ file: "pricing.ts", before, after, existedBefore: true }]);
  await fs.writeFile(path.join(root, "pricing.ts"), "export const amount = 30;\n");
  await expect(reconstructAgentEdit(root, metadata)).rejects.toThrow("原文与修改提案不匹配");
});

it("reconstructs multiple patch files including additions and rejects an escaping path", async () => {
  const root = await createTestWorkspace("agent-multi-proposal-"); roots.push(root);
  const diff = createPatch("added.ts", "", "export const added = true;\n");
  expect(await reconstructAgentEdit(root, { files: [{ filePath: "added.ts", diff }] })).toEqual([{ file: "added.ts", before: "", after: "export const added = true;\n", existedBefore: false }]);
  await expect(reconstructAgentEdit(root, { filepath: "../secret.ts", diff })).rejects.toThrow();
});

it("accepts canonical OpenCode paths through a workspace symlink and rejects external symlinks", async () => {
  const root = await createTestWorkspace("agent-symlink-"); roots.push(root);
  const workspace = path.join(root, "linked");
  const actual = path.join(root, "actual");
  await fs.mkdir(actual);
  await fs.symlink(actual, workspace, "dir");
  const before = "export const value = 1;\n";
  const after = "export const value = 2;\n";
  await fs.writeFile(path.join(actual, "value.ts"), before);
  expect(await reconstructAgentEdit(workspace, { filepath: path.join(actual, "value.ts"), diff: createPatch("value.ts", before, after) })).toEqual([{ file: "value.ts", before, after, existedBefore: true }]);
  const addition = await reconstructAgentEdit(workspace, { filepath: path.join(actual, "new", "nested", "value.ts"), diff: createPatch("value.ts", "", after) });
  expect(addition[0]?.file).toBe("new/nested/value.ts");
  await fs.symlink(root, path.join(actual, "external"), "dir");
  await expect(reconstructAgentEdit(workspace, { filepath: "external/secret.ts", diff: createPatch("secret.ts", "", after) })).rejects.toThrow("请求路径超出工作区范围");
});

it("reconstructs a deeply indented trimDiff and prefers exact tool input", async () => {
  const root = await createTestWorkspace("agent-trim-diff-"); roots.push(root);
  const before = "function example() {\n    if (true) {\n        const first = 1;\n        const second = 2;\n        const third = 3;\n    }\n}\n";
  await fs.writeFile(path.join(root, "example.ts"), before);
  const diff = "--- example.ts\n+++ example.ts\n@@ -3,3 +3,3 @@\n const first = 1;\n-const second = 2;\n+const second = 20;\n const third = 3;\n";
  expect((await reconstructAgentEdit(root, { filepath: "example.ts", diff }))[0]?.after).toBe(before.replace("second = 2", "second = 20"));
  expect((await reconstructAgentEdit(root, { filepath: "example.ts", diff }, { tool: "edit", input: { oldString: "        const second = 2;", newString: "        const second = 30;" } }))[0]?.after).toBe(before.replace("second = 2", "second = 30"));
});

it("accepts the OpenCode apply_patch metadata patch field", async () => {
  const root = await createTestWorkspace("agent-patch-"); roots.push(root);
  const after = "export const value = 1;\n";
  expect(await reconstructAgentEdit(root, { files: [{ filePath: "value.ts", relativePath: "value.ts", type: "add", patch: createPatch("value.ts", "", after) }] })).toEqual([{ file: "value.ts", before: "", after, existedBefore: false }]);
});
