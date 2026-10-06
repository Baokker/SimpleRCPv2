import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../../docs/knowledge/evidence/stage-6/", import.meta.url));
for (const provider of ["minimax", "deepseek"]) {
  const records = await Promise.all((await fs.readdir(root)).filter(file => file.startsWith(`${provider}-`) && !file.endsWith("endpoint.json")).map(async file => JSON.parse(await fs.readFile(path.join(root, file), "utf8"))));
  console.log(JSON.stringify({ provider, model: records[0].model, count: records.length, passed: records.filter(record => record.evaluation.passed).length, testsRun: records.filter(record => record.ranTests).length, toolErrors: records.reduce((sum, record) => sum + record.toolErrors, 0), reasoningLeaks: records.reduce((sum, record) => sum + record.reasoningLeaks, 0), timeMs: records.reduce((sum, record) => sum + record.wallMs, 0), totalTokens: records.reduce((sum, record) => sum + record.usage.totalTokens, 0), estimatedCost: records.reduce((sum, record) => sum + (record.usage.estimatedCost ?? 0), 0), input: records.reduce((sum, record) => sum + record.usage.inputTokens, 0), output: records.reduce((sum, record) => sum + record.usage.outputTokens, 0), reasoning: records.reduce((sum, record) => sum + record.usage.reasoningTokens, 0) }));
  for (const record of records) console.log(JSON.stringify({ provider, task: record.task, attempt: record.attempt, time: record.wallMs, tokens: record.usage.totalTokens, cost: record.usage.estimatedCost ?? record.usage.cost, toolErrors: record.toolErrors, passed: record.evaluation.passed }));
}
