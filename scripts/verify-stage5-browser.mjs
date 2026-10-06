import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const work = path.join(root, ".test-workspaces/stage5-browser");
await fs.mkdir(work, { recursive: true });
const cases = [
  { name: "regression-rules", args: ["test:e2e"], env: { CONFLICT_GUARD: "rules", SIMPLERCP_AGENT_MAX_CONCURRENT_RUNS: "1" } },
  ...["off", "observe", "rules"].map((mode) => ({ name: `collab-${mode}`, args: ["test:collab"], env: { CONFLICT_GUARD: mode } })),
  { name: "model-normal", args: ["test:e2e", "tests/e2e/conflict-guard-adjudication.spec.ts"], env: { CONFLICT_GUARD: "full", SIMPLERCP_STAGE5_LIVE: "1" } },
  { name: "model-failure-G3", args: ["test:e2e", "tests/e2e/conflict-guard-adjudication.spec.ts"], env: { CONFLICT_GUARD: "full", SIMPLERCP_STAGE5_LIVE: "1", SIMPLERCP_STAGE5_FAILURE: "1", TYPESAFE_API_KEY: "stage5-invalid-credential", DEEPSEEK_API_KEY: "stage5-invalid-credential" } },
  { name: "model-failure-G2", args: ["test:e2e", "tests/e2e/conflict-guard-adjudication.spec.ts"], env: { CONFLICT_GUARD: "full", CONFLICT_GUARD_STRATEGY: "G2", SIMPLERCP_STAGE5_LIVE: "1", SIMPLERCP_STAGE5_FAILURE: "1", TYPESAFE_API_KEY: "stage5-invalid-credential" } }
];
const results = [];
for (const scenario of cases) {
  const target = path.join(work, `${scenario.name}.json`);
  const env = { ...process.env, SIMPLERCP_STAGE5_LIVE: "0", SIMPLERCP_STAGE5_FAILURE: "0", CONFLICT_GUARD_STRATEGY: "G3", ...scenario.env, PLAYWRIGHT_JSON_OUTPUT_NAME: target };
  let output;
  try { output = await promisify(execFile)("pnpm", [...scenario.args, "--reporter=list,json"], { cwd: root, env, maxBuffer: 8 * 1024 * 1024 }); }
  catch (error) { await fs.writeFile(path.join(work, `${scenario.name}.log`), String(error.stdout ?? "") + String(error.stderr ?? "")); throw new Error(`浏览器验收失败：${scenario.name}`); }
  await fs.writeFile(path.join(work, `${scenario.name}.log`), output.stdout + output.stderr);
  const report = JSON.parse(await fs.readFile(target, "utf8"));
  const result = { scenario: scenario.name, command: `CONFLICT_GUARD=${scenario.env.CONFLICT_GUARD}${scenario.env.SIMPLERCP_AGENT_MAX_CONCURRENT_RUNS ? ` SIMPLERCP_AGENT_MAX_CONCURRENT_RUNS=${scenario.env.SIMPLERCP_AGENT_MAX_CONCURRENT_RUNS}` : ""} pnpm ${scenario.args.join(" ")}`, passed: report.stats.expected, failed: report.stats.unexpected, skipped: report.stats.skipped };
  results.push(result); console.log(JSON.stringify(result));
}
await fs.writeFile(path.join(root, "docs/conflict-guard/evidence/stage-5-manual/verification.json"), JSON.stringify({ assertions: "DOM, Monaco, server state, trace", results }, null, 2) + "\n");
