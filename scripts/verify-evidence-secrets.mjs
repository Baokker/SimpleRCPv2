import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { gunzipSync } from "node:zlib";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const require = createRequire(import.meta.url);
const { parse } = require("../apps/server/node_modules/dotenv/lib/main.js");
const environment = parse(await fs.readFile(path.join(repositoryRoot, ".env"), "utf8"));
const sensitiveValues = Object.entries(environment).filter(([name, value]) => /(?:KEY|TOKEN|SECRET)(?:_|$)/i.test(name) && value).map(([, value]) => value);
assert(sensitiveValues.length > 0, "Configured sensitive values are required");
const { stdout } = await promisify(execFile)("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], { cwd: repositoryRoot, maxBuffer: 8 * 1024 * 1024 });
const files = [...new Set(stdout.split("\0").filter(Boolean))];
for (const file of files) {
  const content = await fs.readFile(path.join(repositoryRoot, file));
  const source = file.endsWith(".gz") ? gunzipSync(content) : content;
  for (const value of sensitiveValues) assert(!source.includes(Buffer.from(value)), `Configured sensitive value found in ${file}`);
}
console.log(JSON.stringify({ configuredValuesFound: 0 }));
