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
  await expect(reconstructAgentEdit(root, metadata)).rejects.toThrow("baseline");
});

it("reconstructs multiple patch files including additions and rejects an escaping path", async () => {
  const root = await createTestWorkspace("agent-multi-proposal-"); roots.push(root);
  const diff = createPatch("added.ts", "", "export const added = true;\n");
  expect(await reconstructAgentEdit(root, { files: [{ filePath: "added.ts", diff }] })).toEqual([{ file: "added.ts", before: "", after: "export const added = true;\n", existedBefore: false }]);
  await expect(reconstructAgentEdit(root, { filepath: "../secret.ts", diff })).rejects.toThrow();
});
