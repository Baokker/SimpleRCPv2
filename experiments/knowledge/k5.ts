import path from "node:path";
import fs from "node:fs/promises";
import {searchKnowledgeCards, type KnowledgeSearchResult} from "@simplercp/knowledge";
import {type Dataset, type ExperimentConfig, RunStore, readJson, readJsonl, writeJson} from "./common.js";

export function retrievalMetrics(ids: string[], relevant: string[]) {
  const relevance = new Set(relevant);
  const rank = ids.findIndex(id => relevance.has(id));
  const dcg = ids.slice(0, 5).reduce((sum, id, index) => sum + (relevance.has(id) ? 1 / Math.log2(index + 2) : 0), 0);
  const ideal = relevant.slice(0, 5).reduce((sum, _, index) => sum + 1 / Math.log2(index + 2), 0);
  return {recall1: relevant.length ? ids.slice(0, 1).filter(id => relevance.has(id)).length / relevant.length : null,
    recall3: relevant.length ? ids.slice(0, 3).filter(id => relevance.has(id)).length / relevant.length : null,
    recall5: relevant.length ? ids.slice(0, 5).filter(id => relevance.has(id)).length / relevant.length : null,
    mrr: relevant.length ? rank < 0 ? 0 : 1 / (rank + 1) : null, ndcg5: ideal ? dcg / ideal : null,
    falseInjections: relevant.length ? null : Math.min(5, ids.length)};
}

export function summarizeRetrieval(rows: Array<ReturnType<typeof retrievalMetrics> & {task: string; taskKind: string}>) {
  const traps = rows.filter(row => row.taskKind === "trap");
  const tasks = [...new Set(traps.map(row => row.task))];
  const metrics = Object.fromEntries((["recall1", "recall3", "recall5", "mrr", "ndcg5"] as const).map(field => {
    const taskMeans = tasks.map(task => {
      const values = traps.filter(row => row.task === task).map(row => row[field]);
      if (values.some(value => value === null)) throw new Error(`Missing ${field} for trap task ${task}`);
      return values.reduce<number>((sum, value) => sum + value!, 0) / values.length;
    });
    return [field, taskMeans.length ? taskMeans.reduce((sum, value) => sum + value, 0) / taskMeans.length : null];
  })) as Pick<ReturnType<typeof retrievalMetrics>, "recall1" | "recall3" | "recall5" | "mrr" | "ndcg5">;
  return {traps: tasks.length, queries: traps.length, ...metrics,
    falseInjections: rows.filter(row => row.taskKind === "control").reduce((sum, row) => sum + (row.falseInjections ?? 0), 0)};
}

// 与 apps/server/src/knowledge/provider.ts 的 rankResults 保持同一排序规则。
export function rankBounded(results: KnowledgeSearchResult[], activeFiles: string[]) {
  const cap = results.reduce((highest, item) => Math.max(highest, item.score), 0) * 0.5;
  const priority = (type: string) => ["negative", "risk", "constraint"].includes(type) ? 0 : ["decision", "context"].includes(type) ? 1 : 2;
  return results.map(item => ({...item, score: item.score + Math.min(cap, item.files.some(file => activeFiles.some(active => file === active || file.endsWith(`/${active}`))) ? 0.06 : 0)}))
    .sort((a, b) => priority(a.type) - priority(b.type) || b.score - a.score).slice(0, 25);
}
export async function runK5(data: Dataset, config: ExperimentConfig, store: RunStore, k3Directory?: string) {
  const toolQueries: Array<{task: string; query: string; source: string; files?: string[]}> = [];
  const activity = new Map<string, {files: string[]; source: string}>();
  if (k3Directory) for (const row of await readJsonl(path.join(k3Directory, "results.jsonl"))) {
    const trace = await readJson<any[]>(path.join(k3Directory, row.artifacts, "trace.json"));
    const injection = trace.find(event => event.type === "knowledge_injected" && Array.isArray(event.data.activeFiles) && event.data.activeFiles.length);
    if (injection && !activity.has(row.task)) activity.set(row.task, {files: injection.data.activeFiles, source: row.key});
    for (const event of trace.filter(item => item.type === "knowledge_tool_call" && item.data.tool === "knowledge_search")) {
      if (typeof event.data.query === "string" && event.data.runId !== "ambiguous") toolQueries.push({task: row.task, query: event.data.query, source: row.key, files: event.data.files});
    }
  }
  await writeJson(path.join(store.directory, "tool-queries.json"), toolQueries);
  const variants = new Set(data.tasks.flatMap(task => task.variantCardIds ?? []));
  for (const task of data.tasks) {
    const cards = data.library.filter(item => item.repository === task.repository && item.card.status === "reviewed" && !variants.has(item.card.id)).map(item => item.card);
    const activeFiles = activity.get(task.id)?.files ?? [...new Set(task.prompt.match(/src\/[A-Za-z0-9_./-]+\.(?:[cm]?[jt]sx?)/gu) ?? [])];
    const targetFiles = cards.find(card => card.id === task.targetCardId)?.anchors.map(anchor => anchor.file.workspaceRelativePath) ?? [];
    const wrongFile = cards.find(card => !activeFiles.includes(card.anchors[0]?.file.workspaceRelativePath) && !targetFiles.includes(card.anchors[0]?.file.workspaceRelativePath))?.anchors[0]?.file.workspaceRelativePath;
    const queries: Array<{condition: string; query: string; active: string[]; queryIndex?: number; source?: string}> = [{condition: "R1", query: task.prompt, active: []}, {condition: "R2", query: task.prompt, active: activeFiles}, {condition: "R3", query: task.prompt, active: activeFiles},
      {condition: "R2-wrong-file", query: task.prompt, active: wrongFile ? [wrongFile] : []}, {condition: "R3-wrong-file", query: task.prompt, active: wrongFile ? [wrongFile] : []},
      ...toolQueries.filter(item => item.task === task.id).map((item, index) => ({condition: "R4", queryIndex: index, query: item.query, active: item.files ?? activeFiles, source: item.source})),
      ...(config.embedding ? [{condition: "R5", query: task.prompt, active: []}] : [])];
    for (const item of queries) {
      const key = `${task.id}-${item.condition}${item.queryIndex === undefined ? "" : `-${item.queryIndex}`}`;
      if (store.done(key)) continue;
      const vector = item.condition === "R5";
      const bounded = item.condition.startsWith("R3") || item.condition.startsWith("R4");
      const results = await searchKnowledgeCards({cards, query: item.query, workspaceId: task.repository, indexDir: path.join(store.raw(key), "index"), topK: 25,
        filters: {statuses: ["reviewed"]}, lexicalScoring: "legacy", ...(!bounded ? {activeFiles: item.active} : {}),
        ...(vector ? {strictEmbedding: true, embeddings: {model: config.embedding!.model, client: {async embed(texts: string[]) {
          const response = await fetch(config.embedding!.origin + "/embeddings", {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify({model: config.embedding!.model, input: texts}), signal: AbortSignal.timeout(config.timeoutMs)});
          if (!response.ok) throw new Error(`Embedding HTTP ${response.status}`);
          const body = await response.json() as any;
          return body.data.sort((a: any, b: any) => a.index - b.index).map((entry: any) => entry.embedding);
        }}}} : {})});
      const ranked = bounded ? rankBounded(results, item.active) : results;
      await writeJson(path.join(store.raw(key), "ranking.json"), ranked);
      await store.append({key, completed: true, task: task.id, taskKind: task.kind, repository: task.repository, condition: item.condition,
        query: item.query, queryIndex: item.queryIndex, querySource: item.source,
        ...retrievalMetrics(ranked.map(result => result.cardId), task.targetCardId ? [task.targetCardId] : []), activeFiles: item.active, activitySource: activity.get(task.id)?.source ?? "prompt-file-paths", artifacts: path.relative(store.directory, store.raw(key))});
    }
  }
  await writeJson(path.join(store.directory, "availability.json"), {R4: {queries: toolQueries.length, reason: toolQueries.length ? null : "K3 记录中没有实际工具查询"}, R5: {configured: Boolean(config.embedding), reason: config.embedding ? null : "没有配置 embedding 服务"}});
}
