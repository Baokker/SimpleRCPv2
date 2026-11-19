// X7b: export a blind annotation sheet for D1-D4. The sheet hides the
// rule-derived expected action and the malicious flag, so two annotators can
// label intent and the expected handling independently of the rules.
import fs from "node:fs/promises";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import type { DatasetRecord } from "../lib/common.js";

const csv = (value: unknown) => `"${String(value ?? "").replaceAll('"', '""')}"`;
const seed = "compact-annotation-v1";
const sampleSize = 180;
const datasets = ["D1", "D2", "D3", "D4"];
const directory = new URL("../datasets/compact/annotation/", import.meta.url);
const rank = (value: string) => createHash("sha256").update(`${seed}:${value}`).digest("hex");

async function main() {
  const strata = new Map<string, { dataset: string; record: DatasetRecord }[]>();
  for (const dataset of datasets) {
    const content = await fs.readFile(new URL(`../datasets/compact/${dataset}.jsonl`, import.meta.url), "utf8");
    for (const line of content.trimEnd().split("\n")) {
      const record: DatasetRecord = JSON.parse(line);
      const key = `${dataset}/${record.actor.level}/${record.malicious}`;
      const group = strata.get(key) ?? [];
      group.push({ dataset, record });
      strata.set(key, group);
    }
  }
  const population = [...strata.values()].reduce((total, group) => total + group.length, 0);
  assert.equal(population, 717);
  const groups = [...strata].map(([key, group]) => ({ key, group, exact: group.length * sampleSize / population, size: 1 }));
  for (let allocated = groups.length; allocated < sampleSize; allocated++) {
    const group = groups.filter(({ size, group }) => size < group.length).sort((left, right) =>
      (right.exact - right.size) - (left.exact - left.size) || left.key.localeCompare(right.key)
    )[0]!;
    group.size++;
  }
  const records = groups.flatMap(({ group, size }) => group.sort((left, right) => rank(left.record.id).localeCompare(rank(right.record.id))).slice(0, size));
  records.sort((left, right) => rank(`order:${left.record.id}`).localeCompare(rank(`order:${right.record.id}`)));
  assert.equal(records.length, sampleSize);
  const header = ["id", "dataset", "level", "source", "agent_kind", "scenario", "kind", "request", "q1_overreach(yes/no)", "q2_expected(allow/allow_snapshot/ask/deny)", "comment"];
  const lines = records.map(({ dataset, record: item }) => [
    item.id, dataset, item.actor.level, item.actor.viaAgent ? "agent" : "terminal", item.actor.agentKind ?? "", item.scenario, item.input.kind,
    item.input.command ?? [...(item.input.paths ?? []), item.input.url ?? ""].filter(Boolean).join(" "), "", "", ""
  ].map(csv).join(","));
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(new URL("sheet.csv", directory), "﻿" + [header.map(csv).join(","), ...lines].join("\n") + "\n");
  process.stdout.write(`${records.length} records\n`);
}

await main();
