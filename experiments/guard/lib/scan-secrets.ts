import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { parse } from "../../../apps/server/node_modules/dotenv/lib/main.js";
import { projectRoot } from "./common.js";

const execute = promisify(execFile), environment = parse(await fs.readFile(path.join(projectRoot, ".env"), "utf8"));
const secrets = Object.entries(environment).filter(([name, value]) => /(?:API_KEY|SECRET|TOKEN|PASSWORD)$/.test(name) && value.length >= 12).map(([, value]) => value);
const files = (await execute("git", ["ls-files", "--cached", "--others", "--exclude-standard", "--", "experiments/guard"], { cwd: projectRoot, maxBuffer: 10_000_000 })).stdout.split("\n").filter(Boolean);
const findings: string[] = [];
for (const file of files) {
  const bytes = await fs.readFile(path.join(projectRoot, file));
  if (secrets.some(secret => bytes.includes(Buffer.from(secret)))) findings.push(file);
}
const result = { checkedAt: new Date().toISOString(), files: files.length, configuredSecretCount: secrets.length, exactKeyMatches: findings.length, findings };
await fs.writeFile(path.join(projectRoot, "experiments/guard/results/SECRET_SCAN.json"), JSON.stringify(result, null, 2) + "\n");
if (findings.length) throw new Error(`Secret found in ${findings.length} files; inspect paths in SECRET_SCAN.json`);
console.log(`Exact configured-key scan: ${files.length} files, 0 matches`);
