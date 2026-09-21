import fs from "node:fs/promises";
import path from "node:path";
import { nanoid } from "nanoid";

export async function readJsonFile<T>(storagePath: string): Promise<T | undefined> {
  try {
    return JSON.parse(await fs.readFile(storagePath, "utf8")) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

export async function writeJsonFileAtomically(storagePath: string, value: unknown) {
  await fs.mkdir(path.dirname(storagePath), { recursive: true });
  const nextPath = `${storagePath}.${nanoid(8)}.next`;
  await fs.writeFile(nextPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await fs.rename(nextPath, storagePath);
}
