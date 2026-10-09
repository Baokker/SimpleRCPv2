import fs from "node:fs/promises";
import { readFileSync } from "node:fs";
import path from "node:path";

interface Acknowledgement { memberId: string; pairId: string; revision: number; contentKey: string }

export function createWarningAcknowledgements(file: string) {
  let entries: Acknowledgement[] = [];
  try {
    const loaded: unknown = JSON.parse(readFileSync(file, "utf8"));
    if (!Array.isArray(loaded) || !loaded.every((item) => item && typeof item.memberId === "string" && typeof item.pairId === "string" && Number.isSafeInteger(item.revision) && typeof item.contentKey === "string")) throw new Error("提醒确认记录格式不正确");
    entries = loaded;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  let saving = Promise.resolve();
  const has = (memberId: string, pairId: string, revision: number, contentKey: string) => entries.some((entry) => entry.memberId === memberId && entry.pairId === pairId && entry.revision === revision && entry.contentKey === contentKey);
  return {
    has,
    async add(memberId: string, pairId: string, revision: number, contentKey: string) {
      if (has(memberId, pairId, revision, contentKey)) return;
      const operation = saving.then(async () => {
        if (has(memberId, pairId, revision, contentKey)) return;
        const updated = [...entries, { memberId, pairId, revision, contentKey }];
        await fs.mkdir(path.dirname(file), { recursive: true });
        await fs.writeFile(`${file}.part`, JSON.stringify(updated) + "\n", { mode: 0o600 });
        await fs.rename(`${file}.part`, file);
        entries = updated;
      });
      saving = operation.then(() => undefined, () => undefined);
      await operation;
    }
  };
}
