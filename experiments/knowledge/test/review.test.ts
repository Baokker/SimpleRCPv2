import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import path from "node:path";
import http from "node:http";
import {parse} from "csv-parse/sync";
import {stringify} from "csv-stringify/sync";
import {replayEvents} from "@simplercp/knowledge";
import {createApp} from "../../../apps/server/src/createApp.js";
import {attachRealtimeServer} from "../../../apps/server/src/realtime.js";
import {registerExperimentRoutes} from "../server-routes.js";
import {PlatformClient} from "../client.js";
import {CollaborationClient, YRuntime as Y, editorOffset} from "../collaboration.js";
import {configSchema, dataset, root, benchRoot, RunStore, exists, platformRoot, selectIds} from "../common.js";
import {normalizeScript, anchorMetrics, triggerMetrics} from "../k1.js";
import {updateRatingSheet, episodes} from "../k2.js";
import {evaluateStrategies} from "../k7.js";
import {correctionContext} from "../k4.js";
import {retrievalMetrics, summarizeRetrieval} from "../k5.js";
import {collectFrozenAnchorCorpus, createAnchorBenchmarkCases} from "../../../packages/knowledge/test/fixtures/anchor-benchmark.js";

async function directory(name: string) {
  await fs.mkdir(path.join(root, ".work"), {recursive: true});
  return fs.mkdtemp(path.join(root, ".work", `${name}-`));
}

test("配置校验失败释放锁，重复结果不能再次追加", async () => {
  const data = await dataset(), location = await directory("review-store");
  const config = configSchema.parse({});
  const first = await new RunStore(location).open("review", config, data);
  await first.append({key: "one", completed: true});
  await first.close();
  await assert.rejects(new RunStore(location).open("review", {...config, seed: config.seed + 1}, data), /Resume metadata changed/);
  assert.equal(await exists(path.join(location, ".runner.lock")), false);
  const resumed = await new RunStore(location).open("review", config, data);
  await assert.rejects(resumed.append({key: "one", completed: true}), /already complete/);
  await assert.rejects(resumed.close(), /already complete/);
  assert.equal(await exists(path.join(location, ".runner.lock")), false);
  await fs.rm(location, {recursive: true});
});

test("任务选择拒绝未知标识符和重复项", async () => {
  const data = await dataset();
  assert.equal(selectIds(data.tasks, "R1-T01")[0].id, "R1-T01");
  assert.throws(() => selectIds(data.tasks, "R1-T01,R1-T01"), /Invalid selection/);
  assert.throws(() => selectIds(data.tasks, "R1-T00"), /Invalid selection/);
});

test("检索汇总给予每个任务相同权重，保留查询与误注入总数", async () => {
  const tasks = (await dataset()).tasks.filter(task => task.kind === "trap").slice(0, 2);
  const found = {...retrievalMetrics([tasks[0].targetCardId!], [tasks[0].targetCardId!]), task: tasks[0].id, taskKind: "trap"};
  const missed = {...retrievalMetrics([], [tasks[1].targetCardId!]), task: tasks[1].id, taskKind: "trap"};
  const control = {...retrievalMetrics([tasks[0].targetCardId!], []), task: "control", taskKind: "control"};
  const result = summarizeRetrieval([found, found, found, missed, control]);
  assert.equal(result.traps, 2); assert.equal(result.queries, 4);
  assert.equal(result.recall1, 0.5); assert.equal(result.mrr, 0.5); assert.equal(result.falseInjections, 1);
  assert.throws(() => summarizeRetrieval([{...found, mrr: null}]), /Missing mrr/);
  assert.throws(() => summarizeRetrieval([{...control, falseInjections: null}]), /Missing falseInjections/);
});

test("T1 正文预算保留纠正原文与实际 diff 摘要", async () => {
  const pair = (await dataset()).transfers[0];
  const patch = await fs.readFile(path.join(pair.ta.directory, "reference/trap.patch"), "utf8");
  const content = correctionContext(pair.correction.text, patch);
  assert.ok(content.startsWith(pair.correction.text));
  assert.ok(content.includes("src/"));
  assert.ok(content.length <= 800);
  assert.throws(() => correctionContext(pair.correction.text, patch, 1), /card budget/);
});

test("评分表续跑保留填写内容并增加新草稿", async () => {
  const location = await directory("review-ratings"), file = path.join(location, "ratings.csv");
  const drafts = [{id: "one", draft: "包含逗号,以及\n换行的草稿"}];
  await updateRatingSheet(file, drafts);
  const rows = parse(await fs.readFile(file, "utf8"), {columns: true}) as Record<string, string>[];
  rows[0].ruleCorrect = "4"; rows[0].notes = "需要确认,适用范围";
  await fs.writeFile(file, stringify(rows, {header: true}));
  await updateRatingSheet(file, [...drafts, {id: "two", draft: "第二份草稿"}]);
  const updated = parse(await fs.readFile(file, "utf8"), {columns: true}) as Record<string, string>[];
  assert.equal(updated[0].ruleCorrect, "4"); assert.equal(updated[0].notes, "需要确认,适用范围");
  assert.equal(updated[1].id, "two");
  await assert.rejects(updateRatingSheet(file, [{id: "one", draft: "改变的草稿"}]), /Rated draft changed/);
  await fs.rm(location, {recursive: true});
});

test("触发匹配处理相互覆盖的时间窗口，共现标注顺序不影响结果", async () => {
  const input = await normalizeScript("S01");
  const suggestions = replayEvents(input.events, {}, input.metadata.durationSeconds * 1000 + 60000);
  const type = suggestions.find(item => suggestions.filter(other => other.triggerType === item.triggerType).length >= 2)!.triggerType;
  const selected = suggestions.filter(item => item.triggerType === type).sort((a, b) => a.createdAt - b.createdAt).slice(0, 2);
  const labels = {knowledgeMoments: [
    {id: "broad", expectedTrigger: type, tStart: selected[0].createdAt / 1000, tEnd: selected[1].createdAt / 1000},
    {id: "early", expectedTrigger: type, tStart: selected[0].createdAt / 1000, tEnd: selected[0].createdAt / 1000}
  ]};
  assert.equal(triggerMetrics([...selected].reverse(), labels).truePositives, 2);
  assert.deepEqual(anchorMetrics(input.events, {...input.labels, anchorInference: [...input.labels.anchorInference].reverse()}), anchorMetrics(input.events, input.labels));
});

test("K2 仅使用已经执行的纠正，脚本证据采用知识时刻的文本", async () => {
  const contexts = await episodes(await dataset());
  assert.ok(contexts.every(item => item.id.startsWith("S")));
  const input = await normalizeScript("S01");
  const moment = input.labels.knowledgeMoments.find((item: any) => input.events.some(event => event.at <= item.tEnd * 1000 && "file" in event && event.file === item.discussedCode[0].file && "textAfter" in event));
  const file = moment.discussedCode[0].file;
  const changed = input.events.filter(event => event.at <= moment.tEnd * 1000 && "file" in event && event.file === file && "textAfter" in event).at(-1) as any;
  assert.equal(contexts.find(item => item.id === moment.id)!.evidence.code, changed.textAfter);
});

test("真实 HTTP 与 Yjs 检查卡片快照、T1 状态和平台锚点顺序", {timeout: 40000}, async () => {
  const location = await directory("review-http");
  await fs.cp(path.join(benchRoot, "repos/R1"), path.join(location, "demo"), {recursive: true});
  const configuration = {port: 0, host: "127.0.0.1", publicOrigin: "http://127.0.0.1", dataDir: path.join(location, "data"), demoProjectRoot: path.join(location, "demo"), terminalEnabled: false, knowledge: "full" as const};
  const app = await createApp(configuration);
  registerExperimentRoutes(app, {enabled: true, provider: "minimax", model: "MiniMax-M2", speed: 1, configuration});
  const server = http.createServer(app);
  const realtime = attachRealtimeServer(server, app.locals.runtimeManager, app.locals.agentRuns, {members: app.locals.members});
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Server address is unavailable");
  const api = new PlatformClient(configSchema.parse({origin: `http://127.0.0.1:${address.port}`}));
  let collaboration: CollaborationClient | undefined;
  try {
    const project = (await api.request("/api/projects/demo")).project;
    const member = (await api.request("/api/projects/demo/members", undefined, {name: "review-member", connectionId: "review-connection"})).member.id;
    collaboration = new CollaborationClient(api, project);
    await collaboration.join(member);
    const data = await dataset(), target = data.library.find(item => item.repository === "R1")!.card;
    await collaboration.document(member, target.anchors[0].file.workspaceRelativePath);
    const imported = await api.request("/api/projects/demo/experiments/cards/import", member, {cards: [target]});
    assert.equal(imported.cards[0].anchors[0].snapshot.text, target.anchors[0].snapshot.text);
    const invalid = {...target, id: `${target.id}-invalid`, anchors: target.anchors.map(anchor => ({...anchor, snapshot: {...anchor.snapshot, text: anchor.snapshot.text.slice(1)}}))};
    await assert.rejects(api.request("/api/projects/demo/experiments/cards/import", member, {cards: [invalid]}), /snapshot differs/);
    const context = await api.request("/api/projects/demo/knowledge/cards", member, {type: "context", title: "本次纠正上下文", summary: "成员要求整张单据共同处理。", content: "后项失败时，前项库存保持原样。", scope: "team"});
    assert.equal(context.card.status, "reviewed");
    assert.equal((await api.request(`/api/projects/demo/knowledge/cards/${context.card.id}`, member)).card.status, "reviewed");

    const samples = collectFrozenAnchorCorpus(platformRoot, {fixtureRoot: path.join(platformRoot, "packages/knowledge/bench/fixtures/anchor-corpus-0869b7a")});
    const sample = samples[0], anchor = createAnchorBenchmarkCases(samples)[0].anchor;
    const file = "review-anchor.ts";
    await api.request("/api/projects/demo/workspace/file", member, {path: file, content: sample.text}, "PUT");
    const doc = await collaboration.document(member, file), text = doc.getText("content");
    const card = (await api.request("/api/projects/demo/knowledge/cards", member, {type: "constraint", title: "锚点位置检查", summary: "并发修改之后检查锚点所在位置。", content: "检查捕获范围和相对位置。", scope: "team", anchors: [{file, selection: anchor.rangeAtCapture}]})).card;
    const start = Y.createRelativePositionFromTypeIndex(text, sample.selectionStart), end = Y.createRelativePositionFromTypeIndex(text, sample.selectionEnd);
    await collaboration.edit(member, file, sample.text, sample.selectionEnd, 0, "\n// 边界检查\n");
    const after = text.toString();
    const a = Y.createAbsolutePositionFromRelativePosition(start, doc)!, b = Y.createAbsolutePositionFromRelativePosition(end, doc)!;
    const measured = evaluateStrategies(after, card.anchors[0], {startOffset: a.index, endOffset: b.index}, {startOffset: sample.selectionStart, endOffset: sample.selectionEnd}).find(item => item.strategy === "yjs-multi")!;
    const resolved = (await api.request(`/api/projects/demo/knowledge/cards?file=${file}`, member)).resolutions.find((item: any) => item.cardId === card.id);
    assert.ok(resolved);
    if (resolved.status === "needsReview") assert.equal(measured.outcome, "review");
    else assert.deepEqual(measured.range, {startOffset: editorOffset(after, resolved.range.startLine, resolved.range.startColumn), endOffset: editorOffset(after, resolved.range.endLine, resolved.range.endColumn)});
  } finally {
    await collaboration?.close();
    realtime.dispose();
    for (const sockets of [realtime.presence, realtime.documents, realtime.terminal]) {for (const socket of sockets.clients) socket.terminate(); sockets.close();}
    await app.locals.agentRuns.dispose(); await app.locals.agentRuntime.dispose(); await app.locals.runtimeManager.dispose();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await fs.rm(location, {recursive: true});
  }
});
