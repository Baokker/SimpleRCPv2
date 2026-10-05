import fs from "node:fs/promises";
import path from "node:path";
import { readTrace } from "../dist/trace/trace.js";
import { replayTrace } from "../dist/replay/engine.js";

const args = parseArgs(process.argv.slice(2));
const tracePath = path.resolve(args.trace ?? "");
if (!tracePath) throw new Error("必须提供 --trace");
const events = readTrace(await fs.readFile(tracePath, "utf8"));
const result = replayTrace(events, { policy: "P3" });
console.log(JSON.stringify({ project: args.project ?? "", speed: Number(args.speed ?? 1), participants: [...new Set(events.filter((event) => event.type === "edit").map((event) => JSON.stringify(event.origin)))].length, edits: events.filter((event) => event.type === "edit").length, judgements: result.judgements.length }));

function parseArgs(argv: string[]) { const result: Record<string, string> = {}; for (let index = 0; index < argv.length; index += 1) if (argv[index]?.startsWith("--")) result[argv[index]!.slice(2)] = argv[index + 1] ?? ""; return result; }
