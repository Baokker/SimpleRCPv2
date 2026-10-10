import fs from "node:fs/promises";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { parseArgs } from "node:util";
import { calibrateThreshold } from "../dist/adjudication/calibrate.js";
import type { CalibrationSample } from "../dist/adjudication/calibrate.js";
const { values } = parseArgs({ args: process.argv.slice(2).filter((item) => item !== "--"), options: { dataset: { type: "string", default: "bench/datasets/d1-v1" }, record: { type: "string", default: "../../docs/conflict-guard/evidence/stage-5-dev-report/results.json.gz" }, out: { type: "string", default: "../../docs/conflict-guard/evidence/stage-5-dev-report" } } });
const dataset = path.resolve(values.dataset!);
const directory = (await fs.stat(dataset)).isDirectory();
const source = directory ? path.resolve(values.record!) : dataset;
const report = JSON.parse((source.endsWith(".gz") ? gunzipSync(await fs.readFile(source)) : await fs.readFile(source)).toString());
if (report.split !== "dev") throw new Error("只允许开发集校准");
if (directory && JSON.parse(await fs.readFile(path.join(dataset, "manifest.json"), "utf8")).version !== report.dataset) throw new Error("录制结果的数据集版本不符");
const fast = report.policies.G2; const deep = report.policies.G1;
if (!fast || !deep) throw new Error("校准需要 G1 与 G2 的录制结果");
const samples: CalibrationSample[] = [];
const deepCalls = new Map<string, { decision: "allow" | "warn" | "lock" }>(deep.model.calls.filter((call: { status: string; decision?: string }) => ["success", "cache-hit"].includes(call.status) && call.decision).map((call: { inputHash: string; decision: "allow" | "warn" | "lock" }) => [call.inputHash, { decision: call.decision }]));
for (const row of fast.groups) {
  for (const judgement of row.result.judgements) {
    const metadata = judgement.verdict.adjudication;
  if (!metadata) continue;
    const final = row.result.pairs.find((pair: { id: string }) => pair.id === judgement.pairId)?.final;
    if (!final?.verdict?.adjudication || final.revision !== judgement.revision) continue;
    const deepResult = deepCalls.get(metadata.inputHash);
    samples.push({ truth: row.outcome.truth, ...(metadata.status === "success" ? { fast: { decision: judgement.verdict.decision, confidence: metadata.confidence } } : {}), ...(deepResult ? { deep: deepResult } : {}) });
  }
}
const result = calibrateThreshold(samples); const output = path.resolve(values.out!); await fs.mkdir(output, { recursive: true });
if (!samples.some((sample) => sample.fast)) {
  await fs.writeFile(path.join(output, "calibration.json"), JSON.stringify({ split: "dev", dataset: report.dataset, source: values.record, ...result, recommended: null, status: "blocked", reason: "没有有效快判结果，无法校准置信度阈值", fastSuccessful: 0 }, null, 2) + "\n");
  await fs.rm(path.join(output, "adjudication-config.json"), { force: true });
  await fs.rm(path.join(output, "threshold.svg"), { force: true });
  throw new Error("没有有效快判结果，无法校准置信度阈值");
}
await fs.writeFile(path.join(output, "calibration.json"), JSON.stringify({ split: "dev", dataset: report.dataset, source: directory ? values.record : values.dataset, ...result }, null, 2) + "\n");
await fs.writeFile(path.join(output, "adjudication-config.json"), JSON.stringify({ ...report.config, threshold: result.recommended }, null, 2) + "\n");
const points = (field: "coverage" | "escalationRatio" | "missBlockRatio" | "falseBlockRatio") => result.curves.filter((item) => item[field] !== null).map((item) => `${50 + item.threshold * 500},${250 - item[field]! * 200}`).join(" ");
await fs.writeFile(path.join(output, "threshold.svg"), `<svg xmlns="http://www.w3.org/2000/svg" width="650" height="330"><rect width="650" height="330" fill="white"/><path d="M50 40V250H570" stroke="black" fill="none"/><polyline points="${points("coverage")}" fill="none" stroke="#16834b"/><polyline points="${points("escalationRatio")}" fill="none" stroke="#2058b1"/><polyline points="${points("missBlockRatio")}" fill="none" stroke="#c03232"/><polyline points="${points("falseBlockRatio")}" fill="none" stroke="#8c36aa"/><text x="50" y="280">Threshold 0–1; green: coverage; blue: escalation</text><text x="50" y="305">red: missed blocking; purple: false blocking</text></svg>\n`);
console.log(JSON.stringify({ samples: result.samples, recommended: result.recommended }));
