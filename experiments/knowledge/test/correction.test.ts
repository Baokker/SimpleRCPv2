import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import path from "node:path";
import {benchRoot, readJson, root, exec, type Dataset} from "../common.js";
import {correctionReferenceFiles} from "../k4.js";
import {judge} from "../client.js";

test("六对迁移的参考修订生成通过行为判定的文件", {timeout: 240000}, async () => {
  for (const id of ["P01", "P02", "P03", "P04", "P05", "P06"]) {
    const directory = path.join(benchRoot, "transfer/pairs", id);
    const ta = await readJson(path.join(directory, "ta/task.json"));
    const pair = {id, directory, ta: {...ta, directory: path.join(directory, "ta")}, correction: await readJson(path.join(directory, "correction.json"))} as Dataset["transfers"][number];
    const workspace = path.join(root, ".work", `correction-${process.pid}-${id}`);
    await fs.cp(path.join(benchRoot, "repos", ta.repository), workspace, {recursive: true, filter: source => !source.split(path.sep).includes("node_modules")});
    await exec("npm", ["ci", "--ignore-scripts", "--no-audit", "--no-fund"], {cwd: workspace, timeout: 60000});
    const files = await correctionReferenceFiles(pair);
    assert.ok(files.length > 0);
    for (const file of files) {
      await fs.mkdir(path.dirname(path.join(workspace, file.file)), {recursive: true});
      await fs.writeFile(path.join(workspace, file.file), file.afterText);
    }
    const result = await judge(pair.ta, workspace, path.join(workspace, ".result"));
    assert.equal(result.jointSuccess, true, id);
    await fs.rm(workspace, {recursive: true});
  }
});
