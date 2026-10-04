import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const require = createRequire(import.meta.url);
const { parse } = require("../apps/server/node_modules/dotenv/lib/main.js");
const environment = parse(await fs.readFile(path.join(repositoryRoot, ".env"), "utf8"));
const sensitiveValues = [environment.DEEPSEEK_API_KEY, environment.TYPESAFE_API_KEY].filter(Boolean);
assert(sensitiveValues.length > 0, "Configured sensitive values are required");
const { stdout } = await promisify(execFile)("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], { cwd: repositoryRoot, maxBuffer: 8 * 1024 * 1024 });
const files = [...new Set(stdout.split("\0").filter(Boolean))];
for (const file of files) {
  const source = await fs.readFile(path.join(repositoryRoot, file));
  for (const value of sensitiveValues) assert(!source.includes(Buffer.from(value)), `Configured sensitive value found in ${file}`);
}
console.log(JSON.stringify({ checkedFiles: files.length, configuredValuesFound: 0 }));
