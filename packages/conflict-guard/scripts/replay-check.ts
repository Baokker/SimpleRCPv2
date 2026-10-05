import fs from "node:fs/promises";
import path from "node:path";
import { readTrace } from "../dist/trace/trace.js";
import { checkReplay } from "../dist/replay/check.js";
import { replayLibraries } from "./replay-libs.ts";

const input = process.argv.slice(2).filter((value) => value !== "--")[0];
if (!input) throw new Error("必须提供轨迹文件");
const file = path.resolve(input);
const events = readTrace(await fs.readFile(file, "utf8"));
const result = checkReplay(events, { libs: await replayLibraries() });
console.log(JSON.stringify(result));
if (!result.valid) process.exitCode = 1;
