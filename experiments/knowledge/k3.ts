import path from "node:path";
import {type KnowledgeCard} from "@simplercp/knowledge";
import {benchRoot, type Dataset, type ExperimentConfig, type Task, RunStore, digest, exists, readJson, readJsonl, pool, writeJson} from "./common.js";
import {PlatformClient, judge} from "./client.js";
import {attemptDirectory} from "./interruption.js";

export type K3Condition = "C0" | "C1" | "C1s" | "C2" | "C3" | "C4" | "C5" | "C6a" | "C6b" | "C6-stale" | "C6-contradiction" | "C7" | "C1-NT40" | "C1-NT500" | "C2-NT500";
export const allK3Conditions: K3Condition[] = ["C0", "C1", "C1s", "C2", "C5", "C6a", "C6b", "C7", "C1-NT40", "C1-NT500", "C2-NT500"];
// provider.ts 的固定卡片格式；导入后的 author 与 confirmedBy 在同一项目内长度一致。
export function fixedCardVariableChars(card: KnowledgeCard) {
  const anchors = card.anchors.map(anchor => `${anchor.file.workspaceRelativePath}${anchor.rangeAtCapture ? `:${anchor.rangeAtCapture.start.line + 1}-${anchor.rangeAtCapture.end.line + 1}` : ""}`).join(", ");
  return `[cardId=${card.id}] ${card.type} ${card.title} (score=1.000)\nsummary: ${card.summary}\ncontent: \nanchors: ${anchors || "none"}\nauthor: ; confirmedBy: `.length;
}
function globToRegExp(pattern: string) {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*\*/g, "\u0000").replace(/\*/g, "[^/]*").replace(/\u0000/g, ".*").replace(/\?/g, "[^/]");
  return new RegExp(`^${escaped}$`);
}
function pathMatchesActive(path: string, activeFiles: string[]) {
  return activeFiles.some(active => {
    if (path === active) return true;
    if (path.endsWith("/")) return active.startsWith(path);
    if (/[*?]/.test(path)) return globToRegExp(path).test(active);
    if (!path.includes(".")) return active === path || active.startsWith(`${path}/`);
    return false;
  });
}
export function c1sSelectedCards(cards: KnowledgeCard[], activeFiles: string[]) {
  return cards.filter(card => {
    const applies = card.appliesTo;
    if (!applies || applies.kind === "project") return true;
    const patterns = applies.kind === "glob" ? applies.patterns : [];
    const anchors = card.anchors.map(anchor => anchor.file.workspaceRelativePath);
    return [...patterns, ...anchors].some(path => pathMatchesActive(path, activeFiles));
  });
}
async function workspaceFiles(root: string): Promise<string[]> {
  const files: string[] = [];
  const ignored = new Set(["node_modules", ".git", "__MACOSX"]);
  async function visit(directory: string, relative: string) {
    for (const entry of await (await import("node:fs/promises")).readdir(directory, {withFileTypes: true})) {
      const child = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isSymbolicLink() || child.split("/").some(segment => ignored.has(segment)) || entry.name === ".DS_Store") continue;
      const absolute = `${directory}/${entry.name}`;
      if (entry.isDirectory()) await visit(absolute, child);
      else if (entry.isFile()) files.push(child);
    }
  }
  await visit(root, "");
  return files;
}
export async function c1sActiveFiles(task: Task) {
  const files = await workspaceFiles(task.workspaceSource ?? path.join(benchRoot, "repos", task.repository));
  return files.filter(file => task.prompt.includes(file));
}
export function conditionCards(data: Dataset, task: Task, condition: K3Condition, activeFiles: string[] = []) {
  const variants = new Set(data.tasks.flatMap(item => item.variantCardIds ?? []));
  const library = data.library.filter(item => item.repository === task.repository).map(item => item.card);
  let cards = condition === "C0" ? [] : library.filter(card => card.status === "reviewed" && !variants.has(card.id));
  if (condition === "C1s") cards = c1sSelectedCards(cards, activeFiles);
  const target = library.find(card => card.id === task.targetCardId);
  let fixedCardIds: string[] = [];
  let lengthDifference: number | null = null;
  if (["C6a", "C6-stale"].includes(condition) && target) {
    cards = cards.filter(card => card.id !== target.id);
    const stale = library.find(card => task.variantCardIds?.includes(card.id) && card.status === "superseded");
    if (!stale) throw new Error(`Stale card is absent: ${task.id}`);
    cards.push({...stale, status: "reviewed"});
    fixedCardIds = [stale.id];
  }
  if (["C6b", "C6-contradiction"].includes(condition) && target) {
    const contradictory = library.find(card => task.variantCardIds?.includes(card.id) && card.status === "reviewed");
    if (!contradictory) throw new Error(`Contradictory card is absent: ${task.id}`);
    cards.push(contradictory);
    fixedCardIds = [target.id, contradictory.id];
  }
  if (condition === "C5" && target) fixedCardIds = [target.id];
  if (condition === "C7" && target) {
    const targetChars = fixedCardVariableChars(target) + Math.min(800, target.content.length);
    const irrelevant = library.filter(card => task.irrelevantCardIds?.includes(card.id) && targetChars - fixedCardVariableChars(card) >= 40 && targetChars - fixedCardVariableChars(card) <= 800).sort((a, b) => Math.abs(fixedCardVariableChars(a) + a.content.length - targetChars) - Math.abs(fixedCardVariableChars(b) + b.content.length - targetChars))[0];
    if (!irrelevant) throw new Error(`Irrelevant card is absent: ${task.id}`);
    fixedCardIds = [irrelevant.id];
    const required = targetChars - fixedCardVariableChars(irrelevant);
    const matchedContent = (irrelevant.content + "\n").repeat(Math.ceil(required / (irrelevant.content.length + 1))).slice(0, required);
    cards = cards.map(card => card.id === irrelevant.id ? {...card, content: matchedContent} : card);
    lengthDifference = fixedCardVariableChars(irrelevant) + matchedContent.length - targetChars;
  }
  const injectEnabled = (["C2", "C4", "C5", "C6a", "C6b", "C6-stale", "C6-contradiction", "C7"].includes(condition) || condition.startsWith("C2-NT")) && !(task.kind === "control" && ["C5", "C6a", "C6b", "C7"].includes(condition));
  return {cards, ...(condition === "C1s" ? {selection: {activeFiles, candidateCount: library.filter(card => card.status === "reviewed" && !variants.has(card.id)).length, selectedCount: cards.length, selectedCardIds: cards.map(card => card.id), targetIncluded: task.targetCardId ? cards.some(card => card.id === task.targetCardId) : false}} : {}), configuration: {
    injectEnabled, toolEnabled: ["C3", "C4"].includes(condition), fixedCardIds,
    topK: 5, maxCharsPerCard: 800, maxTotalChars: 4000, lexicalScoring: condition === "C2" || condition.startsWith("C2-NT") ? "bm25" : "legacy", ranking: "bounded",
    postRunCheck: true, inflightNotify: false, proposeEnabled: false
  }, lengthDifference};
}
export function knowledgeUsage(trace: any[], targetCardIds: string[]) {
  const injections = trace.filter(event => event.type === "knowledge_injected");
  const tools = trace.filter(event => event.type === "knowledge_tool_call");
  const rankingSource = injections.map(event => event.data?.rankingSource).find((value: unknown): value is "m3" | "bm25-fallback" => value === "m3" || value === "bm25-fallback");
  const rerankFallbackReason = injections.map(event => event.data?.rerankFallbackReason).find((value: unknown): value is string => typeof value === "string");
  const delivery = {lexical: 0, fileRelated: 0, projectFallback: 0};
  const targetDelivery = {lexical: 0, fileRelated: 0, projectFallback: 0};
  const targetCandidate = injections.flatMap(event => event.data?.candidates ?? []).find((candidate: any) => targetCardIds.includes(candidate.id));
  for (const event of injections) for (const card of event.data?.cards ?? []) {
    const source = card.reason === "lexical" ? "lexical" : card.reason === "fileRelated" ? "fileRelated" : card.reason === "project-fallback" ? "projectFallback" : undefined;
    if (source) {
      delivery[source] += 1;
      if (targetCardIds.includes(card.id)) targetDelivery[source] += 1;
    }
  }
  return {
    targetInjected: injections.some(event => event.data.cards?.some((card: any) => targetCardIds.includes(card.id))),
    targetCandidate: targetCandidate ?? null,
    targetRetrieved: tools.some(event => event.data.resultIds?.some((id: string) => targetCardIds.includes(id))),
    injectionTokens: injections.reduce((count, event) => count + (event.data.estimatedInjectionTokens ?? 0), 0),
    injectionChars: injections.reduce((count, event) => count + (event.data.totalChars ?? 0), 0),
    delivery, targetDelivery, rankingSource: rankingSource ?? null, rerankFallbackReason: rerankFallbackReason ?? null,
    toolCalls: tools.length,
    agentToolCalls: new Set(trace.filter(event => event.type.startsWith("opencode.") && event.data?.part?.type === "tool" && ["completed", "error"].includes(event.data.part.state?.status)).map(event => event.data.part.id)).size
  };
}
export async function runK3(data: Dataset, config: ExperimentConfig, store: RunStore, combinations: Array<{task: Task; condition: K3Condition; repetition: number}>, libraries: Record<string, Array<{repository: string; card: KnowledgeCard}>> = {}, libraryPaths: Record<string, string> = {}) {
  const client = new PlatformClient(config);
  await client.verifyFor(store.directory);
  await pool(combinations, config.concurrency, async ({task, condition, repetition}) => {
    const key = `${task.id}-${condition}-${repetition}`;
    if (store.done(key)) return;
    client.checkScheduling();
    const raw = store.raw(key);
    await attemptDirectory(raw, "started-run.json");
    const {project, members} = await client.create(task, raw, key);
    const member = members[0];
    const activeFiles = condition === "C1s" ? await c1sActiveFiles(task) : [];
    const conditionData = libraries[condition] ? {...data, library: libraries[condition]} : data;
    const setup = conditionCards(conditionData, task, condition, activeFiles);
    const configuration = {...setup.configuration, ...(config.toolInstructionPlacement ? {toolInstructionPlacement: config.toolInstructionPlacement} : {})};
    const stateFile = path.join(raw, "started-run.json");
    const started = Date.now();
    // 已有运行的续跑不重复加载卡片与修改配置。
    if (!await exists(stateFile)) {
      if (setup.cards.length) await client.request(client.projectRoute(project, "experiments/cards/import"), member, {cards: setup.cards});
      const actualConfig = await client.configure(project, member, configuration);
      await writeJson(path.join(raw, "knowledge-config.json"), {actualConfig, cardIds: setup.cards.map(card => card.id), lengthDifference: setup.lengthDifference});
      await writeJson(path.join(raw, "knowledge-cards.json"), (await client.request(client.projectRoute(project, "knowledge/cards"), member)).cards);
      if (condition === "C1" || condition === "C1s" || condition.startsWith("C1-NT")) {
        const exported = await client.request(client.projectRoute(project, "knowledge/export/workspace"), member, {});
        if (exported.path !== "AGENTS.md") throw new Error(`${condition} requires an automatically read AGENTS.md`);
        await writeJson(path.join(raw, "static-export.json"), exported);
        if (condition === "C1s") await writeJson(path.join(raw, "c1s-selection.json"), {...setup.selection, chars: exported.markdown.length, estimatedTokens: Math.ceil(exported.markdown.length / 4), channel: "root-AGENTS.md"});
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
      library: libraryPaths[condition] ?? null,
      usage: run.usage ?? null, ...(condition === "C1s" ? {c1s: {...setup.selection, chars: (await readJson(path.join(raw, "c1s-selection.json"))).chars, estimatedTokens: (await readJson(path.join(raw, "c1s-selection.json"))).estimatedTokens}} : {}), rerankCalls: output.modelCalls, rerankEstimatedCost: output.modelCalls.reduce((sum: number, call: any) => sum + (call.estimatedCost ?? 0), 0), ...usage, wallMs: run.startedAt && run.finishedAt ? Date.parse(run.finishedAt) - Date.parse(run.startedAt) : null,
      pipelineMs: Date.now() - started, diffHash: output.diffHash, taskPromptHash: digest(task.prompt), knowledgeConfigHash: digest(configuration), judgeHash: actual.judgeHash,
      artifacts: path.relative(store.directory, raw), error: run.error ?? null});
    console.log(JSON.stringify({key, functional: actual.functional, trapAvoided: actual.trapAvoided, runStatus: run.status, wallMs: Date.now() - started}));
  }, error => client.stop(error));
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
