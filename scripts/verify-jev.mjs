import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { choiceInstructions, choiceCriteria, sanitize } from "../packages/conflict-guard/dist/index.js";

const repository = fileURLToPath(new URL("../", import.meta.url));
process.loadEnvFile(path.join(repository, ".env"));
if (!process.env.TYPESAFE_API_KEY) throw new Error("TYPESAFE_API_KEY 尚未配置");
const directory = path.join(repository, "packages/conflict-guard/bench/model-cache/preexperiment/G2");
const first = (await fs.readdir(directory)).filter((name) => name.endsWith(".json")).sort()[0];
if (!first) throw new Error("缺少真实开发集请求");
const cached = JSON.parse(await fs.readFile(path.join(directory, first), "utf8"));
const budgetFile = path.join(repository, ".test-workspaces/preexperiment-call-budget.json");
const budget = JSON.parse(await fs.readFile(budgetFile, "utf8"));
if (budget.fast >= 1000) throw new Error("快判预算已经达到上限");
budget.fast += 1;
await fs.writeFile(budgetFile, JSON.stringify(budget) + "\n");
const target = `${(process.env.TYPESAFE_BASE_URL ?? "https://api.typesafe.ai").replace(/\/$/, "")}/v1/systemone`;
const started = performance.now();
const response = await fetch(target, {
  method: "POST",
  headers: { "content-type": "application/json", Authorization: `Bearer ${process.env.TYPESAFE_API_KEY}` },
  body: JSON.stringify({ model: "jev-1.13.0", state: cached.input, questions: { decision: { type: "choice", instructions: choiceInstructions, criteria: choiceCriteria } } }),
  signal: AbortSignal.timeout(8000)
});
const secrets = Object.entries(process.env).filter(([name, value]) => /(?:KEY|TOKEN|SECRET)(?:_|$)/i.test(name) && value).map(([, value]) => value);
const record = sanitize({ date: new Date().toISOString(), target, model: "jev-1.13.0", source: first, status: response.status, latencyMs: performance.now() - started, response: await response.json(), budget }, secrets);
const output = path.join(repository, "docs/conflict-guard/evidence/preexperiment/jev-diagnostic.json");
await fs.writeFile(output, JSON.stringify(record, null, 2) + "\n");
console.log(JSON.stringify({ model: record.model, target: record.target, status: record.status, response: record.response, budget }));
