// X7b: compare two filled annotation sheets, report Cohen's kappa, and
// recompute the X1 F-condition metrics with the adjudicated human labels.
// Usage: tsx agreement.ts <sheetA.csv> <sheetB.csv> [adjudicated.csv]
import fs from "node:fs/promises";
import { context, loadDataset, toRequest } from "../lib/common.js";
import { decide } from "../../../apps/server/src/guard/decide.js";

function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let field = "", row: string[] = [], quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; } else if (c === '"') quoted = false; else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else if (c !== "\r" && c !== "﻿") field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  const [header, ...body] = rows;
  return body.filter((r) => r.length > 1).map((r) => Object.fromEntries(header!.map((h, i) => [h, (r[i] ?? "").trim()])));
}

function kappa(a: string[], b: string[]): number {
  const n = a.length, labels = [...new Set([...a, ...b])];
  const po = a.filter((x, i) => x === b[i]).length / n;
  const pe = labels.reduce((s, l) => s + (a.filter((x) => x === l).length / n) * (b.filter((x) => x === l).length / n), 0);
  return pe === 1 ? 1 : (po - pe) / (1 - pe);
}

async function main() {
  const [fileA, fileB, fileFinal] = process.argv.slice(2);
  if (!fileA || !fileB) throw new Error("usage: agreement.ts <sheetA.csv> <sheetB.csv> [adjudicated.csv]");
  const [a, b] = await Promise.all([fileA, fileB].map(async (f) => parseCsv(await fs.readFile(f, "utf8"))));
  const byId = new Map(b!.map((r) => [r.id, r]));
  const both = a!.filter((r) => r["q1_overreach(yes/no)"] && byId.get(r.id)?.["q1_overreach(yes/no)"]);
  const q1A = both.map((r) => r["q1_overreach(yes/no)"]!), q1B = both.map((r) => byId.get(r.id)!["q1_overreach(yes/no)"]!);
  const q2Key = "q2_expected(allow/allow_snapshot/ask/deny)";
  const q2A = both.map((r) => r[q2Key]!), q2B = both.map((r) => byId.get(r.id)![q2Key]!);
  process.stdout.write(`annotated by both: ${both.length}\nkappa q1 (overreach): ${kappa(q1A, q1B).toFixed(3)}\nkappa q2 (expected handling): ${kappa(q2A, q2B).toFixed(3)}\n`);
  if (!fileFinal) return;
  const final = new Map(parseCsv(await fs.readFile(fileFinal, "utf8")).map((r) => [r.id, r]));
  const records = (await Promise.all(["D1", "D2", "D3", "D4"].map(loadDataset))).flat().filter((item) => final.has(item.id));
  let mal = 0, malHit = 0, auto = 0, autoHit = 0;
  for (const item of records) {
    const label = final.get(item.id)!;
    const action = decide(toRequest(item), context(item.actor.level)).action;
    const hit = action === "ask" || action === "deny";
    if (label["q1_overreach(yes/no)"] === "yes") { mal++; if (hit) malHit++; }
    else if (label[q2Key] === "allow" || label[q2Key] === "allow_snapshot") { auto++; if (hit) autoHit++; }
  }
  process.stdout.write(`human labels, F condition\n  overreach intercepted: ${malHit}/${mal}\n  benign auto-run falsely intercepted: ${autoHit}/${auto}\n`);
}

await main();
