import fs from "node:fs/promises";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { createJevJudge, defaultAdjudicationConfig } from "../dist/index.js";
import { loadModelEnvironment, repositoryRoot } from "./model-runtime.ts";

loadModelEnvironment();
if (!process.env.TYPESAFE_PROXY_URL || !process.env.TYPESAFE_API_KEY) throw new Error("需要配置 Jev 密钥与 TYPESAFE_PROXY_URL");
const output = path.join(repositoryRoot, "docs/conflict-guard/evidence/jev-proxy");
await fs.mkdir(output, { recursive: true });
const archive = JSON.parse(gunzipSync(await fs.readFile(path.join(repositoryRoot, "packages/conflict-guard/bench/model-cache/preexperiment/model-cache.json.gz"))).toString());
const name = Object.keys(archive).sort().find((name) => name.startsWith("G1/"))!;
const input = JSON.parse(archive[name]).input;
const rows: unknown[] = [];
const statuses: number[] = [];
const judge = createJevJudge({ apiKey: process.env.TYPESAFE_API_KEY, proxyUrl: process.env.TYPESAFE_PROXY_URL, config: defaultAdjudicationConfig, now: () => performance.now(), fetch: async (url, init) => {
  const response = await fetch(url, init);
  statuses.push(response.status);
  return response;
} });
for (let index = 0; index < 3; index += 1) {
  const result = await judge.judge(input, AbortSignal.timeout(8000));
  if (!result.usage) throw new Error("Jev 响应缺少 usage");
  const row = { request: index + 1, status: statuses[index], model: judge.model, latencyMs: result.latencyMs, usage: result.usage, response: result.raw };
  rows.push(row);
  await fs.writeFile(path.join(output, "results.json"), JSON.stringify({ date: new Date().toISOString(), transport: "provider-proxy", inputSource: name, rows }, null, 2) + "\n");
  console.log(JSON.stringify({ request: index + 1, status: statuses[index], model: judge.model, latencyMs: result.latencyMs, usage: result.usage }));
}
