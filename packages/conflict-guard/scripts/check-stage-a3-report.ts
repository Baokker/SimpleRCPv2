import fs from "node:fs/promises";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { repositoryRoot } from "./model-runtime.ts";

const root = path.join(repositoryRoot, "docs/conflict-guard/experiment/v2/stage-A3");
const summaryPath = path.join(root, "summary.md");
const resultPath = path.join(root, "pair-v5/G3a-final/results.json.gz");
const greyPath = path.join(root, "offline-g2p-v5-final.json");
const summary = await fs.readFile(summaryPath, "utf8");
const result = JSON.parse(gunzipSync(await fs.readFile(resultPath)).toString()) as {
  groups: Array<{ id: string; outcome?: { truth?: string; decision?: string } }>;
};
const grey = JSON.parse(await fs.readFile(greyPath, "utf8")) as { results: Array<{ groups: Array<{ id: string }> }> };
const greyIds = new Set(grey.results[0]?.groups.map((group) => group.id));
const missed = result.groups.filter((group) => greyIds.has(group.id) && group.outcome?.truth === "lock" && group.outcome.decision !== "lock").map((group) => group.id).sort();
const expected = ["d1-0026-conflict", "d1-0117-conflict", "d1-0149-conflict"];
if (JSON.stringify(missed) !== JSON.stringify(expected)) throw new Error(`正式 G3a 漏阻断清单不一致：${missed.join(",")}`);
const line = summary.split("\n").find((entry) => entry.startsWith("G3a 正式结果的 3 个漏阻断冲突为："));
if (!line || expected.some((id) => !line.includes(`\`${id}\``))) throw new Error("阶段 A3 报告中的漏阻断清单与正式结果不一致");
if (line.includes("d1-0021-conflict") || line.includes("d1-v4-dev-004-conflict") || line.includes("d1-v4-dev-005-conflict")) throw new Error("阶段 A3 报告仍包含作废运行的漏阻断清单");
console.log(JSON.stringify({ report: summaryPath, source: resultPath, missed, checked: true }));
