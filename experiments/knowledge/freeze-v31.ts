import fs from "node:fs/promises";
import path from "node:path";
import {configSchema, dataset, digest, exec, hash, platformRoot, root, benchRoot, readJson, writeJson} from "./common.js";
import {PlatformClient} from "./client.js";

const data = await dataset();
const config = configSchema.parse(await readJson(path.join(root, "formal-v3.json")));
const api = new PlatformClient(config);
const server = await api.verify();
const runtime = await api.request("/api/agent/status");
if (runtime.version !== "1.18.31" || runtime.state !== "ready") throw new Error("OpenCode 1.18.31 must be ready before freezing");
const files = ["experiments/knowledge/formal-v3.json", "experiments/knowledge/review-rules.json", "experiments/knowledge/e3-retest-protocol.json", "apps/server/src/knowledge/rerank.ts", "packages/knowledge/src/extract/recapPrompt.ts", "pnpm-lock.yaml"];
const hashes = Object.fromEntries(await Promise.all(files.map(async file => [file, hash(await fs.readFile(path.join(platformRoot, file)))])));
const output = path.join(platformRoot, "docs/knowledge/experiments/freeze-v31-checks/environment.json");
await writeJson(output, {tag: "knowledge-exp-freeze-v3.1", at: new Date().toISOString(),
  implementationCommit: (await exec("git", ["rev-parse", "HEAD"], {cwd: platformRoot})).stdout.trim(),
  dataCommit: (await exec("git", ["rev-parse", "HEAD"], {cwd: benchRoot})).stdout.trim(),
  dataChanges: (await exec("git", ["status", "--porcelain"], {cwd: benchRoot})).stdout.trim(),
  manifestHash: data.manifestHash, configHash: digest(config), files: hashes,
  dataReviewRulesHash: hash(await fs.readFile(path.join(benchRoot, "tools/transfer-review-rules.json"))),
  node: process.version, pnpm: (await exec("pnpm", ["--version"], {cwd: platformRoot})).stdout.trim(), runtime, server,
  samples: {exp3: 198, exp4Ta: 18, exp4Tb: 36}, oldPartialResults: "experiments/knowledge/runs/exp3-freeze-v3/results.jsonl"});
console.log(JSON.stringify({output, manifestHash: data.manifestHash, configHash: digest(config), runtime: runtime.version}));
