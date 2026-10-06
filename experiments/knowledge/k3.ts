import path from "node:path";
import {type KnowledgeCard} from "@simplercp/knowledge";
import {type Dataset, type ExperimentConfig, type Task, RunStore, digest, exists, readJsonl, pool, writeJson} from "./common.js";
import {PlatformClient, judge} from "./client.js";

export type K3Condition = "C0" | "C1" | "C2" | "C3" | "C4" | "C5" | "C6-stale" | "C6-contradiction" | "C7";
export const allK3Conditions: K3Condition[] = ["C0", "C1", "C2", "C3", "C4", "C5", "C6-stale", "C6-contradiction", "C7"];
export function conditionCards(data: Dataset, task: Task, condition: K3Condition) {
  const variants = new Set(data.tasks.flatMap(item => item.variantCardIds ?? []));
  const library = data.library.filter(item => item.repository === task.repository).map(item => item.card);
  let cards = condition === "C0" ? [] : library.filter(card => card.status === "reviewed" && !variants.has(card.id));
  const target = library.find(card => card.id === task.targetCardId);
  let fixedCardIds: string[] = [];
  let lengthDifference: number | null = null;
  if (condition === "C6-stale" && target) {
    cards = cards.filter(card => card.id !== target.id);
    const stale = library.find(card => task.variantCardIds?.includes(card.id) && card.status === "superseded");
    if (!stale) throw new Error(`Stale card is absent: ${task.id}`);
    cards.push({...stale, status: "reviewed"});
  }
  if (condition === "C6-contradiction" && target) {
    const contradictory = library.find(card => task.variantCardIds?.includes(card.id) && card.status === "reviewed");
    if (!contradictory) throw new Error(`Contradictory card is absent: ${task.id}`);
    cards.push(contradictory);
  }
  if (condition === "C5" && target) fixedCardIds = [target.id];
  if (condition === "C7" && target) {
    const irrelevant = library.filter(card => task.irrelevantCardIds?.includes(card.id)).sort((a, b) => Math.abs(a.content.length - target.content.length) - Math.abs(b.content.length - target.content.length))[0];
    if (!irrelevant) throw new Error(`Irrelevant card is absent: ${task.id}`);
    fixedCardIds = [irrelevant.id];
    const matchedContent = (irrelevant.content + "\n").repeat(Math.ceil(target.content.length / (irrelevant.content.length + 1))).slice(0, target.content.length);
    cards = cards.map(card => card.id === irrelevant.id ? {...card, content: matchedContent} : card);
    lengthDifference = matchedContent.length - target.content.length;
  }
  const injectEnabled = ["C2", "C4", "C5", "C6-stale", "C6-contradiction", "C7"].includes(condition) && !(task.kind === "control" && ["C5", "C7"].includes(condition));
  return {cards, configuration: {
    injectEnabled, toolEnabled: ["C3", "C4"].includes(condition), fixedCardIds,
    topK: 5, maxCharsPerCard: 800, maxTotalChars: 4000, lexicalScoring: "legacy", ranking: "bounded",
    postRunCheck: true, inflightNotify: false, proposeEnabled: false
  }, lengthDifference};
}
export function knowledgeUsage(trace: any[], targetCardIds: string[]) {
  const injections = trace.filter(event => event.type === "knowledge_injected");
  const tools = trace.filter(event => event.type === "knowledge_tool_call");
  return {
    targetInjected: injections.some(event => event.data.cards?.some((card: any) => targetCardIds.includes(card.id))),
    targetRetrieved: tools.some(event => event.data.resultIds?.some((id: string) => targetCardIds.includes(id))),
    injectionTokens: injections.reduce((count, event) => count + (event.data.estimatedInjectionTokens ?? 0), 0),
    injectionChars: injections.reduce((count, event) => count + (event.data.totalChars ?? 0), 0),
    toolCalls: tools.length,
    agentToolCalls: new Set(trace.filter(event => event.type.startsWith("opencode.") && event.data?.part?.type === "tool" && ["completed", "error"].includes(event.data.part.state?.status)).map(event => event.data.part.id)).size
  };
}
export async function runK3(data: Dataset, config: ExperimentConfig, store: RunStore, combinations: Array<{task: Task; condition: K3Condition; repetition: number}>) {
  const client = new PlatformClient(config);
  await client.verify();
  await pool(combinations, config.concurrency, async ({task, condition, repetition}) => {
    const key = `${task.id}-${condition}-${repetition}`;
    if (store.done(key)) return;
    const raw = store.raw(key);
    const {project, members} = await client.create(task, raw, key);
    const member = members[0];
    const setup = conditionCards(data, task, condition);
    const stateFile = path.join(raw, "started-run.json");
    const started = Date.now();
    // 已有运行的续跑不重复加载卡片与修改配置。
    if (!await exists(stateFile)) {
      if (setup.cards.length) await client.request(client.projectRoute(project, "experiments/cards/import"), member, {cards: setup.cards});
      const actualConfig = await client.configure(project, member, setup.configuration);
      await writeJson(path.join(raw, "knowledge-config.json"), {actualConfig, cardIds: setup.cards.map(card => card.id), lengthDifference: setup.lengthDifference});
      if (condition === "C1") {
        const exported = await client.request(client.projectRoute(project, "knowledge/export/workspace"), member, {});
        if (exported.path !== "AGENTS.md") throw new Error("C1 requires an automatically read AGENTS.md");
        await writeJson(path.join(raw, "static-export.json"), exported);
      }
    }
    const initial = await client.run(project, member, task.prompt, stateFile);
    const run = await client.wait(project, member, initial);
    const output = await client.collect(project, member, run, raw);
    const actual = await judge(task, output.snapshot, raw);
    if (run.provider !== config.provider || run.model !== config.model || run.runtime !== "opencode") throw new Error("Run used an unexpected model or runtime");
    const usage = knowledgeUsage(output.events, task.targetCardId ? [task.targetCardId] : []);
    await store.append({key, completed: true, task: task.id, repository: task.repository, taskKind: task.kind, condition, repetition,
      projectId: project.id, runId: run.id, runStatus: run.status, functional: actual.functional, trapAvoided: actual.trapAvoided, jointSuccess: actual.jointSuccess,
      usage: run.usage ?? null, ...usage, wallMs: run.startedAt && run.finishedAt ? Date.parse(run.finishedAt) - Date.parse(run.startedAt) : null,
      pipelineMs: Date.now() - started, diffHash: output.diffHash, taskPromptHash: digest(task.prompt), knowledgeConfigHash: digest(setup.configuration), judgeHash: actual.judgeHash,
      artifacts: path.relative(store.directory, raw), error: run.error ?? null});
    console.log(JSON.stringify({key, functional: actual.functional, trapAvoided: actual.trapAvoided, runStatus: run.status, wallMs: Date.now() - started}));
  });
}
export async function calibration(store: RunStore) {
  const rows = await readJsonl(path.join(store.directory, "results.jsonl"));
  const tasks = [...new Set(rows.filter(row => row.condition === "C0" && row.taskKind === "trap").map(row => row.task))];
  const result = tasks.map(task => {
    const attempts = rows.filter(row => row.task === task && row.condition === "C0" && row.repetition <= 3);
    const tooEasy = attempts.length === 3 && attempts.every(row => row.trapAvoided);
    const tooHard = attempts.length === 3 && attempts.every(row => !row.functional);
    return {task, attempts: attempts.length, functionalPassed: attempts.filter(row => row.functional).length, trapsAvoided: attempts.filter(row => row.trapAvoided).length, tooEasy, tooHard};
  });
  await writeJson(path.join(store.directory, "calibration.json"), result);
  return result;
}
