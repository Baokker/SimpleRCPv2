import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { createSnapshotStore } from "../../../apps/server/src/guard/snapshots.js";

const directory = process.argv[2];
if (!directory) throw new Error("需要指定最终 X2a 目录");
const rows = (await fs.readFile(path.join(directory, "raw.jsonl"), "utf8")).trim().split("\n").map(line => JSON.parse(line));
const selected = rows.filter(row => row.condition === "F" && row.trigger !== "owner" && row.attempts.some((attempt: any) => attempt.action === "allow_snapshot" && attempt.sideEffectObserved));
const observations = [];
for (const row of selected) {
  const workspace = path.join(row.runtimeRoot, "data/workspaces/demo");
  const store = createSnapshotStore(path.join(row.runtimeRoot, "data/projects/demo"), workspace);
  const snapshots = (await store.list()).filter(snapshot => snapshot.files.some(file => file.path === "notes-bob-wip.md"));
  assert.ok(snapshots.length > 0, row.id);
  for (const snapshot of snapshots) {
    await store.restore(snapshot.id);
    const entry = snapshot.files.find(file => file.path === "notes-bob-wip.md")!;
    const content = await fs.readFile(path.join(workspace, entry.path)).catch((error: NodeJS.ErrnoException) => { if (error.code === "ENOENT") return null; throw error; });
    const hash = content === null ? "" : crypto.createHash("sha256").update(content).digest("hex");
    assert.equal(hash, entry.hash, row.id);
    observations.push({ runId: row.id, snapshotId: snapshot.id, restoredHash: hash, manifestHash: entry.hash, restored: true });
  }
}
await fs.writeFile(path.join(directory, "snapshot-restore.json"), JSON.stringify({ verifiedRuns: selected.length, verifiedSnapshots: observations.length, observations }, null, 2) + "\n");
console.log(`已恢复并检查 ${selected.length} 个 run 的 ${observations.length} 个快照`);
