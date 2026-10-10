import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const repository = fileURLToPath(new URL("../", import.meta.url));
process.loadEnvFile(path.join(repository, ".env"));
const { values } = parseArgs({ options: { inputs: { type: "string" }, "selected-only": { type: "boolean", default: false }, out: { type: "string", default: "docs/conflict-guard/evidence/minimax-probe" } } });
const key = process.env.MINIMAX_API_KEY?.trim();
if (!key) throw new Error("MINIMAX_API_KEY 未配置");
const model = process.env.MINIMAX_MODEL?.trim() || "MiniMax-M3";
const output = path.resolve(repository, values.out);
const budgetFile = path.join(repository, ".test-workspaces/minimax-probe-budget.json");
await fs.mkdir(path.dirname(budgetFile), { recursive: true });
await fs.mkdir(output, { recursive: true });
const lock = await fs.open(`${budgetFile}.lock`, "wx");
let budget;
let results = [];
const secrets = Object.entries(process.env).filter(([name, value]) => /KEY|TOKEN|SECRET|PASSWORD/i.test(name) && value).map(([, value]) => value);
function sanitize(value) {
  let text = JSON.stringify(value);
  for (const secret of secrets) text = text.split(secret).join("[REDACTED]");
  return JSON.parse(text);
}
async function call(baseUrl, name, body) {
  if (budget.requests >= budget.limits.requests) throw new Error("MiniMax 探测与冒烟请求预算已经耗尽");
  budget.requests += 1;
  await fs.writeFile(budgetFile, JSON.stringify(budget, null, 2) + "\n");
  const started = performance.now();
  const response = await fetch(`${baseUrl}/chat/completions`, { method: "POST", headers: { Authorization: `Bearer ${key}`, "content-type": "application/json" }, body: JSON.stringify({ model, n: 1, ...body }), signal: AbortSignal.timeout(60000) });
  const raw = await response.json();
  const choice = raw.choices?.[0];
  let jsonValid = false;
  if (typeof choice?.message?.content === "string") {
    try { JSON.parse(choice.message.content); jsonValid = true; }
    catch (error) { if (!(error instanceof SyntaxError)) throw error; }
  }
  const result = sanitize({ name, baseUrl, request: { model, n: 1, ...body }, httpStatus: response.status, latencyMs: performance.now() - started, response: raw, responseModel: raw.model, finishReason: choice?.finish_reason, jsonValid, reasoningEmpty: !choice?.message?.reasoning_content, contentEmpty: !choice?.message?.content });
  results.push(result);
  await fs.writeFile(path.join(output, "probe.json"), JSON.stringify({ date: "2026-10-10", model, results, budget }, null, 2) + "\n");
  console.log(JSON.stringify({ name, baseUrl, httpStatus: response.status, finishReason: choice?.finish_reason, jsonValid, reasoningEmpty: result.reasoningEmpty }));
  return result;
}
try {
  try { budget = JSON.parse(await fs.readFile(budgetFile, "utf8")); }
  catch (error) { if (error.code !== "ENOENT") throw error; budget = { requests: 0, agentRuns: 0, limits: { requests: 100, agentRuns: 6 } }; }
  try { results = JSON.parse(await fs.readFile(path.join(output, "probe.json"), "utf8")).results; }
  catch (error) { if (error.code !== "ENOENT") throw error; }
  const minimal = { thinking: { type: "disabled" }, reasoning_split: true, temperature: 0, max_tokens: 1024, messages: [{ role: "user", content: '只输出 JSON：{"ok":true}' }] };
  const stations = ["https://api.minimax.io/v1", "https://api.minimaxi.com/v1"];
  const probes = [];
  if (!values["selected-only"]) for (const station of stations) probes.push(await call(station, "station", minimal));
  else {
    const selected = JSON.parse(await fs.readFile(path.join(output, "selection.json"), "utf8"));
    probes.push({ httpStatus: 200, responseModel: selected.model, finishReason: "stop", jsonValid: true, baseUrl: selected.baseUrl });
  }
  const accepted = probes.filter((result) => result.httpStatus === 200 && result.responseModel === model && result.finishReason === "stop" && result.jsonValid);
  if (accepted.length !== 1) throw new Error("无法唯一确定可用 MiniMax 站点，详情见 probe.json");
  const baseUrl = accepted[0].baseUrl;
  if (!values["selected-only"]) {
    await call(baseUrl, "adaptive", { ...minimal, thinking: { type: "adaptive" }, max_tokens: 4096 });
    await call(baseUrl, "json-mode", { ...minimal, response_format: { type: "json_object" } });
    await call(baseUrl, "logprobs", { ...minimal, logprobs: true, top_logprobs: 3 });
  }
  if (values.inputs) {
    const inputs = JSON.parse(await fs.readFile(path.resolve(repository, values.inputs), "utf8"));
    const { parseMiniMaxResponse, miniMaxRequest } = await import(path.join(repository, "packages/conflict-guard/dist/adjudication/minimax.js"));
    for (const [index, input] of inputs.slice(0, 5).entries()) {
      const result = await call(baseUrl, `development-grey-json-${index + 1}`, miniMaxRequest(input, model, false));
      parseMiniMaxResponse(result.response, model, result.latencyMs);
    }
  }
  await fs.writeFile(path.join(output, "selection.json"), JSON.stringify({ date: "2026-10-10", model, baseUrl, temperature: 0, responseFormat: results.find((result) => result.name === "json-mode")?.httpStatus === 200, reasoningSplit: true, prices: { currency: baseUrl === stations[0] ? "USD" : "CNY", site: baseUrl, inputPerMillion: baseUrl === stations[0] ? 0.3 : 2.1, outputPerMillion: baseUrl === stations[0] ? 1.2 : 8.4, cacheReadPerMillion: baseUrl === stations[0] ? 0.06 : 0.42, source: baseUrl === stations[0] ? "https://platform.minimax.io/docs/pricing/overview" : "https://platform.minimaxi.com/docs/pricing/overview", date: "2026-10-10", tier: "standard", inputTokenLimit: 512000 }, budget }, null, 2) + "\n");
} finally {
  await lock.close();
  await fs.unlink(`${budgetFile}.lock`);
}
