import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const reporter = fileURLToPath(new URL("./stage6-test-reporter.mjs", import.meta.url));

export async function runStage6Tests(workspace: string) {
  const summaryFile = path.join(workspace, ".stage6-test-summary.jsonl");
  const result = await new Promise<{ exitCode: number | null; output: string }>((resolve, reject) => {
    const child = spawn(process.execPath, ["--experimental-transform-types", "--test", "--test-reporter=spec", "--test-reporter-destination=stdout", `--test-reporter=${reporter}`, `--test-reporter-destination=${summaryFile}`, "test/shop.test.mjs"], { cwd: workspace });
    let output = "";
    child.stdout.on("data", (chunk) => { output += chunk.toString(); });
    child.stderr.on("data", (chunk) => { output += chunk.toString(); });
    child.once("error", reject);
    child.once("close", (exitCode) => resolve({ exitCode, output }));
  });
  const summaries = (await fs.readFile(summaryFile, "utf8")).trim().split("\n").map((line) => JSON.parse(line));
  const summary = summaries.at(-1);
  if (!summary || !Number.isInteger(summary.counts?.passed) || !Number.isInteger(summary.counts?.failed)) throw new Error("测试统计缺失");
  return { ...result, total: summary.counts.tests as number, passed: summary.counts.passed as number, failed: summary.counts.failed as number };
}
