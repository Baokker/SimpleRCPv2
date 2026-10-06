import fs from "node:fs/promises";
import path from "node:path";
import get from "lodash/get.js";
import {stringify} from "csv-stringify/sync";
import {parseKnowledgeCardDraftFromText, parseAgentRecapDraft, type KnowledgeCardType} from "@simplercp/knowledge";
import {type Dataset, type ExperimentConfig, type Task, RunStore, digest, exists, readJson, readJsonl, writeJson} from "./common.js";
import {PlatformClient} from "./client.js";
import {normalizeScript} from "./k1.js";

type Episode = {id: string; task: Task; evidence: Record<string, unknown>; trigger: string; mustMention: string; expectedTypes: KnowledgeCardType[]};
export function draftMetrics(raw: string, mode: string, evidence: Record<string, unknown>, mustMention: string, expectedTypes: string[]) {
  const parsed = mode === "ordinary" ? parseKnowledgeCardDraftFromText(raw) as any : parseAgentRecapDraft(raw, evidence) as any;
  const content = mode === "ordinary" ? parsed?.content : [parsed?.whatHappened, parsed?.correction, parsed?.rule, parsed?.notApplicable].filter(Boolean).join("\n");
  const validStructure = Boolean(parsed && parsed.title.length >= 4 && parsed.summary.length >= 12 && content.length >= 40 && Array.isArray(parsed.evidenceCitations) && Array.isArray(parsed.unknowns));
  const citations: string[] = parsed?.evidenceCitations ?? [];
  const validCitations = citations.length > 0 && citations.every(citation => get({evidence, payload: evidence}, citation) !== undefined || get(evidence, citation) !== undefined);
  const mustMentionCovered = `${parsed?.summary ?? ""}\n${content ?? ""}`.includes(mustMention);
  return {validStructure, validCitations, mustMentionCovered, acceptedType: expectedTypes.includes(parsed?.type), groundedPass: validStructure && validCitations && mustMentionCovered};
}
export async function episodes(data: Dataset, k4Directory?: string): Promise<Episode[]> {
  const rows: Episode[] = [];
  for (const pair of data.transfers) {
    let evidence: Record<string, unknown> = {task: pair.ta.prompt, correction: pair.correction.text, file: pair.gold.anchors[0].file.workspaceRelativePath};
    if (k4Directory) {
      const results = await readJsonl(path.join(k4Directory, "results.jsonl"));
      const row = results.find(item => item.pair === pair.id && item.condition === "T3");
      if (row) {
        const suggestion = await readJson(path.join(k4Directory, row.artifacts, "suggestion.json"));
        evidence = suggestion.evidence;
      }
    }
    rows.push({id: pair.id, task: pair.ta, evidence, trigger: "agent.corrected", mustMention: `${pair.gold.title} ${pair.gold.content}`.match(/[A-Za-z][A-Za-z0-9_.]+/u)?.[0] ?? path.basename(pair.gold.anchors[0].file.workspaceRelativePath), expectedTypes: [pair.gold.type]});
  }
  for (const id of ["S01", "S02"]) {
    const input = await normalizeScript(id);
    for (const moment of input.labels.knowledgeMoments) {
      const file = moment.discussedCode[0].file;
      const references = input.events.filter(event => event.at >= Math.max(0, moment.tStart - 120) * 1000 && event.at <= moment.tEnd * 1000);
      const inference = input.labels.anchorInference.find((item: any) => item.momentId === moment.id);
      rows.push({id: moment.id, task: data.tasks.find(task => task.repository === input.metadata.repository)!, trigger: moment.expectedTrigger,
        evidence: {file, events: references, code: input.texts.get(file)}, mustMention: inference?.symbol ?? path.basename(file), expectedTypes: [moment.knowledgeType]});
    }
  }
  return rows;
}
export async function runK2(data: Dataset, config: ExperimentConfig, store: RunStore, k4Directory?: string, limit?: number) {
  const api = new PlatformClient(config); await api.verify();
  const selected = (await episodes(data, k4Directory)).slice(0, limit);
  for (const episode of selected) {
    const projectRaw = store.raw(`${episode.id}-context`);
    const {project, members} = await api.create(episode.task, projectRaw, `${episode.id}-K2`);
    await api.configure(project, members[0], {injectEnabled: false, toolEnabled: false, proposeEnabled: false});
    for (const mode of ["ordinary", "server", "agent-self"]) {
      const key = `${episode.id}-${mode}`;
      if (store.done(key)) continue;
      const raw = store.raw(key), cache = path.join(raw, "response.json");
      const request = {mode, evidence: episode.evidence, triggerType: episode.trigger};
      let response: any;
      if (await exists(cache)) {
        const saved = await readJson(cache);
        if (saved.requestHash !== digest(request)) throw new Error(`K2 cache input changed: ${key}`);
        response = saved.response;
      } else {
        let runId: string | undefined;
        if (mode === "agent-self") {
          const run = await api.run(project, members[0], `阅读当前项目，了解下面这段协作证据涉及的内容。保持文件内容原样。\n${JSON.stringify(episode.evidence).slice(0, 16000)}`, path.join(projectRaw, "context-run.json"));
          const completed = await api.wait(project, members[0], run);
          if (completed.status !== "completed") throw new Error(`K2 Agent context failed: ${completed.status}`);
          runId = run.id;
        }
        response = await api.request(api.projectRoute(project, "experiments/drafts"), members[0], {...request, runId});
        await writeJson(cache, {requestHash: digest(request), request, response});
      }
      const text = response.responses.at(-1) ?? "";
      const metrics = draftMetrics(text, mode, episode.evidence, episode.mustMention, episode.expectedTypes);
      await store.append({key, completed: true, episode: episode.id, condition: mode, ...metrics, fallback: response.fallback, latencyMs: response.latencyMs,
        calls: response.calls, outputHash: digest(response.draft), artifacts: path.relative(store.directory, raw)});
    }
  }
  const results = await readJsonl(path.join(store.directory, "results.jsonl"));
  const table = [];
  for (const row of results) {
    const cached = await readJson(path.join(store.directory, row.artifacts, "response.json"));
    table.push({id: row.key, draft: JSON.stringify(cached.response.draft), ruleCorrect: "", checkable: "", scopeSuitable: "", boundariesReasonable: "", notes: ""});
  }
  for (const annotator of ["a", "b"]) await fs.writeFile(path.join(store.directory, `ratings-${annotator}.csv`), stringify(table, {header: true}));
}
