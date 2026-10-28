import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createSnapshotStore } from "../../../apps/server/src/guard/snapshots.js";

// B6: restore a snapshot after another member edited the same files.
// The snapshot is taken before the restored actor's command, as the guard does for snapshot-backed requests.
// The snapshot is sealed when the command finishes, before the other member's edit.
// A case is correct when the restored change is undone and the later change is kept,
// or when the overlapping file is left untouched and handed to a person.
// results-before.json holds the outcome of the whole-file restore used before the conflict check.

const base = Array.from({ length: 10 }, (_, index) => `export const v${index + 1} = ${index + 1};`).join("\n") + "\n";
const replace = (text: string, line: number, value: string) => text.split("\n").map((row, index) => index === line - 1 ? value : row).join("\n");
const restoredLine = "export const v3 = 30;";

interface Case { id: string; note: string; act: (root: string) => Promise<string | undefined> }
const file = (root: string, name = "src/config.ts") => path.join(root, name);
const write = async (root: string, text: string, name?: string) => { await fs.mkdir(path.dirname(file(root, name)), { recursive: true }); await fs.writeFile(file(root, name), text); };
const read = (root: string, name?: string) => fs.readFile(file(root, name), "utf8").catch(() => undefined);

const cases: Case[] = [
  { id: "different-line", note: "其他成员改同一文件的另一行", act: async (root) => { await write(root, replace((await read(root))!, 8, "export const v8 = 80;")); return "export const v8 = 80;"; } },
  { id: "same-line", note: "其他成员改同一行", act: async (root) => { await write(root, replace((await read(root))!, 3, "export const v3 = 300;")); return "export const v3 = 300;"; } },
  { id: "adjacent-line", note: "其他成员改相邻行", act: async (root) => { await write(root, replace((await read(root))!, 4, "export const v4 = 40;")); return "export const v4 = 40;"; } },
  { id: "shifted", note: "其他成员在文件开头插入两行", act: async (root) => { await write(root, "// a\n// b\n" + (await read(root))!); return "// a"; } },
  { id: "renamed", note: "其他成员把文件改名", act: async (root) => { await fs.rename(file(root), file(root, "src/settings.ts")); return undefined; } },
  { id: "new-file", note: "其他成员在同一目录新建文件", act: async (root) => { await write(root, "export const extra = 1;\n", "src/extra.ts"); return undefined; } },
  { id: "two-agents", note: "两个 Agent 运行重叠，各改一个位置", act: async (root) => { await write(root, replace((await read(root))!, 8, "export const v8 = 81;")); return "export const v8 = 81;"; } }
];

const results = [];
for (const item of cases) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "x9-restore-"));
  await write(root, base);
  const store = createSnapshotStore(path.join(root, ".guard-snapshots"), root);
  const snapshot = await store.create({ memberId: "alice", command: "sed -i 's/= 3;/= 30;/' src/config.ts", paths: ["src"] });
  await write(root, replace(base, 3, restoredLine));
  await store.seal(snapshot.id);
  const otherLine = await item.act(root);
  const beforeRestore = { main: await read(root), renamed: await read(root, "src/settings.ts") };
  const outcome = await store.restore(snapshot.id);
  const restored = await read(root);
  const renamed = await read(root, "src/settings.ts");
  const extra = await read(root, "src/extra.ts");
  const otherKept = item.id === "renamed" ? renamed !== undefined && restored === undefined
    : item.id === "new-file" ? extra !== undefined
    : Boolean(otherLine && restored?.includes(otherLine));
  const untouched = restored === beforeRestore.main && renamed === beforeRestore.renamed;
  const handedToPerson = !outcome.restored && untouched;
  results.push({
    id: item.id, note: item.note,
    withdrawnUndone: restored !== undefined && !restored.includes(restoredLine),
    otherKept, handedToPerson, conflicts: outcome.conflicts.map((conflict) => conflict.path),
    duplicate: item.id === "renamed" && restored !== undefined && renamed !== undefined,
    correct: handedToPerson || (otherKept && restored !== undefined && !restored.includes(restoredLine))
  });
  await fs.rm(root, { recursive: true, force: true });
}
const out = path.join(import.meta.dirname, "results.json");
await fs.writeFile(out, JSON.stringify({ base: "10-line TypeScript module", results }, null, 2) + "\n");
console.table(results.map(({ note, ...rest }) => rest));
