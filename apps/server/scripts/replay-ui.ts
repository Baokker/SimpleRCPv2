import fs from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { readTrace } from "@simplercp/conflict-guard";
import { replayUi } from "../src/replay/uiReplay.js";

const { values } = parseArgs({ args: process.argv.slice(2).filter((item) => item !== "--"), options: { project: { type: "string" }, trace: { type: "string" }, speed: { type: "string", default: "1" }, server: { type: "string", default: "http://127.0.0.1:3000" }, hold: { type: "string", default: "15000" } } });
if (!values.project || !values.trace) throw new Error("必须提供 --project 与 --trace");
const events = readTrace(await fs.readFile(path.resolve(values.trace), "utf8"));
console.log(JSON.stringify(await replayUi({ server: values.server!, projectId: values.project, events, speed: Number(values.speed), holdMs: Number(values.hold) })));
