import fs from "node:fs/promises";
import path from "node:path";
import { isCaptureEvent, type CaptureEvent } from "./events.js";
import { replayEvents, type CaptureConfigInput } from "./engine.js";

const [file, ...args] = process.argv.slice(2);
if (!file) throw new Error("Usage: replay <events.jsonl> [--end-at milliseconds]");
const events: CaptureEvent[] = (await fs.readFile(file, "utf8")).split("\n").filter(Boolean).map((line, index) => {
  const value: unknown = JSON.parse(line);
  if (!isCaptureEvent(value)) throw new Error(`Invalid event at line ${index + 1}`);
  return value;
});
let config: CaptureConfigInput = {};
const configPath = path.join(path.dirname(file), "capture-config.json");
try { config = JSON.parse(await fs.readFile(configPath, "utf8")) as CaptureConfigInput; }
catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
const endAt = args[0] === "--end-at" ? Number(args[1]) : undefined;
if (args.length && (args.length !== 2 || args[0] !== "--end-at" || !Number.isFinite(endAt))) throw new Error("Invalid replay arguments");
const suggestions = replayEvents(events, config, endAt);
const counts: Record<string, number> = {};
for (const suggestion of suggestions) { process.stdout.write(JSON.stringify(suggestion) + "\n"); counts[suggestion.triggerType] = (counts[suggestion.triggerType] ?? 0) + 1; }
process.stderr.write(JSON.stringify({ total: suggestions.length, counts }) + "\n");
