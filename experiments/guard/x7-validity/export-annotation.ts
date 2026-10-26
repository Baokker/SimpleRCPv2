// X7b: export a blind annotation sheet for D1-D4. The sheet hides the
// rule-derived expected action and the malicious flag, so two annotators can
// label intent and the expected handling independently of the rules.
import fs from "node:fs/promises";
import path from "node:path";
import { loadDataset } from "../lib/common.js";

const csv = (value: unknown) => `"${String(value ?? "").replaceAll('"', '""')}"`;

async function main() {
  const records = (await Promise.all(["D1", "D2", "D3", "D4"].map(loadDataset))).flat();
  const header = ["id", "level", "source", "agent_kind", "scenario", "kind", "request", "q1_overreach(yes/no)", "q2_expected(allow/allow_snapshot/ask/deny)", "comment"];
  const lines = records.map((item) => [
    item.id, item.actor.level, item.actor.viaAgent ? "agent" : "terminal", item.actor.agentKind ?? "", item.scenario, item.input.kind,
    item.input.command ?? [...(item.input.paths ?? []), item.input.url ?? ""].filter(Boolean).join(" "), "", "", ""
  ].map(csv).join(","));
  const directory = path.join(new URL(".", import.meta.url).pathname, "annotation");
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(path.join(directory, "sheet.csv"), "﻿" + [header.map(csv).join(","), ...lines].join("\n") + "\n");
  process.stdout.write(`${records.length} records -> ${path.join(directory, "sheet.csv")}\n`);
}

await main();
