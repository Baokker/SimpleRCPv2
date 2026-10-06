import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { lstatSync, realpathSync } from "node:fs";
import path from "node:path";

function inside(root: string, target: string) {
  const relative = path.relative(root, target);
  return relative !== "" && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

export function assertRepositoryPath(repository: string, target: string) {
  const resolved = path.resolve(target);
  assert(inside(repository, resolved), "路径必须位于当前仓库");
  const missing: string[] = [];
  let parent = resolved;
  while (!lstatSync(parent, { throwIfNoEntry: false })) {
    missing.unshift(path.basename(parent));
    parent = path.dirname(parent);
  }
  const physical = path.resolve(realpathSync(parent), ...missing);
  assert(inside(realpathSync(repository), physical), "真实路径必须位于当前仓库");
}

export async function checkWorkingCopy(repository: string, file: string, archived: string) {
  const target = path.join(repository, file);
  assertRepositoryPath(repository, target);
  if (lstatSync(target, { throwIfNoEntry: false })) {
    assert.equal(await fs.readFile(target, "utf8"), archived, `工作副本与归档不一致 ${file}`);
  }
  return Buffer.from(archived);
}
