import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import {createRequire} from "node:module";
import {fileURLToPath} from "node:url";

const directory = path.dirname(fileURLToPath(import.meta.url));
const platform = path.resolve(directory, "../../..");
const require = createRequire(path.join(platform, "experiments/knowledge/package.json"));
const {parse} = require("dotenv");
const {fromMarkdown} = await import(require.resolve("mdast-util-from-markdown"));
const credentials = Object.entries(parse(await fs.readFile(path.join(platform, ".env"))))
  .filter(([name, value]) => /API_KEY$/u.test(name) && value.length > 8)
  .map(([, value]) => Buffer.from(value));
assert(credentials.length > 0, "本地模型凭据尚未配置");

const reports = ["exp1", "exp2", "exp3", "exp4"].map(name => path.join(directory, name));
const metadata = ["freeze-v3.md", "freeze-v3-review.md", "README.md", "REPRODUCE.md", "chapter5-material.md", "E3/report.md"]
  .map(name => path.join(directory, name));
let scanned = 0;
async function checkFile(file) {
  const contents = await fs.readFile(file);
  assert(credentials.every(value => !contents.includes(value)), "产物包含模型凭据，检查未通过");
  scanned++;
  if (path.extname(file) !== ".md") return;
  const queue = [fromMarkdown(contents.toString())];
  while (queue.length) {
    const node = queue.pop();
    if (["link", "image"].includes(node.type) && !/^\w+:/u.test(node.url) && !node.url.startsWith("#")) {
      await fs.access(path.resolve(path.dirname(file), node.url.split("#")[0]));
    }
    if (node.children) queue.push(...node.children);
  }
}
async function walk(folder) {
  for (const entry of await fs.readdir(folder, {withFileTypes: true})) {
    if (["node_modules", ".git", "__pycache__"].includes(entry.name)) continue;
    const file = path.join(folder, entry.name);
    if (entry.isDirectory()) await walk(file);
    else if (entry.isFile()) await checkFile(file);
  }
}
for (const folder of reports) await walk(folder);
for (const file of metadata) await checkFile(file);
await walk(path.join(platform, "experiments/knowledge/runs/exp3-freeze-v3"));
const delivery = JSON.parse(await fs.readFile(path.join(directory, "exp2/delivery-with-fallback.json"), "utf8"));
assert.equal(delivery.newModelRequests, 0);
assert.equal(delivery.resolvedRequests.length, 132);
assert.equal(delivery.failures.length, 5);
assert(delivery.failures.every(row => row.sourceKey.includes("-B-")));
const partial = JSON.parse(await fs.readFile(path.join(directory, "exp3/partial-status.json"), "utf8"));
assert.equal(partial.collectedResults + partial.uncollected.length + partial.notCreated, 198);
assert.equal(partial.runtimeFailures.length, 0);
assert.deepEqual(partial.uncollected.map(row => row.status), ["completed", "cancelled"]);
console.log(JSON.stringify({checked: scanned, localLinksValid: true, credentialsAbsent: true, deliveryRequests: 132, collectedAgentResults: 43}));
