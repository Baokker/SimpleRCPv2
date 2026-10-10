import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import path from "node:path";
import {fromMarkdown} from "mdast-util-from-markdown";
import {searchRankedKnowledgeCards} from "@simplercp/knowledge";
import {buildRerankRequest, estimateRerankCost, parseRerankSelection} from "../../../apps/server/src/knowledge/rerank.js";
import {knowledgeActiveFiles} from "../../../apps/server/src/knowledge/provider.js";
import {selectKnowledgeInjection} from "../../../apps/server/src/knowledge/injection.js";
import {startRetrievalServer} from "../e3-server.js";
import {dataset, root, benchRoot, readJson, readJsonl} from "../common.js";

test("E3 改写保留实际文件上下文，对照相关卡片均存在", async () => {
  const data = await dataset();
  const protocol = await readJson(path.join(root, "e3-retest-protocol.json"));
  const manifest = await readJson(path.join(benchRoot, "manifest.json"));
  assert.equal(Object.keys(protocol.paraphrases).length, 22);
  for (const task of data.tasks) {
    const first = fromMarkdown(task.prompt).children[0];
    assert.equal(first.type, "paragraph");
    const prompt = protocol.paraphrases[task.id] + task.prompt.slice(first.position!.end.offset!);
    const files = Object.keys(manifest).filter(file => file.startsWith(`repos/${task.repository}/`)).map(file => file.slice(`repos/${task.repository}/`.length));
    assert.deepEqual(knowledgeActiveFiles({prompt}, undefined, files), knowledgeActiveFiles({prompt: task.prompt}, undefined, files));
    if (task.kind === "control") for (const id of Object.keys(protocol.controlRelevantCards[task.id])) assert.ok(data.library.some(item => item.repository === task.repository && item.card.id === id));
  }
});

test("M3 请求使用临时编号，并按记录的 OpenAI 用量估算费用", async () => {
  const data = await dataset();
  await fs.mkdir(path.join(root, ".work"), {recursive: true});
  const directory = await fs.mkdtemp(path.join(root, ".work/e3-request-"));
  try {
    const task = data.tasks.find(item => item.id === "R1-T01")!;
    const cards = data.library.filter(item => item.repository === task.repository && item.card.status === "reviewed").map(item => item.card);
    const results = await searchRankedKnowledgeCards({cards, query: task.prompt, workspaceId: "R1", indexDir: directory, lexicalScoring: "bm25", ranking: "bounded", useActiveFiles: true});
    const input = {query: task.prompt, activeFiles: [], topK: 5, maxCharsPerCard: 800, candidates: results.slice(0, 20).map(result => ({result, card: cards.find(card => card.id === result.cardId)!}))};
    const request = buildRerankRequest(input, "20261010");
    assert.deepEqual(buildRerankRequest(input, "20261010"), request);
    assert.equal(request.mapping.length, 20);
    for (const {cardId} of request.mapping) assert.ok(!JSON.stringify(request.messages).includes(cardId));
    assert.notDeepEqual(buildRerankRequest(input, "20261011").mapping, request.mapping);
    const fenced = parseRerankSelection("```json\n{\"selected\":[]}\n```", request.mapping, 5);
    assert.deepEqual(fenced, []);
    const records = await readJsonl(path.join(root, "runs/E6-recap-acceptance-v21-m3-final/results.jsonl"));
    for (const row of records) for (const call of row.calls) {
      const usage = call.usage;
      assert.equal(estimateRerankCost(usage), ((usage.promptTokens - usage.cacheReadTokens) * 2.1 + usage.cacheReadTokens * 0.42 + usage.completionTokens * 8.4) / 1000000);
    }
  } finally {await fs.rm(directory, {recursive: true, force: true});}
});

test("E3 真实 HTTP 入口与产品预览、预算处理返回相同知识", {timeout: 60000}, async () => {
  const data = await dataset();
  await fs.mkdir(path.join(root, ".work"), {recursive: true});
  const directory = await fs.mkdtemp(path.join(root, ".work/e3-http-"));
  let server = await startRetrievalServer("R1", directory);
  try {
    const project = (await server.api.request("/api/projects/demo")).project;
    const member = (await server.api.request("/api/projects/demo/members", undefined, {name: "检索核验成员"})).member.id;
    const variants = new Set(data.tasks.flatMap(task => task.variantCardIds ?? []));
    const cards = data.library.filter(item => item.repository === "R1" && item.card.status === "reviewed" && !variants.has(item.card.id)).map(item => item.card);
    await server.api.request("/api/projects/demo/experiments/cards/import", member, {cards});
    const visible = (await server.api.request("/api/projects/demo/knowledge/cards", member)).cards;
    const task = data.tasks.find(item => item.id === "R1-T01")!;
    for (const condition of ["A", "B"]) {
      const changed = await server.api.configure(project, member, {lexicalScoring: condition === "A" ? "legacy" : "bm25", ranking: "bounded", topK: 5, maxTotalChars: 4000, maxCharsPerCard: 800});
      const online = await server.api.request("/api/projects/demo/experiments/retrieval", member, {prompt: task.prompt, condition, seed: "test"});
      assert.equal(online.failed, false);
      const preview = await server.api.request("/api/projects/demo/knowledge/preview", member, {prompt: task.prompt});
      const offline = await selectKnowledgeInjection({cards: visible, viewerMemberId: member, query: task.prompt, activeFiles: preview.activeFiles, config: changed.config, workspaceId: project.id, indexDir: path.join(directory, "offline")});
      assert.deepEqual(online.result.records, preview.records);
      assert.deepEqual(offline.records, preview.records);
      assert.equal(online.result.section, offline.section);
      assert.ok(online.result.totalChars <= 4000);
    }
    await server.close();
    server = await startRetrievalServer("R1", directory);
    const joined = (await server.api.request("/api/projects/demo/members", undefined, {memberId: member, name: "检索核验成员"})).member.id;
    assert.equal(joined, member);
    const resumed = await server.api.request("/api/projects/demo/experiments/retrieval", member, {prompt: task.prompt, condition: "B", seed: "test"});
    assert.equal(resumed.failed, false);
    assert.ok(resumed.result.records.length > 0);
  } finally {await server.close(); await fs.rm(directory, {recursive: true, force: true});}
});
