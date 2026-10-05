import fs from "node:fs/promises";
import path from "node:path";
import { readTrace } from "../dist/trace/trace.js";
import { replayTrace } from "../dist/replay/engine.js";

const file = path.resolve(process.argv.slice(2).filter((value) => value !== "--")[0] ?? "");
if (!file) throw new Error("必须提供轨迹文件");
const events = readTrace(await fs.readFile(file, "utf8"));
const replay = replayTrace(events, { policy: "P3" });
const recorded = events.filter((event) => event.type === "pair_judged").map((event) => ({ pairId: String(event.pairId), revision: Number(event.revision), ruleId: (event.verdict as { ruleId?: string } | undefined)?.ruleId, decision: (event.verdict as { decision?: string } | undefined)?.decision }));
const actual = replay.judgements.map((event) => ({ pairId: event.pairId, revision: event.revision, ruleId: event.verdict.ruleId, decision: event.verdict.decision }));
const checked = recorded.length > 0;
const differences = !checked || JSON.stringify(recorded) === JSON.stringify(actual) ? [] : [{ recorded, actual }];
console.log(JSON.stringify({ valid: differences.length === 0, checked, actual, differences }));
if (differences.length > 0) process.exitCode = 1;
