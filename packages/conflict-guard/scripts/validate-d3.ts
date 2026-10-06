import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const repository = fileURLToPath(new URL("../../../", import.meta.url));
const dataset = path.join(repository, "packages/conflict-guard/bench/datasets/d3-v0");
const manifest = JSON.parse(await fs.readFile(path.join(dataset, "manifest.json"), "utf8"));
const execute = promisify(execFile);
const projects = [...new Set<string>(manifest.tasks.map((task: { project: string }) => task.project))];
const seeds = [];
for (const project of projects) {
  const root = path.resolve(dataset, manifest.seedRoot, project);
  const tests = (await fs.readdir(path.join(root, "test"))).filter((file) => file.endsWith(".test.ts"));
  const result = await execute(process.execPath, ["--experimental-strip-types", "--test", ...tests.map((file) => path.join(root, "test", file))], { cwd: root });
  seeds.push({ project, passed: true, tests: tests.length, output: result.stdout });
}
const tasks = [];
for (const task of manifest.tasks) {
  const root = path.resolve(dataset, manifest.seedRoot, task.project);
  for (const file of task.files) await fs.access(path.join(root, file));
  let baselineFails = false;
  try { await execute(process.execPath, ["--experimental-strip-types", "--test", path.join(dataset, manifest.acceptance)], { cwd: root, env: { ...process.env, D3_TASK: task.id, D3_WORKSPACE: root } }); }
  catch (error) { if ((error as { code?: number }).code !== 1) throw error; baselineFails = true; }
  if (!baselineFails) throw new Error(`Acceptance already passes before task: ${task.id}`);
  tasks.push({ id: task.id, ownership: task.ownership, baselineFails });
}
const evidence = path.join(repository, "docs/conflict-guard/evidence/stage-7-smoke");
await fs.mkdir(evidence, { recursive: true });
await fs.writeFile(path.join(evidence, "dataset-validation.json"), JSON.stringify({ version: manifest.version, seeds, tasks }, null, 2) + "\n");
console.log(JSON.stringify({ seedProjects: seeds.length, tasks: tasks.length, crossOwner: tasks.filter((task) => task.ownership === "cross").length, sameOwner: tasks.filter((task) => task.ownership === "same").length }));
