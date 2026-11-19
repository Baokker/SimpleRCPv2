// X7b: compare two filled annotation sheets, report Cohen's kappa, and
// recompute the X1 F-condition metrics with the adjudicated human labels.
// Usage: tsx agreement.ts <sheetA.csv> <sheetB.csv> [adjudicated.csv]
import fs from "node:fs/promises";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import type { DatasetRecord } from "../lib/common.js";

const q1Key = "q1_overreach(yes/no)";
const q2Key = "q2_expected(allow/allow_snapshot/ask/deny)";

function readCsv(file: string): Map<string, { overreach: string; action: string }> {
  const parser = fileURLToPath(new URL("./annotation-csv.py", import.meta.url));
  const rows: Record<string, string>[] = JSON.parse(execFileSync("python3", [parser, "read", file], { encoding: "utf8" }));
  const annotations = new Map<string, { overreach: string; action: string }>();
  for (const row of rows) {
    const id = row.id?.trim();
    const overreach = row[q1Key]?.trim();
    const action = row[q2Key]?.trim();
    assert.ok(id && !annotations.has(id), `Missing or duplicate identifier in ${file}`);
    assert.ok(overreach === "yes" || overreach === "no", `Invalid overreach label for ${id}`);
    assert.ok(action && ["allow", "allow_snapshot", "ask", "deny"].includes(action), `Invalid action label for ${id}`);
    annotations.set(id, { overreach, action });
  }
  return annotations;
}

function kappa(a: string[], b: string[]): number {
  const count = a.length;
  const labels = [...new Set([...a, ...b])];
  const observed = a.filter((label, index) => label === b[index]).length / count;
  const chance = labels.reduce((total, label) => total + (a.filter((value) => value === label).length / count) * (b.filter((value) => value === label).length / count), 0);
  return chance === 1 ? null : (observed - chance) / (1 - chance);
}

async function main() {
  const [fileA, fileB, fileFinal] = process.argv.slice(2);
  if (!fileA || !fileB) throw new Error("usage: agreement.ts <sheetA.csv> <sheetB.csv> [adjudicated.csv]");
  const sheets = [readCsv(fileA), readCsv(fileB)];
  if (fileFinal) sheets.push(readCsv(fileFinal));
  const ids = [...sheets[0]!.keys()];
  assert.ok(ids.length > 0 && sheets.every((sheet) => sheet.size === ids.length && ids.every((id) => sheet.has(id))), "Annotation sheets must contain identical identifier sets");
  const records = (await Promise.all(["D1", "D2", "D3", "D4"].map(async (dataset) => {
    const content = await fs.readFile(new URL(`../datasets/compact/${dataset}.jsonl`, import.meta.url), "utf8");
    return content.trimEnd().split("\n").map((line) => JSON.parse(line) as DatasetRecord);
  }))).flat();
  const byId = new Map(records.map((record) => [record.id, record]));
  assert.ok(ids.every((id) => byId.has(id)), "Annotations contain an unknown dataset identifier");
  const labels = sheets.map((sheet) => ids.map((id) => sheet.get(id)!));
  const [first, second] = labels;
  const result = {
    annotatedByBoth: ids.length,
    kappa: {
      overreach: kappa(first!.map((label) => label.overreach), second!.map((label) => label.overreach)),
      action: kappa(first!.map((label) => label.action), second!.map((label) => label.action)),
    },
    agreementWithSpecification: Object.fromEntries(labels.map((items, sheetIndex) => {
      const overreachMatches = items.filter((item, index) => (item.overreach === "yes") === byId.get(ids[index]!)!.malicious).length;
      const actionMatches = items.filter((item, index) => item.action === byId.get(ids[index]!)!.expected).length;
      return [["A", "B", "adjudicated"][sheetIndex], { overreachMatches, actionMatches, total: ids.length, overreachRate: overreachMatches / ids.length, actionRate: actionMatches / ids.length }];
    })),
  };
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

await main();
