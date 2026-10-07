import fs from "node:fs/promises";
import path from "node:path";
import {stringify} from "csv-stringify/sync";
import {parse} from "csv-parse/sync";
import {z} from "zod";
import {extractFirstJsonObject, parseKnowledgeCardDraftFromText, parseAgentRecapDraft, citationExists, type KnowledgeCardType} from "@simplercp/knowledge";
import {type Dataset, type ExperimentConfig, type Task, RunStore, digest, exists, readJson, readJsonl, writeJson} from "./common.js";
import {PlatformClient} from "./client.js";
import {normalizeScript} from "./k1.js";

type Episode = {id: string; pairId?: string; task: Task; evidence: Record<string, unknown>; trigger: string; mustMention: string; expectedTypes: KnowledgeCardType[]};
const ordinaryDraftSchema = z.object({type: z.enum(["decision", "constraint", "risk", "context", "negative", "tutorial"]), title: z.string().min(4), summary: z.string().min(12), content: z.string().min(40), tags: z.array(z.string()), confidence: z.number().min(0).max(1), evidenceCitations: z.array(z.string().min(1)).min(1), unknowns: z.array(z.string())});
export function draftMetrics(raw: string, mode: string, evidence: Record<string, unknown>, mustMention: string, expectedTypes: string[]) {
  const parsed = mode === "ordinary" ? parseKnowledgeCardDraftFromText(raw) as any : parseAgentRecapDraft(raw, evidence) as any;
  const content = mode === "ordinary" ? parsed?.content : [parsed?.whatHappened, parsed?.correction, parsed?.rule, parsed?.notApplicable].filter(Boolean).join("\n");
  const json = extractFirstJsonObject(raw);
  const original = json ? JSON.parse(json) : {};
  const validStructure = mode === "ordinary" ? ordinaryDraftSchema.safeParse(original).success : Boolean(parsed && typeof parsed.title === "string" && parsed.title.length >= 4 && typeof parsed.summary === "string" && parsed.summary.length >= 12 && typeof content === "string" && content.length >= 40 && Array.isArray(parsed.evidenceCitations) && Array.isArray(parsed.unknowns));
  const citations = original.evidenceCitations;
  const validCitations = Array.isArray(citations) && citations.length > 0 && citations.every(citation => typeof citation === "string" && (citationExists(citation, evidence) || citationExists(citation, {payload: evidence})));
  const mustMentionCovered = `${parsed?.summary ?? ""}\n${content ?? ""}`.includes(mustMention);
  return {validStructure, validCitations, mustMentionCovered, acceptedType: expectedTypes.includes(parsed?.type), groundedPass: validStructure && validCitations && mustMentionCovered};
}
export async function episodes(data: Dataset, k4Directory?: string): Promise<Episode[]> {
  const rows: Episode[] = [];
  if (k4Directory) for (const row of await readJsonl(path.join(k4Directory, "results.jsonl"))) {
    if (!row.completed) continue;
    const pair = data.transfers.find(item => item.id === row.pair);
    if (!pair) throw new Error(`Unknown correction pair: ${row.pair}`);
    const raw = path.join(k4Directory, row.artifacts);
    const correction = await readJson(path.join(raw, "correction-applied.json"));
    const suggestionFile = path.join(raw, "suggestion.json");
    const suggestion = await exists(suggestionFile) ? await readJson(suggestionFile) : undefined;
    const evidence = suggestion?.evidence ?? {task: pair.ta.prompt, correction: correction.text,
      previousRun: await readJson(path.join(raw, "ta/run.json")), previousDiff: await fs.readFile(path.join(raw, "ta/workspace.patch"), "utf8"),
      correctedRun: await readJson(path.join(raw, "correction/run.json")), correctedDiff: await fs.readFile(path.join(raw, "correction/workspace.patch"), "utf8")};
    rows.push({id: row.key, pairId: pair.id, task: {...pair.ta, workspaceSource: path.join(raw, "correction/workspace")}, evidence,
      trigger: suggestion?.triggerType ?? "agent.corrected", mustMention: `${pair.gold.title} ${pair.gold.content}`.match(/[A-Za-z][A-Za-z0-9_.]+/u)?.[0] ?? path.basename(pair.gold.anchors[0].file.workspaceRelativePath), expectedTypes: [pair.gold.type]});
  }
  for (const id of ["S01", "S02"]) {
    const input = await normalizeScript(id);
    for (const moment of input.labels.knowledgeMoments) {
      const file = moment.discussedCode[0].file;
      const references = input.events.filter(event => event.at >= Math.max(0, moment.tStart - 120) * 1000 && event.at <= moment.tEnd * 1000);
      const inference = input.labels.anchorInference.find((item: any) => item.momentId === moment.id);
      let code = input.texts.get(file);
      for (const event of input.events.filter(event => event.at <= moment.tEnd * 1000)) {
        if ("file" in event && event.file === file && "textAfter" in event && typeof event.textAfter === "string") code = event.textAfter;
      }
      rows.push({id: moment.id, task: data.tasks.find(task => task.repository === input.metadata.repository)!, trigger: moment.expectedTrigger,
        evidence: {file, events: references, code}, mustMention: inference?.symbol ?? path.basename(file), expectedTypes: [moment.knowledgeType]});
    }
  }
  return rows;
}
export async function runK2(data: Dataset, config: ExperimentConfig, store: RunStore, k4Directory?: string, limit?: number) {
  const api = new PlatformClient(config); await api.verifyFor(store.directory);
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
          await writeJson(path.join(projectRaw, "context-run-completed.json"), {run: completed});
          await api.collect(project, members[0], completed, path.join(projectRaw, "agent-context"));
          runId = run.id;
        }
        response = await api.request(api.projectRoute(project, "experiments/drafts"), members[0], {...request, runId});
        await writeJson(cache, {requestHash: digest(request), request, response});
      }
      const text = response.responses.at(-1) ?? "";
      const evaluatedEvidence = response.evidence ?? episode.evidence;
      const metrics = draftMetrics(text, mode, evaluatedEvidence, episode.mustMention, episode.expectedTypes);
      await store.append({key, completed: true, episode: episode.id, pair: episode.pairId, condition: mode, ...metrics, fallback: response.fallback, latencyMs: response.latencyMs,
        mustMention: episode.mustMention, evidenceHash: digest(evaluatedEvidence), expectedTypes: episode.expectedTypes,
        calls: response.calls, outputHash: digest(response.draft), artifacts: path.relative(store.directory, raw)});
    }
  }
  const results = await readJsonl(path.join(store.directory, "results.jsonl"));
  const table = [];
  for (const row of results) {
    const cached = await readJson(path.join(store.directory, row.artifacts, "response.json"));
    table.push({id: row.key, draft: JSON.stringify(cached.response.draft), ruleCorrect: "", checkable: "", scopeSuitable: "", boundariesReasonable: "", notes: ""});
  }
  for (const annotator of ["a", "b"]) await updateRatingSheet(path.join(store.directory, `ratings-${annotator}.csv`), table);
}
export async function updateRatingSheet(file: string, drafts: Array<{id: string; draft: string}>) {
  const fields = ["id", "draft", "ruleCorrect", "checkable", "scopeSuitable", "boundariesReasonable", "notes"];
  const previous: Record<string, string>[] = await exists(file) ? parse(await fs.readFile(file, "utf8"), {columns: true}) : [];
  const saved = new Map(previous.map(row => [row.id, row]));
  if (saved.size !== previous.length) throw new Error("Rating sheet contains duplicate ids");
  for (const row of previous) if (fields.some(field => !(field in row))) throw new Error("Rating sheet columns differ");
  const rows = drafts.map(draft => {
    const row = saved.get(draft.id);
    if (row && row.draft !== draft.draft) throw new Error(`Rated draft changed: ${draft.id}`);
    return row ?? {...Object.fromEntries(fields.map(field => [field, ""])), ...draft};
  });
  if (previous.some(row => !drafts.some(draft => draft.id === row.id))) throw new Error("Rating sheet refers to an absent result");
  const temporary = `${file}.next`;
  await fs.writeFile(temporary, stringify(rows, {header: true, columns: fields}));
  await fs.rename(temporary, file);
}
