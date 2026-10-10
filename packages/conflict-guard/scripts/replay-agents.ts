import fs from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readTrace, replayAgentTrace, buildAdjudicationInput, createAdjudicationService, cacheKey, canonicalJson, VirtualClock, type AdjudicationConfig, type CachedCall, type ProviderSubscription, type ArbitrationMode } from "../dist/index.js";
import { repositoryRoot } from "./model-runtime.ts";
import { replayLibraries } from "./replay-libs.ts";

const { values } = parseArgs({ options: { trace: { type: "string" }, dataset: { type: "string" }, tasks: { type: "string" }, cache: { type: "string" }, out: { type: "string" }, arbitration: { type: "string", default: "owner,all-human,all-auto" }, "provider-mode": { type: "string", default: "replay" }, repeat: { type: "string", default: "3" }, diagnostics: { type: "string" }, "no-T3": { type: "boolean", default: false }, plan: { type: "boolean", default: false } } });
if (Boolean(values.trace) === Boolean(values.dataset) || !values.out) throw new Error("指定一个 trace 或已录制的 dataset 目录，并提供 out");
if (values.plan) { console.log(JSON.stringify({ source: values.dataset ?? values.trace, modes: values.arbitration, repetitions: Number(values.repeat), enableT3: !values["no-T3"], executed: false, modelCalls: 0 })); process.exit(0); }
if (values.dataset) {
  const directory = path.resolve(values.dataset);
  const records = [];
  for (const name of (await fs.readdir(directory)).filter((name) => name.endsWith(".json"))) {
    const record = JSON.parse(await fs.readFile(path.join(directory, name), "utf8"));
    if (Array.isArray(record.traces) && record.taskId && (!values.tasks || values.tasks.split(",").includes(record.taskId))) records.push({ name: name.slice(0, -5), taskId: record.taskId, ownership: record.ownership, round: record.round });
  }
  if (!records.length) throw new Error("dataset 目录缺少已录制的 Agent 任务；先运行冻结后的 bench:agents");
  const outputs = [];
  for (const record of records) {
    const out = path.resolve(values.out, record.name);
    await promisify(execFile)(process.execPath, ["--experimental-strip-types", "scripts/replay-agents.ts", "--trace", path.join(directory, `${record.name}.jsonl`), "--out", out, "--arbitration", values.arbitration!, "--repeat", values.repeat!, "--cache", path.resolve(values.cache ?? path.join(directory, "model-cache")), ...(values["no-T3"] ? ["--no-T3"] : [])], { maxBuffer: 4 * 1024 * 1024 });
    outputs.push({ ...record, results: JSON.parse(await fs.readFile(path.join(out, "arbitration.json"), "utf8")) });
  }
  await fs.mkdir(path.resolve(values.out), { recursive: true });
  await fs.writeFile(path.resolve(values.out, "arbitration.json"), JSON.stringify(outputs, null, 2) + "\n");
  await fs.writeFile(path.resolve(values.out, "summary.md"), ["# 已录制 Agent 仲裁回放", "", `任务轨迹 ${outputs.length} 份；每种模式重复 ${values.repeat} 次。任务完成后复检：${values["no-T3"] ? "关闭" : "开启"}。`, "", "本回放使用相同的实际写入轨迹，只统计仲裁与打扰数量。任务成功和逃逸使用真实运行的独立结果。", ""].join("\n"));
  console.log(JSON.stringify({ traces: outputs.length, repeat: Number(values.repeat), executed: true, modelCalls: 0 }));
  process.exit(0);
}
if (!values.trace || !values.out) throw new Error("trace and out are required");
if (values["provider-mode"] !== "replay") throw new Error("Agent coordination replay requires recorded providers");
const events = readTrace(await fs.readFile(path.resolve(values.trace), "utf8"));
const modes = values.arbitration!.split(",") as ArbitrationMode[];
if (modes.some((mode) => !["owner", "all-human", "all-auto"].includes(mode))) throw new Error("Invalid arbitration mode");
const repeat = Number(values.repeat); if (!Number.isInteger(repeat) || repeat < 1) throw new Error("Invalid repetition count");
const initial = { ...(events.find((event) => event.type === "project_snapshot")?.files as Record<string, string> | undefined) };
for (const event of events) if (event.type === "doc_open" && typeof event.text === "string" && initial[String(event.file)] === undefined) initial[String(event.file)] = event.text;
const configuration = events.find((event) => event.type === "session_start")?.adjudication as AdjudicationConfig | undefined;
const libs = await replayLibraries();
const entries = new Map<string, CachedCall>();
for (const event of events.filter((event) => event.type === "provider_call" && event.status !== "cancelled")) {
  if (typeof event.cacheKey !== "string" || !/^[a-f0-9]{64}$/.test(event.cacheKey)) throw new Error("研判事件缺少有效缓存键");
  const entry = JSON.parse(await fs.readFile(path.join(values.cache ? path.resolve(values.cache) : path.join(repositoryRoot, "packages/conflict-guard/bench/model-cache"), `${event.cacheKey}.json`), "utf8")) as CachedCall;
  if (entry.key !== event.cacheKey || !entry.parameters || cacheKey(entry.input, entry.call.adapter, entry.call.model, entry.parameters) !== entry.key) throw new Error("研判缓存校验失败");
  entries.set(entry.key, entry);
}
function runtime(point: "T1" | "T2" | "T3") {
  if (!configuration) return undefined;
  const config: AdjudicationConfig = point === "T1" ? configuration : { ...configuration, strategy: "G4", point, reasoning: point === "T2" ? configuration.t2Reasoning ?? false : configuration.t3Reasoning ?? false, hardDeadlineMs: point === "T2" ? 30000 : 60000 };
  function identity(role: "fast" | "deep", name: string) {
    const selected = [...entries.values()].filter((entry) => entry.call.adapter === name && entry.call.role === role && (entry.call.point ?? "T1") === point && !events.some((event) => event.type === "provider_call" && event.cacheKey === entry.key && event.purpose === "compromise"));
    const parameters = selected.map((entry) => { const { role: _role, reasoning: _reasoning, hardDeadlineMs: _deadline, availableBudgetMs: _budget, ...rest } = entry.parameters!; return { model: entry.call.model, parameters: rest }; });
    if (new Set(parameters.map(canonicalJson)).size > 1) throw new Error("同一时点包含不同研判配置");
    return { name, model: parameters[0]?.model ?? (role === "fast" ? config.fastModel : "unrecorded"), cacheParameters: parameters[0]?.parameters, async judge(): Promise<never> { throw new Error("回放禁止联网"); } };
  }
  const subscriptions = events.filter((event) => event.type === "provider_subscription" && (event.point ?? "T1") === point && event.purpose !== "compromise") as unknown as ProviderSubscription[];
  const service = createAdjudicationService({ config, mode: "replay", clock: new VirtualClock(), fast: identity("fast", config.fast), deep: identity("deep", config.deep), ...(subscriptions.length ? { recordedSubscriptions: subscriptions } : {}), cache: { async get(key) { return entries.get(key); }, async put() { throw new Error("回放禁止修改缓存"); } } });
  return { config, service };
}
const output: Record<string, unknown> = {};
for (const mode of modes) {
  async function run() {
    const runtimes = { T1: runtime("T1"), T2: runtime("T2"), T3: runtime("T3") };
    try {
      return await replayAgentTrace(events, { mode, initialFiles: initial, libs, enableT3: !values["no-T3"], ...(configuration ? { adjudicate: (input, local, signal, point) => { const selected = runtimes[point]!; return selected.service.judge(buildAdjudicationInput(input, local, { ...configuration, point }, Object.keys(initial)), local, signal); } } : {}) });
    } finally { for (const selected of Object.values(runtimes)) selected?.service.dispose(); }
  }
  const result = await run();
  for (let index = 1; index < repeat; index += 1) {
    const repeated = await run();
    if (JSON.stringify(repeated) !== JSON.stringify(result)) {
      if (values.diagnostics) {
        await fs.mkdir(path.resolve(values.diagnostics), { recursive: true });
        await fs.writeFile(path.join(path.resolve(values.diagnostics), "expected.json"), JSON.stringify(result, null, 2));
        await fs.writeFile(path.join(path.resolve(values.diagnostics), "actual.json"), JSON.stringify(repeated, null, 2));
      }
      throw new Error(`Non-deterministic Agent replay: ${mode}`);
    }
  }
  output[mode] = result;
}
await fs.mkdir(path.resolve(values.out), { recursive: true });
await fs.writeFile(path.join(path.resolve(values.out), "arbitration.json"), JSON.stringify(output, null, 2) + "\n");
console.log(JSON.stringify({ modes, repeat, output: path.resolve(values.out) }));
