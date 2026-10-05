import fs from "node:fs/promises";
import path from "node:path";
import { actionMeetsExpected, projectRoot, type RawRow } from "./common.js";

async function verifyRun(experiment: string, directory: string) {
  const raw = (await fs.readFile(path.join(directory, "raw.jsonl"), "utf8")).trim().split("\n").filter(Boolean).map((line) => JSON.parse(line) as RawRow);
  const summary = JSON.parse(await fs.readFile(path.join(directory, "summary.json"), "utf8")) as Record<string, unknown>;
  const checks: Record<string, boolean> = {};
  checks.rowCount = typeof summary.rowCount === "number" ? summary.rowCount === raw.length : experiment === "X2" || experiment === "X4";
  if (experiment === "X1" || experiment === "X3") {
    checks.expectedMismatchCount = summary.expectedMismatchCount === raw.filter((row) => !actionMeetsExpected(row.actual, row.expected)).length;
    const count = raw.filter((row) => row.malicious && (row.actual === "allow" || row.actual === "allow_snapshot") && (experiment === "X1" ? row.matchedRules.some((rule) => rule.includes("irreversible")) : true)).length;
    checks.maliciousAutoApproval = (experiment === "X1" ? summary.irreversibleAutoApproved : summary.maliciousAutoApproval) === count;
  }
  if (experiment === "X5") checks.decideSampleSize = (summary.decide as { terminal: { sampleSize: number } }).terminal.sampleSize === 1000;
  if (experiment === "X6") checks.faultCases = (summary.faultInjection as { cases: number }).cases === 500;
  return { experiment, directory, pass: Object.values(checks).every(Boolean), checks };
}

async function main() {
  const output: Array<Record<string, unknown>> = [];
  for (const experiment of ["X1", "X2", "X3", "X4", "X5", "X6"]) {
    const root = path.join(projectRoot, "experiments/guard/results", experiment);
    const entries = (await fs.readdir(root, { withFileTypes: true }).catch(() => [])).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
    const latest = entries.at(-1);
    if (latest) output.push(await verifyRun(experiment, path.join(root, latest)));
  }
  await fs.writeFile(path.join(projectRoot, "experiments/guard/results/VERIFICATION.json"), `${JSON.stringify({ verifiedAt: new Date().toISOString(), runs: output }, null, 2)}\n`);
  process.stdout.write(`${output.map((item) => `${item.experiment}: ${item.pass ? "PASS" : "FAIL"}`).join("\n")}\n`);
}

await main();
