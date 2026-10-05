import fs from "node:fs/promises";
import path from "node:path";
import * as ts from "typescript";

export async function replayLibraries() {
  const directory = path.dirname(ts.getDefaultLibFilePath({ target: ts.ScriptTarget.ES2022 }));
  const entries = (await fs.readdir(directory)).filter((name) => /^lib\..*\.d\.ts$/.test(name)).sort();
  return Object.fromEntries(await Promise.all(entries.map(async (name) => [name, await fs.readFile(path.join(directory, name), "utf8")])));
}
