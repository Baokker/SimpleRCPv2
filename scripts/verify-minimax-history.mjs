import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { gunzipSync } from "node:zlib";

const root = path.resolve("docs/conflict-guard/evidence/minimax-agent-smoke");
const attempts = (await fs.readdir(root)).filter((name) => name.startsWith("attempt-")).sort();
assert(attempts.length > 0, "缺少真实 Agent 冒烟记录");
const directory = path.join(root, attempts.at(-1));
const summary = JSON.parse(await fs.readFile(path.join(directory, "summary.json"), "utf8"));
const transport = JSON.parse(gunzipSync(await fs.readFile(path.join(directory, "transport.json.gz"))).toString());
let previous = [];
let preservedAssistantMessages = 0;
let toolMessages = 0;
for (const record of transport.requests) {
  assert.equal(record.httpStatus, 200);
  assert.equal(record.request.model, "MiniMax-M3");
  assert.deepEqual(record.request.thinking, { type: "disabled" });
  assert.equal(record.request.reasoning_split, true);
  const messages = record.request.messages;
  if (messages.filter((message) => message.role === "assistant").length === 0) previous = [];
  for (const message of previous.filter((message) => message.role === "assistant")) {
    assert(messages.some((entry) => JSON.stringify(entry) === JSON.stringify(message)), "后续请求没有完整保留 assistant 消息");
    preservedAssistantMessages += 1;
  }
  toolMessages += messages.filter((message) => message.role === "tool").length;
  previous = messages;
}
assert(summary.passed);
assert(summary.tasks.some((task) => task.rejected >= 1));
assert(preservedAssistantMessages > 0 && toolMessages > 0);
const selection = JSON.parse(await fs.readFile("docs/conflict-guard/evidence/minimax-probe/selection.json", "utf8"));
let costCny = 0;
for (const task of summary.tasks) {
  const record = JSON.parse(await fs.readFile(path.join(directory, `${task.task}.json`), "utf8"));
  const tokens = record.run.activity.tokens;
  costCny += ((tokens.input + tokens.cacheWrite) * selection.prices.inputPerMillion + tokens.cacheRead * selection.prices.cacheReadPerMillion + tokens.output * selection.prices.outputPerMillion) / 1e6;
}
const result = { model: summary.model, baseUrl: summary.baseUrl, source: attempts.at(-1), requests: transport.requests.length, preservedAssistantMessages, toolMessages, thinking: "disabled", costCny, prices: selection.prices, tasks: summary.tasks, cumulativeBudget: summary.budget, passed: true };
await fs.writeFile(path.join(root, "verification.json"), JSON.stringify(result, null, 2) + "\n");
console.log(JSON.stringify(result));
