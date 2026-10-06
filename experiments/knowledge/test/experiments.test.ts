import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import fs from "node:fs/promises";
import {dataset, configSchema, root, RunStore, digest, readJsonl} from "../common.js";
import {normalizeScript, triggerMetrics} from "../k1.js";
import {retrievalMetrics} from "../k5.js";
import {concurrentTrace, editKinds, evaluateStrategies} from "../k7.js";
import {collectFrozenAnchorCorpus, createAnchorBenchmarkCases} from "../../../packages/knowledge/test/fixtures/anchor-benchmark.js";
import {platformRoot} from "../common.js";
import {draftMetrics} from "../k2.js";
import {conditionCards, fixedCardVariableChars} from "../k3.js";

test("冻结数据的全部文件哈希与卡片 schema", async () => {
  const data = await dataset();
  assert.equal(data.manifestHash, "62c2f65e7e28b83b23398e9dc8340e6ad4da7012fa1b9c831c3933a0e177f454");
  assert.equal(data.tasks.filter(task => task.kind === "trap").length, 10);
  assert.equal(data.transfers.length, 4);
});
test("两段完整脚本可转换，编辑内容与冻结基线一致", async () => {
  for (const id of ["S01", "S02"]) {
    const input = await normalizeScript(id);
    assert.equal(input.actions.length, 398);
    assert.ok(input.events.some(event => event.type === "agentRun"));
    assert.ok(input.events.every((event, index) => event.seq === index + 1 && (index === 0 || event.at >= input.events[index - 1].at)));
    const empty = triggerMetrics([], input.labels);
    assert.equal(empty.annotated, 26);
    assert.equal(empty.truePositives, 0);
  }
});
test("并发轨迹真值和策略结果可重复，删除请求复核", () => {
  const samples = collectFrozenAnchorCorpus(platformRoot, {fixtureRoot: path.join(platformRoot, "packages/knowledge/bench/fixtures/anchor-corpus-0869b7a")});
  assert.equal(samples.length, 48);
  const anchors = createAnchorBenchmarkCases(samples);
  for (const kind of editKinds) {
    const trace = concurrentTrace(samples[0], kind, 31);
    assert.equal(digest(trace), digest(concurrentTrace(samples[0], kind, 31)));
    assert.equal(evaluateStrategies(trace.text, anchors[0].anchor, trace.relative, trace.truth).length, 5);
    if (kind === "delete") assert.equal(trace.truth, null);
  }
});
test("检索指标的排名位置和空相关集", () => {
  assert.deepEqual(retrievalMetrics(["distractor", "target"], ["target"]), {recall1: 0, recall3: 1, recall5: 1, mrr: 0.5, ndcg5: 1 / Math.log2(3), falseInjections: null});
  assert.equal(retrievalMetrics(["distractor"], []).falseInjections, 1);
});
test("真实文件追加结果后续跑跳过完成组合", async () => {
  const data = await dataset();
  const directory = path.join(root, ".work", `store-test-${process.pid}-${Date.now()}`);
  const config = configSchema.parse({});
  const first = await new RunStore(directory).open("test", config, data);
  await first.append({key: "finished", completed: true}); await first.close();
  const second = await new RunStore(directory).open("test", config, data);
  assert.equal(second.done("finished"), true); assert.equal(second.done("pending"), false);
  await second.close(); assert.equal((await readJsonl(path.join(directory, "results.jsonl"))).length, 1);
  await fs.rm(directory, {recursive: true});
});
test("复盘评价检查原始响应中的全部引用", () => {
  const evidence = {file: "orders.ts"};
  const raw = JSON.stringify({type: "decision", title: "维护订单记录", summary: "订单更新应保留完整的审计信息。", whatHappened: "订单记录需要同步修改。", correction: "保留 orders.ts 中的审计字段。", rule: "所有订单更新均需要经过 orders.ts 中定义的统一更新入口，并保留完整审计信息。", notApplicable: "只读查询不需要修改审计记录。", appliesTo: {files: ["orders.ts"], globs: [], taskKinds: []}, scopeSuggestion: {scope: "team", reason: "适用于订单服务"}, confidence: 0.8, evidenceCitations: ["file", "missing"], unknowns: []});
  const measured = draftMetrics(raw, "server", evidence, "orders.ts", ["decision"]);
  assert.equal(measured.validStructure, true);
  assert.equal(measured.validCitations, false);
  assert.equal(draftMetrics("invalid JSON", "ordinary", evidence, "orders.ts", ["decision"]).validStructure, false);
});
test("C7 与 C5 的完整固定卡片字符预算一致", async () => {
  const data = await dataset();
  for (const task of data.tasks.filter(item => item.kind === "trap")) {
    const correct = conditionCards(data, task, "C5");
    const unrelated = conditionCards(data, task, "C7");
    const target = correct.cards.find(card => card.id === correct.configuration.fixedCardIds[0])!;
    const card = unrelated.cards.find(card => card.id === unrelated.configuration.fixedCardIds[0])!;
    assert.equal(fixedCardVariableChars(card) + card.content.length, fixedCardVariableChars(target) + Math.min(800, target.content.length));
    assert.equal(unrelated.lengthDifference, 0);
  }
});
