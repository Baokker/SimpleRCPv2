import fs from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { gunzipSync } from "node:zlib";
import path from "node:path";
import { parseEnv } from "node:util";
import { repositoryRoot, loadModelEnvironment } from "./model-runtime.ts";

loadModelEnvironment();
const configured = parseEnv(await fs.readFile(path.join(repositoryRoot, ".env"), "utf8"));
const secrets = [...new Set([...Object.entries(process.env), ...Object.entries(configured)].filter(([name, value]) => /(?:KEY|TOKEN|SECRET)(?:_|$)/i.test(name) && value).map(([, value]) => value!))];
const files = execFileSync("git", ["diff", "--cached", "--name-only", "-z", "--diff-filter=ACMR"], { cwd: repositoryRoot }).toString().split("\0").filter(Boolean);
let matches = 0;
for (const file of files) {
  const bytes = await fs.readFile(path.join(repositoryRoot, file));
  const text = (file.endsWith(".gz") ? gunzipSync(bytes) : bytes).toString();
  for (const secret of secrets) if (text.includes(secret)) matches += 1;
}
console.log(JSON.stringify({ matches }));
if (matches) process.exitCode = 1;
