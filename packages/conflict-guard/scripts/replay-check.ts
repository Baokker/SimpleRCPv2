import fs from "node:fs/promises";
import path from "node:path";
import { readTrace } from "../dist/trace/trace.js";
import { existsSync } from "node:fs";
import { checkReplay } from "../dist/replay/check.js";
import { replayLibraries } from "./replay-libs.ts";

const input = process.argv.slice(2).filter((value) => value !== "--")[0];
if (!input) throw new Error("必须提供轨迹文件");
const file = path.resolve(input);
const events = readTrace(await fs.readFile(file, "utf8"));
const projectFile = file.replace(/\.jsonl$/, "-project.json");
const initialFiles = existsSync(projectFile) ? JSON.parse(await fs.readFile(projectFile, "utf8")) as Record<string, string> : undefined;
const result = checkReplay(events, { libs: await replayLibraries(), initialFiles });
console.log(JSON.stringify(result));
if (!result.valid) process.exitCode = 1;
