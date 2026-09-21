import fs from "node:fs/promises";
import path from "node:path";
import { readJsonFile, writeJsonFileAtomically } from "../jsonFile.js";

interface RecordStoreOptions<T extends { id: string; projectId: string }> {
  root: string;
  projectId: string;
  fileName: string;
  recordKey: string;
  invalidMessage: string;
  missingMessage: string;
  validateRecord(value: unknown): value is T;
}

export function createRecordStore<T extends { id: string; projectId: string }>(
  options: RecordStoreOptions<T>
) {
  const records = new Map<string, T>();
  let loading: Promise<void> | undefined;
  let operations = Promise.resolve();

  async function load() {
    for (const entry of await readDirectory(options.root)) {
      if (!entry.isDirectory()) continue;
      const stored = await readJsonFile<Record<string, unknown>>(
        path.join(options.root, entry.name, options.fileName)
      );
      const value = stored?.[options.recordKey];
      if (
        stored?.version !== 1 ||
        !options.validateRecord(value) ||
        value.projectId !== options.projectId ||
        value.id !== entry.name
      ) {
        throw new Error(options.invalidMessage);
      }
      records.set(value.id, value);
    }
  }

  function ensureLoaded() {
    loading ??= load();
    return loading;
  }

  function enqueue<R>(operation: () => Promise<R>): Promise<R> {
    const result = operations.then(operation);
    operations = result.then(() => undefined, () => undefined);
    return result;
  }

  async function save(record: T) {
    await writeJsonFileAtomically(
      path.join(options.root, record.id, options.fileName),
      { version: 1, [options.recordKey]: record }
    );
  }

  return {
    async create(record: T) {
      await ensureLoaded();
      return enqueue(async () => {
        if (records.has(record.id)) throw new Error(options.invalidMessage);
        await save(record);
        records.set(record.id, record);
        return { ...record };
      });
    },
    async get(id: string) {
      await ensureLoaded();
      await operations;
      const record = records.get(id);
      return record ? { ...record } : undefined;
    },
    async list() {
      await ensureLoaded();
      await operations;
      return [...records.values()].map((record) => ({ ...record }));
    },
    async update(id: string, change: (current: T) => T) {
      await ensureLoaded();
      return enqueue(async () => {
        const current = records.get(id);
        if (!current) throw new Error(options.missingMessage);
        const next = change(current);
        if (next.id !== id || next.projectId !== options.projectId) {
          throw new Error(options.invalidMessage);
        }
        await save(next);
        records.set(id, next);
        return { ...next };
      });
    }
  };
}

async function readDirectory(directoryPath: string) {
  try {
    return await fs.readdir(directoryPath, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}
