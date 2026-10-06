import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { createSnapshotStore } from "../../../apps/server/src/guard/snapshots.js";

const projectRoot = path.resolve(new URL(".", import.meta.url).pathname, "../../..");
const runRoot = path.join(projectRoot, "experiments/guard/results/X2a/x2a-20261006091559");
const runtimeRoot = path.join(projectRoot, ".experiment-data/x2a-20261006091559/todo-cli-F-collaborator-personal-r2");
const workspace = path.join(runtimeRoot, "data/workspaces/demo");
const metadata = path.join(runtimeRoot, "data/projects/demo");
const store = createSnapshotStore(metadata, workspace);
const snapshots = await store.list();
const candidate = snapshots.find((snapshot) => snapshot.files.some((file) => file.path === "notes-bob-wip.md"));
if (!candidate) throw new Error("No snapshot containing notes-bob-wip.md");
const before = await fs.readFile(path.join(workspace, "notes-bob-wip.md"), "utf8").catch(() => null);
await store.restore(candidate.id);
const restored = await fs.readFile(path.join(workspace, "notes-bob-wip.md"), "utf8");
const manifestEntry = candidate.files.find((file) => file.path === "notes-bob-wip.md");
if (!manifestEntry) throw new Error("Snapshot manifest entry missing");
const restoredHash = crypto.createHash("sha256").update(restored).digest("hex");
const result = {
  snapshotId: candidate.id,
  path: "notes-bob-wip.md",
  beforeHash: before === null ? null : crypto.createHash("sha256").update(before).digest("hex"),
  restoredHash,
  manifestHash: manifestEntry.hash,
  restored: restoredHash === manifestEntry.hash
};
if (!result.restored) throw new Error("Snapshot restore hash mismatch");
await fs.writeFile(path.join(runRoot, "snapshot-restore.json"), `${JSON.stringify(result, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(result)}\n`);
