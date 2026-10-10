import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import {parseArgs} from "node:util";
import {parse} from "dotenv";
import {fromMarkdown} from "mdast-util-from-markdown";
import {selectKnowledgeInjection} from "../../apps/server/src/knowledge/injection.js";
import {parseRerankSelection} from "../../apps/server/src/knowledge/rerank.js";
import {startRetrievalServer} from "./e3-server.js";
import {dataset, root, platformRoot, readJson, readJsonl, writeJson, digest, hash, exec, configSchema, RunStore, exists} from "./common.js";

const {values} = parseArgs({options: {out: {type: "string"}, phase: {type: "string", default: "local"}}});
if (!values.out || !["local", "model"].includes(values.phase!)) throw new Error("--out and --phase local|model are required");
const directory = path.resolve(platformRoot, values.out);
const protocol = await readJson(path.join(root, "e3-retest-protocol.json"));
const data = await dataset();
assert.equal(Object.keys(protocol.paraphrases).length, data.tasks.length);
const queries = data.tasks.flatMap(task => {
  const first = fromMarkdown(task.prompt).children[0];
  if (first.type !== "paragraph" || first.position?.end.offset === undefined) throw new Error(`Expected initial paragraph: ${task.id}`);
  const paragraph = protocol.paraphrases[task.id];
  if (typeof paragraph !== "string") throw new Error(`Missing paraphrase: ${task.id}`);
  return [{task: task.id, variant: "original", query: task.prompt}, {task: task.id, variant: "paraphrase", query: paragraph + task.prompt.slice(first.position.end.offset)}];
});
const codeFiles = ["apps/server/src/knowledge/injection.ts", "apps/server/src/knowledge/provider.ts", "apps/server/src/knowledge/rerank.ts", "experiments/knowledge/e3-server.ts", "experiments/knowledge/e3-retest.ts", "experiments/knowledge/e3-retest-protocol.json"];
const freeze = {protocolHash: digest(protocol), queryHash: digest(queries), manifestHash: data.manifestHash,
  files: Object.fromEntries(await Promise.all(codeFiles.map(async file => [file, hash(await fs.readFile(path.join(platformRoot, file)))]))),
  commit: (await exec("git", ["rev-parse", "HEAD"], {cwd: platformRoot})).stdout.trim(), node: process.version,
  provider: "minimax", model: "MiniMax-M3"};
const freezePath = path.join(directory, "freeze.json");
if (await exists(freezePath)) assert.deepEqual(await readJson(freezePath), freeze, "Frozen experiment changed");
else {await writeJson(freezePath, freeze); await writeJson(path.join(directory, "queries.json"), queries); await writeJson(path.join(directory, "protocol.json"), protocol);}

let model: {baseUrl: string; apiKey: string} | undefined;
if (values.phase === "model") {
  const environment = parse(await fs.readFile(path.join(platformRoot, ".env")));
  if (!environment.MINIMAX_API_KEY || !environment.MINIMAX_BASE_URL) throw new Error("MiniMax service configuration is missing");
  model = {apiKey: environment.MINIMAX_API_KEY, baseUrl: environment.MINIMAX_BASE_URL};
}
const config = configSchema.parse({model: "MiniMax-M3", concurrency: 1, timeoutMs: 120000, seed: protocol.seed});
const store = await new RunStore(directory).open("e3-retest", config, data);
store.metadata.protocolHash = digest(protocol);
const previous = await exists(path.join(directory, "results.jsonl")) ? await readJsonl(path.join(directory, "results.jsonl")) : [];
let spent = previous.reduce((sum, row) => sum + (row.estimatedCostCny ?? 0), 0);
if (values.phase === "model" && previous.some(row => row.condition === "C" && row.estimatedCostCny === undefined)) throw new Error("Unknown prior model cost requires review");
const variants = new Set(data.tasks.flatMap(task => task.variantCardIds ?? []));
try {
  for (const repository of ["R1", "R2"]) {
    const serverDirectory = path.join(root, ".work", path.basename(directory), repository);
    const server = await startRetrievalServer(repository, serverDirectory, model);
    try {
      const project = (await server.api.request("/api/projects/demo")).project;
      const memberFile = path.join(serverDirectory, "member.json");
      let member: string;
      if (await exists(memberFile)) member = (await readJson(memberFile)).id;
      else {member = (await server.api.request("/api/projects/demo/members", undefined, {name: "检索实验成员"})).member.id; await writeJson(memberFile, {id: member});}
      const cards = data.library.filter(item => item.repository === repository && item.card.status === "reviewed" && !variants.has(item.card.id)).map(item => item.card);
      const imported = (await server.api.request("/api/projects/demo/knowledge/cards", member)).cards;
      if (!imported.length) await server.api.request("/api/projects/demo/experiments/cards/import", member, {cards});
      const visibleCards = (await server.api.request("/api/projects/demo/knowledge/cards", member)).cards;
      assert.deepEqual(visibleCards.map((card: any) => card.id).sort(), cards.map(card => card.id).sort());
      await writeJson(path.join(directory, `${repository}-cards.json`), visibleCards);
      const tasks = data.tasks.filter(task => task.repository === repository);
      for (const task of tasks) {
        const relevant = task.kind === "control" ? Object.keys(protocol.controlRelevantCards[task.id]) : [task.targetCardId];
        assert.ok(relevant.every(id => cards.some(card => card.id === id)));
        for (const query of queries.filter(item => item.task === task.id)) {
          for (const condition of values.phase === "local" ? ["A", "B"] : ["C"]) {
            const changed = await server.api.configure(project, member, {lexicalScoring: condition === "A" ? "legacy" : "bm25", ranking: "bounded", topK: protocol.topK, maxCharsPerCard: protocol.maxCharsPerCard, maxTotalChars: protocol.maxTotalChars, toolEnabled: false, injectEnabled: true});
            for (let repetition = 1; repetition <= (condition === "C" ? protocol.modelRepetitions : 1); repetition++) {
              const key = `${task.id}-${query.variant}-${condition}-${repetition}`;
              if (store.done(key)) continue;
              if (spent >= protocol.budgetCny) throw new Error("Model budget reached");
              const seed = `${protocol.seed}:${task.id}:${query.variant}:${repetition}`;
              const result = await server.api.request("/api/projects/demo/experiments/retrieval", member, {prompt: query.query, condition, seed});
              await writeJson(path.join(store.raw(key), "response.json"), result);
              const selected = result.result;
              if (!result.failed) {
                const selectedIds = result.call ? parseRerankSelection(result.call.text, result.call.request.mapping, protocol.topK).map(item => item.cardId) : undefined;
                const offline = await selectKnowledgeInjection({cards: visibleCards, viewerMemberId: member, query: query.query, activeFiles: selected.activeFiles, config: changed.config, workspaceId: project.id, indexDir: path.join(serverDirectory, "replay"), ...(selectedIds ? {selectionPolicy: async () => selectedIds} : {})});
                assert.deepEqual(offline.records, selected.records);
                assert.deepEqual(offline.candidates, selected.candidates);
                assert.equal(offline.section, selected.section);
                if (condition !== "C") {
                  const preview = await server.api.request("/api/projects/demo/knowledge/preview", member, {prompt: query.query});
                  assert.deepEqual(preview.records, selected.records);
                  assert.equal(preview.section, selected.section);
                }
              }
              const ids: string[] = selected?.records.map((item: any) => item.id) ?? [];
              const row = {key, completed: true, task: task.id, taskKind: task.kind, repository, variant: query.variant, condition, repetition,
                failed: result.failed, failureReason: result.failureReason, targetDelivered: task.kind === "trap" ? !result.failed && ids.includes(task.targetCardId!) : null,
                irrelevantDelivered: task.kind === "control" && !result.failed ? ids.some(id => !relevant.includes(id)) : null,
                anyDelivered: !result.failed ? ids.length > 0 : null, resultIds: ids, relevantIds: relevant,
                activeFiles: selected?.activeFiles, activeFileSources: selected?.activeFileSources,
                totalChars: selected?.totalChars, estimatedInjectionTokens: selected?.estimatedInjectionTokens,
                candidates: selected?.candidates, latencyMs: result.latencyMs, modelLatencyMs: result.call?.durationMs,
                usage: result.call?.usage, estimatedCostCny: condition === "C" ? result.call?.estimatedCostCny : 0,
                deliverySources: selected?.records.map((item: any) => ({id: item.id, reason: item.reason})), replayVerified: !result.failed,
                artifacts: path.relative(directory, store.raw(key))};
              await store.append(row);
              spent += row.estimatedCostCny ?? 0;
              console.log(JSON.stringify({key, failed: row.failed, delivered: row.targetDelivered, irrelevant: row.irrelevantDelivered, latencyMs: row.latencyMs, spentCny: spent}));
              if (condition === "C" && row.estimatedCostCny === undefined) throw new Error("Unknown model cost requires review before continuing");
            }
          }
        }
      }
    } finally {await server.close();}
  }
} finally {await store.close();}
