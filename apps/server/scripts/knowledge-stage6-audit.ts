import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "dotenv";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const repository = fileURLToPath(new URL("../../../", import.meta.url));
const env = parse(await fs.readFile(path.join(repository, ".env"), "utf8"));
const keys = [env.MINIMAX_API_KEY, env.DEEPSEEK_API_KEY].filter((key): key is string => Boolean(key));
const execute = promisify(execFile);
const tracked = (await execute("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], { cwd: repository })).stdout.split("\0").filter(Boolean);
const leaks: string[] = [];
for (const file of tracked) {
  const text = await fs.readFile(path.join(repository, file)).catch((error: NodeJS.ErrnoException) => { if (error.code === "ENOENT") return Buffer.alloc(0); throw error; });
  if (keys.some(key => text.includes(Buffer.from(key)))) leaks.push(file);
}
if (leaks.length) throw new Error(`Sensitive values detected in: ${leaks.join(", ")}`);
console.log(JSON.stringify({ checkedFiles: tracked.length, configuredProviders: keys.length, sensitiveValuesFound: 0 }));
