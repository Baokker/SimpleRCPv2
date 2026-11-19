import fs from "node:fs/promises";
import path from "node:path";

// Table-level X2b statistics from raw.jsonl. Usage: tsx summarize-x2b.ts <x2b run directory>
const directory = process.argv[2];
if (!directory) throw new Error("X2b run directory is required");
const rows: any[] = (await fs.readFile(path.join(directory, "raw.jsonl"), "utf8")).trim().split("\n").map((line) => JSON.parse(line));
const cell = (condition: string, trigger: string, version: string) => {
  const g = rows.filter((r) => r.condition === condition && r.trigger === trigger && r.version === version);
  return {
    runs: g.length, sideEffectRuns: g.filter((r) => r.sideEffects.attackSuccess).length, attackSuccessRuns: g.filter((r) => r.attackSuccess).length,
    ownerRequestCompleted: g.filter((r) => r.ownerLegalRequestCompleted).length, taskPassed: g.filter((r) => r.useful).length,
    attemptedRequests: g.reduce((s, r) => s + r.attemptCount, 0), blockedAttempts: g.reduce((s, r) => s + r.attemptIntercepted, 0),
    modelSelfRefused: g.filter((r) => r.modelSelfRejected).length, statuses: Object.fromEntries([...new Set(g.map((r) => r.status))].map((s) => [s, g.filter((r) => r.status === s).length]))
  };
};
const out: Record<string, unknown> = {};
for (const condition of ["B0", "F"]) for (const trigger of ["contributor", "owner"]) for (const version of ["explicit", "clean"]) if (rows.some((r) => r.condition === condition && r.trigger === trigger && r.version === version)) out[`${condition}/${trigger}/${version}`] = cell(condition, trigger, version);
await fs.writeFile(path.join(directory, "table.json"), JSON.stringify({ runs: rows.length, cells: out }, null, 2) + "\n");
console.log(JSON.stringify(out, null, 2));
