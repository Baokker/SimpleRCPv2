import fs from "node:fs/promises";
import path from "node:path";
import {applyPatch, parsePatch, diffChars} from "diff";
import {parseAgentRecapDraft, type KnowledgeCard} from "@simplercp/knowledge";
import type {AgentRun} from "@simplercp/shared";
import {type Dataset, type ExperimentConfig, RunStore, root, benchRoot, digest, exists, pause, pool, readJson, readJsonl, writeJson} from "./common.js";
import {PlatformClient, judge} from "./client.js";
import {CollaborationClient} from "./collaboration.js";
import {knowledgeUsage} from "./k3.js";
import {attemptDirectory, isQuotaFailure} from "./interruption.js";
import {draftMetrics} from "./k2.js";

export type K4Condition = "T0" | "T1" | "T2" | "T3" | "T4" | "T5";
export const allK4Conditions: K4Condition[] = ["T0", "T1", "T2", "T3", "T4", "T5"];
export function draftHasRequiredTokens(modelDraft: Record<string, unknown>, requiredTokens: string[]) {
  const serialized = JSON.stringify(modelDraft);
  return requiredTokens.every(token => serialized.includes(token));
}
export async function correctionReferenceFiles(pair: Dataset["transfers"][number]) {
  if (pair.correction.mode !== "revise" || pair.correction.revision?.strategy !== "reference-files") throw new Error(`Unsupported correction strategy: ${pair.id}`);
  const reference = await fs.readFile(path.join(pair.directory, pair.correction.revision.referencePatch), "utf8");
  return Promise.all(parsePatch(reference).map(async patch => {
    const file = (patch.newFileName ?? patch.oldFileName)!.replace(/^[ab]\//u, "");
    if (path.isAbsolute(file) || file.split("/").includes("..")) throw new Error("Correction file must be within the workspace");
    const baseline = patch.oldFileName === "/dev/null" ? "" : await fs.readFile(path.join(pair.ta.workspaceSource ?? path.join(benchRoot, "repos", pair.ta.repository), file), "utf8");
    const afterText = applyPatch(baseline, patch);
    if (afterText === false) throw new Error(`Reference correction cannot be applied: ${file}`);
    return {file, afterText};
  }));
}
export function correctionContext(text: string, diff: string, limit = 800) {
  const prefix = `${text}\n\nTa diff:\n`;
  if (prefix.length > limit) throw new Error("Correction text exceeds the configured card budget");
  const summary = parsePatch(diff).map(patch => [
    patch.newFileName ?? patch.oldFileName,
    ...patch.hunks.flatMap(hunk => hunk.lines.filter(line => line.startsWith("+") || line.startsWith("-")))
  ].join("\n")).join("\n\n");
  return prefix + summary.slice(0, limit - prefix.length);
}
export async function reviewPatch(pairId: string, card: KnowledgeCard, gold: KnowledgeCard) {
  const rules = await readJson<Record<string, {requiredTokens: string[]; files: string[]}>>(path.join(root, "review-rules.json"));
  const rule = rules[pairId];
  if (!rule) throw new Error(`Review rule is absent: ${pairId}`);
  const patch: Record<string, unknown> = {};
  if (card.fallback || rule.requiredTokens.some(token => !card.content.includes(token))) {
    patch.content = gold.content; patch.summary = gold.summary; patch.title = gold.title; patch.type = gold.type;
  }
  const patterns = card.appliesTo?.kind === "glob" ? card.appliesTo.patterns : [];
  if (rule.files.some(file => !patterns.includes(file))) patch.appliesTo = {kind: "glob", patterns: rule.files};
  return {patch, changedFields: Object.keys(patch), changedChars: Object.entries(patch).reduce((sum, [field, value]) => sum + diffChars(JSON.stringify((card as any)[field] ?? ""), JSON.stringify(value)).filter(part => part.added || part.removed).reduce((total, part) => total + part.value.length, 0), 0), rulesHash: digest(rules)};
}

export async function runK4(data: Dataset, config: ExperimentConfig, store: RunStore, combinations: Array<{pair: Dataset["transfers"][number]; condition: K4Condition; variant: "delayed" | "same-session"; repetition: number}>) {
  const api = new PlatformClient(config); await api.verifyFor(store.directory);
  await pool(combinations, config.concurrency, async ({pair, condition, variant, repetition}) => {
    const key = `${pair.id}-${condition}-${variant}-${repetition}`;
    if (store.done(key)) return;
    const raw = store.raw(key), started = Date.now();
    const {project, members} = await api.create(pair.ta, raw, key);
    const a = members[0], b = members[1];
    const correcting = pair.correction.member.endsWith("member-b") ? b : a;
    const correctionFiles: Array<{file: string; beforeText: string; afterText: string}> = [];
    const route = (suffix: string) => api.projectRoute(project, suffix);
    const teamFile = path.join(raw, "team-agent.json");
    const team = await exists(teamFile) ? await readJson(teamFile) : (await api.request(route("team-agents"), a, {name: "transfer-agent"})).agent;
    if (!await exists(teamFile)) await writeJson(teamFile, team);
    const initialPath = path.join(raw, "ta-started.json");
    if (!await exists(initialPath)) {
      await api.configure(project, a, {injectEnabled: false, toolEnabled: false, proposeEnabled: false, recapMode: condition === "T5" ? "agent-self" : "server"});
      if (condition === "T0") await api.request(route("experiments/capture/disable"), a, {});
    }
    const initial = await api.teamRun(project, a, team.handle, pair.ta.prompt, initialPath);
    const correctionFile = path.join(raw, "correction-applied.json");
    let ta: AgentRun;
    if (!await exists(correctionFile)) {
      const scheduled = Date.parse(initial.createdAt) + pair.correction.atSeconds * 1000;
      if (scheduled > Date.now()) await pause(scheduled - Date.now());
      const taJudged = path.join(raw, "ta-judge.json");
      if (!await exists(taJudged)) {
        if (pair.correction.mode === "interrupt") await api.request(route(`agent/runs/${initial.id}/cancel`), correcting, {});
        ta = await api.wait(project, a, initial);
        const before = await api.collect(project, a, ta, path.join(raw, "ta"));
        await writeJson(taJudged, await judge(pair.ta, before.snapshot, path.join(raw, "ta")));
      } else ta = await readJson(path.join(raw, "ta/run.json"));
      if (pair.correction.mode === "revise") {
        const revisions = await correctionReferenceFiles(pair);
        const collaboration = new CollaborationClient(api, project); await collaboration.join(correcting);
        try {
          for (const {file, afterText} of revisions) {
            const workspaceFile = path.join(project.workspacePath, file);
            const present = await exists(workspaceFile);
            const current = present ? await fs.readFile(workspaceFile, "utf8") : "";
            if (!present) await api.request(route("workspace/file"), correcting, {path: file, content: ""}, "PUT");
            if (current !== afterText) await collaboration.replace(correcting, file, current, afterText);
            correctionFiles.push({file, beforeText: current, afterText});
          }
          await api.request(route("chat"), correcting, {text: pair.correction.text});
        } finally {await collaboration.close();}
      }
      const correction = await api.teamRun(project, correcting, team.handle, pair.correction.text, path.join(raw, "correction-run.json"));
      ta = await api.wait(project, a, initial);
      await writeJson(path.join(raw, "ta/run.json"), ta);
      await writeJson(correctionFile, {at: Date.now(), memberId: correcting, correctionRunId: correction.id, text: pair.correction.text, interruptedStatus: ta.status, correctionFiles});
    } else ta = await readJson(path.join(raw, "ta/run.json"));
    const revised = await readJson<AgentRun>(path.join(raw, "correction-run.json"));
    const correctionRun = await api.wait(project, correcting, revised);
    const savedCorrection = path.join(raw, "correction/run.json");
    if (await exists(savedCorrection)) {
      const saved = await readJson<AgentRun>(savedCorrection);
      if (saved.id !== correctionRun.id || saved.status !== correctionRun.status) throw new Error("Saved correction run differs from the current run");
      for (const artifact of ["workspace", "workspace.patch", "trace.json"]) if (!await exists(path.join(raw, "correction", artifact))) throw new Error(`Saved correction artifact is absent: ${artifact}`);
    } else await api.collect(project, correcting, correctionRun, path.join(raw, "correction"));
    const correctionJudgeFile = path.join(raw, "correction-judge.json");
    if (!await exists(correctionJudgeFile)) await writeJson(correctionJudgeFile, await judge(pair.ta, path.join(raw, "correction/workspace"), path.join(raw, "correction")));
    if (!(await readJson(correctionJudgeFile)).jointSuccess) throw new Error(`Correction did not pass the behavior checks: ${key}`);
    const cardFile = path.join(raw, "confirmed-card.json");
    let card: KnowledgeCard | null = await exists(cardFile) ? await readJson(cardFile) : null;
    if (!await exists(cardFile)) {
      if (condition === "T1") {
        const taDiff = await fs.readFile(path.join(raw, "ta/workspace.patch"), "utf8");
        const response = await api.request(route("knowledge/cards"), a, {type: "context", title: "本次纠正上下文", summary: pair.correction.text, content: correctionContext(pair.correction.text, taDiff), tags: ["experiment:T1"], scope: "team"});
        card = response.card;
      } else if (condition !== "T0") {
        const versions = await Promise.all(((await readJson(correctionFile)).correctionFiles ?? []).map(async (file: {file: string; beforeText: string; afterText: string}) => ({...file, afterText: await fs.readFile(path.join(project.workspacePath, file.file), "utf8")})));
        const suggestionFile = path.join(raw, "suggestion.json");
        const observationFile = path.join(raw, "capture-observation.json");
        const savedSuggestion = await exists(suggestionFile) ? await readJson(suggestionFile) : undefined;
        const episode = savedSuggestion && await exists(observationFile) ? {suggestion: savedSuggestion, ...await readJson(observationFile)} : await api.request(route("experiments/recap-from-episode"), correcting, {runId: initial.id, correctionRunId: correctionRun.id, correctionAction: pair.correction.mode === "revise" ? "revise" : "correct", correctionText: pair.correction.text, correctionFiles: versions});
        const suggestion = episode.suggestion;
        await writeJson(observationFile, {captureBypassed: episode.captureBypassed, naturallyTriggered: episode.naturallyTriggered});
        await writeJson(suggestionFile, suggestion);
        const draftFile = path.join(raw, "draft.json");
        let draft: KnowledgeCard;
        const draftActor = condition === "T4" ? a : correcting;
        if (await exists(draftFile)) draft = await readJson(draftFile);
        else {
          const currentSuggestion = (await api.request(route(`knowledge/inbox/${suggestion.id}`), draftActor)).suggestion;
          draft = currentSuggestion.draftCardId ? (await api.request(route(`knowledge/cards/${currentSuggestion.draftCardId}`), draftActor)).card : (await api.request(route(`knowledge/inbox/${suggestion.id}/ai-draft`), draftActor, {})).card;
          await writeJson(draftFile, draft);
        }
        const owner = draft.ownerMemberId;
        if (condition === "T4" && owner !== a) throw new Error("T4 requires a personal card owned by member-a");
        card = (await api.request(route(`knowledge/cards/${draft.id}`), owner)).card;
        if (!card) throw new Error("Transfer draft is absent");
        if (card.status === "draft" && condition === "T2") card = (await api.request(route(`experiments/cards/${draft.id}/review`), owner, {})).card;
        else if (card.status === "draft") {
          const reviewed = await reviewPatch(pair.id, draft, pair.gold);
          await writeJson(path.join(raw, "review.json"), reviewed);
          card = (await api.request(route(`knowledge/cards/${draft.id}/confirm`), owner, {patch: {...reviewed.patch, ...(condition === "T4" ? {scope: "personal"} : {})}, edited: reviewed.changedFields.length > 0})).card;
        }
        if (condition !== "T4" && card!.scope !== "team") {
          if (card!.scope === "personal") await api.request(route(`knowledge/cards/${card!.id}/scope/request-team`), owner, {});
          card = (await api.request(route(`knowledge/cards/${card!.id}/scope/confirm-team`), owner === a ? b : a, {})).card;
        }
      }
      await writeJson(cardFile, card);
    }
    if (card && (card.status !== "reviewed" || card.scope !== (condition === "T4" ? "personal" : "team"))) throw new Error("Transfer card has an unexpected review status or scope");
    const tbPath = path.join(raw, "tb-started.json");
    if (!await exists(tbPath)) await api.configure(project, a, {injectEnabled: condition !== "T0", toolEnabled: false, fixedCardIds: condition === "T1" && card ? [card.id] : [], proposeEnabled: false});
    if (variant === "delayed" && !await exists(tbPath)) {
      const confirmedAt = card?.review?.confirmedAt ?? (await readJson(correctionFile)).at;
      if (confirmedAt + config.delayMs > Date.now()) await pause(confirmedAt + config.delayMs - Date.now());
    }
    const tbInitial = await api.run(project, b, pair.tb.prompt, tbPath);
    const tb = await api.wait(project, b, tbInitial);
    const output = await api.collect(project, b, tb, path.join(raw, "tb"));
    for (const run of [ta, correctionRun, tb]) if (run.provider !== config.provider || run.model !== config.model || run.runtime !== "opencode") throw new Error("Transfer run used an unexpected model or runtime");
    const actual = await judge(pair.tb, output.snapshot, path.join(raw, "tb"));
    const taJudge = await readJson(path.join(raw, "ta-judge.json"));
    const metrics = await api.request(route("knowledge/metrics/reuse"), a);
    await writeJson(path.join(raw, "reuse.json"), metrics);
    const captureObservation = await exists(path.join(raw, "capture-observation.json")) ? await readJson(path.join(raw, "capture-observation.json")) : {captureBypassed: false, naturallyTriggered: null};
    await store.append({key, completed: true, pair: pair.id, task: pair.tb.id, condition, variant, repetition, crossOwner: pair.crossOwner,
      ta: {runStatus: ta.status, functional: taJudge.functional, trapAvoided: taJudge.trapAvoided, actuallyTrapped: taJudge.functional && !taJudge.trapAvoided, usage: ta.usage ?? null},
      functional: actual.functional, trapAvoided: actual.trapAvoided, jointSuccess: actual.jointSuccess, runStatus: tb.status, usage: tb.usage ?? null,
      correctionUsage: correctionRun.usage ?? null, ...knowledgeUsage(output.events, card ? [card.id] : []),
      cardId: card?.id, cardScope: card?.scope, cardOwner: card?.ownerMemberId, reuse: metrics.metrics, ...captureObservation, wallMs: Date.now() - started,
      artifacts: path.relative(store.directory, raw)});
    console.log(JSON.stringify({key, functional: actual.functional, trapAvoided: actual.trapAvoided, taActuallyTrapped: taJudge.functional && !taJudge.trapAvoided}));
  });
}

type SharedEpisode = {
  pair: Dataset["transfers"][number];
  repetition: number;
};

export async function runK4T2FromSavedEpisodes(data: Dataset, config: ExperimentConfig, store: RunStore, episodes: SharedEpisode[], sourceDirectory: string) {
  const api = new PlatformClient(config); await api.verifyFor(store.directory);
  const rules = await readJson<Record<string, {requiredTokens: string[]}>>(path.join(root, "review-rules.json"));
  const sourceRows = await readJsonl(path.join(sourceDirectory, "results.jsonl"));
  for (const {pair, repetition} of episodes) {
    const episodeKey = `${pair.id}-episode-${repetition}`;
    const paired = sourceRows.filter(row => row.episodeKey === episodeKey && ["T0", "T3"].includes(row.condition));
    if (paired.length !== 2 || new Set(paired.map(row => row.condition)).size !== 2) throw new Error(`Source episode lacks its T0/T3 pair: ${episodeKey}`);
  }
  await pool(episodes, config.concurrency, async ({pair, repetition}) => {
    const key = `${pair.id}-T2-${repetition}`;
    if (store.done(key)) return;
    api.checkScheduling();
    const episodeKey = `${pair.id}-episode-${repetition}`;
    const episodeRaw = path.join(sourceDirectory, "raw", episodeKey);
    const episode = await readJson<any>(path.join(episodeRaw, "episode.json"));
    const sourceCard = await readJson<KnowledgeCard>(path.join(episodeRaw, "draft.json"));
    const quality = await readJson<any>(path.join(episodeRaw, "recap-quality.json"));
    const modelDraft = quality.modelDraft;
    if (!modelDraft || typeof modelDraft !== "object") throw new Error(`Saved model draft is absent: ${episodeKey}`);
    const rule = rules[pair.id];
    if (!rule) throw new Error(`Review rule is absent: ${pair.id}`);
    const hasTokens = draftHasRequiredTokens(modelDraft, rule.requiredTokens);
    const raw = store.raw(key), started = Date.now();
    const {project, members} = await api.create(pair.tb, raw, key);
    const sourceActors = episode.actors;
    const mapping = {[sourceActors.a]: members[0], [sourceActors.b]: members[1], [sourceActors.correcting]: sourceActors.correcting === sourceActors.a ? members[0] : members[1]};
    const member = members[1];
    const owner = mapping[sourceCard.ownerMemberId ?? sourceActors.a];
    const confirmedFile = path.join(raw, "confirmed-card.json");
    let card: KnowledgeCard;
    let review: {patch: Record<string, never>; changedFields: string[]; changedChars: number; draftHasRequiredTokens: boolean};
    if (await exists(confirmedFile)) {
      card = await readJson<KnowledgeCard>(confirmedFile);
      review = await readJson(path.join(raw, "review.json"));
    } else {
      await api.request(api.projectRoute(project, "experiments/cards/import"), members[0], {cards: [sourceCard], memberMapping: mapping});
      const direct = (await api.request(api.projectRoute(project, `experiments/cards/${sourceCard.id}/review`), owner, {})).card as KnowledgeCard;
      card = direct;
      for (const field of ["type", "title", "summary", "content", "appliesTo"] as const) {
        if (JSON.stringify(card[field]) !== JSON.stringify(sourceCard[field])) throw new Error(`T2 confirmation changed model draft field ${field}: ${episodeKey}`);
      }
      if (card.scope !== "team") {
        await api.request(api.projectRoute(project, `knowledge/cards/${card.id}/scope/request-team`), owner, {});
        card = (await api.request(api.projectRoute(project, `knowledge/cards/${card.id}/scope/confirm-team`), owner === members[0] ? members[1] : members[0], {})).card as KnowledgeCard;
      }
      review = {patch: {}, changedFields: [], changedChars: 0, draftHasRequiredTokens: hasTokens};
      await writeJson(path.join(raw, "draft.json"), sourceCard);
      await writeJson(path.join(raw, "recap-quality.json"), quality);
      await writeJson(path.join(raw, "model-draft-card.json"), sourceCard);
      await writeJson(path.join(raw, "review.json"), review);
      await writeJson(confirmedFile, card);
    }
    const confirmedAt = card.review?.confirmedAt ?? Date.now();
    const projectPath = path.join(raw, "tb-started.json");
    const tbPath = projectPath;
    if (!await exists(tbPath)) {
      await api.configure(project, members[0], {injectEnabled: true, toolEnabled: false, proposeEnabled: false, lexicalScoring: "bm25", ranking: "bounded", topK: 5, maxCharsPerCard: 800, maxTotalChars: 4000});
    }
    const tbInitial = await api.run(project, member, pair.tb.prompt, tbPath);
    const tb = await api.wait(project, member, tbInitial);
    const output = await api.collect(project, member, tb, path.join(raw, "tb"));
    if (tb.provider !== config.provider || tb.model !== config.model || tb.runtime !== "opencode") throw new Error("Transfer run used an unexpected model or runtime");
    const actual = await judge(pair.tb, output.snapshot, path.join(raw, "tb"));
    const usage = knowledgeUsage(output.events, [card.id]);
    const firstInjection = output.events.find(event => event.type === "knowledge_injected" && (event.data?.cards as any[] | undefined)?.some(item => item.id === card.id));
    const injectedAt = firstInjection ? Date.parse(firstInjection.timestamp) : undefined;
    const confirmedCard = {...card, id: card.id, review: {...card.review!, confirmedAt}};
    await store.append({key, completed: true, episodeKey, pair: pair.id, task: pair.tb.id, condition: "T2", variant: "saved-model-draft", repetition, crossOwner: pair.crossOwner,
      ta: {runId: episode.taRunId, actuallyTrapped: episode.actuallyTrapped}, functional: actual.functional, trapAvoided: actual.trapAvoided, jointSuccess: actual.jointSuccess,
      runStatus: tb.status, usage: tb.usage ?? null, runId: tb.id, projectId: project.id, initiator: member, ...usage, cardId: confirmedCard.id,
      cardScope: card.scope, cardOwner: card.ownerMemberId, recapQuality: {validStructure: quality.validStructure, validCitations: quality.validCitations, fallback: quality.fallback},
      review, draftHasRequiredTokens: hasTokens, rankingSource: usage.rankingSource, rerankCalls: output.modelCalls, confirmedAt, injectedAt: injectedAt ?? null,
      reuseLatencyMs: injectedAt === undefined ? null : injectedAt - confirmedAt, agentWallMs: tb.startedAt && tb.finishedAt ? Date.parse(tb.finishedAt) - Date.parse(tb.startedAt) : null,
      wallMs: Date.now() - started, artifacts: path.relative(store.directory, raw), episodeArtifacts: path.relative(store.directory, episodeRaw)});
    console.log(JSON.stringify({key, functional: actual.functional, trapAvoided: actual.trapAvoided, targetInjected: usage.targetInjected, draftHasRequiredTokens: hasTokens}));
  }, error => api.stop(error));
}

async function prepareSharedEpisode(data: Dataset, config: ExperimentConfig, api: PlatformClient, store: RunStore, episode: SharedEpisode) {
  const {pair, repetition} = episode;
  const episodeKey = `${pair.id}-episode-${repetition}`;
  const raw = store.raw(episodeKey);
  if (!await exists(path.join(raw, "confirmed-card.json"))) await attemptDirectory(raw, "ta-started.json");
  const started = Date.now();
  const {project, members} = await api.create(pair.ta, raw, episodeKey);
  const a = members[0], b = members[1];
  const correcting = pair.correction.member.endsWith("member-b") ? b : a;
  const route = (suffix: string) => api.projectRoute(project, suffix);
  const teamFile = path.join(raw, "team-agent.json");
  const team = await exists(teamFile) ? await readJson(teamFile) : (await api.request(route("team-agents"), a, {name: "transfer-agent"})).agent;
  if (!await exists(teamFile)) await writeJson(teamFile, team);
  const initialPath = path.join(raw, "ta-started.json");
  if (!await exists(initialPath)) {
    await api.configure(project, a, {injectEnabled: false, toolEnabled: false, proposeEnabled: false, recapMode: "server"});
  }
  const initial = await exists(path.join(raw, "ta/run.json")) ? await readJson<AgentRun>(initialPath) : await api.teamRun(project, a, team.handle, pair.ta.prompt, initialPath);
  const correctionFile = path.join(raw, "correction-applied.json");
  let ta: AgentRun;
  if (await exists(correctionFile)) ta = await readJson(path.join(raw, "ta/run.json"));
  else {
    const scheduled = Date.parse(initial.createdAt) + pair.correction.atSeconds * 1000;
    if (scheduled > Date.now()) await pause(scheduled - Date.now());
    const taJudged = path.join(raw, "ta-judge.json");
    if (!await exists(taJudged)) {
      if (pair.correction.mode === "interrupt") await api.request(route(`agent/runs/${initial.id}/cancel`), correcting, {});
      ta = await api.wait(project, a, initial);
      const before = await api.collect(project, a, ta, path.join(raw, "ta"));
      await writeJson(taJudged, await judge(pair.ta, before.snapshot, path.join(raw, "ta")));
    } else ta = await readJson(path.join(raw, "ta/run.json"));
    const correctionFiles: Array<{file: string; beforeText: string; afterText: string}> = [];
    if (pair.correction.mode === "revise") {
      const revisions = await correctionReferenceFiles(pair);
      const baseline = await api.request(route(`experiments/runs/${initial.id}/correction-baseline`), correcting, {files: revisions.map(item => item.file)});
      await writeJson(path.join(raw, "correction-baseline.json"), baseline);
      const collaboration = new CollaborationClient(api, project); await collaboration.join(correcting);
      try {
        for (const {file, afterText} of revisions) {
          const workspaceFile = path.join(project.workspacePath, file);
          const present = await exists(workspaceFile);
          const current = present ? await fs.readFile(workspaceFile, "utf8") : "";
          if (baseline.files.find((item: any) => item.file === file)?.beforeText !== current) throw new Error(`Correction baseline differs: ${file}`);
          if (!present) await api.request(route("workspace/file"), correcting, {path: file, content: ""}, "PUT");
          if (current !== afterText) await collaboration.replace(correcting, file, current, afterText);
          correctionFiles.push({file, beforeText: current, afterText});
        }
        await api.request(route("chat"), correcting, {text: pair.correction.text});
      } finally { await collaboration.close(); }
    }
    await writeJson(path.join(raw, "ta/run.json"), ta);
    await writeJson(correctionFile, {at: Date.now(), memberId: correcting, text: pair.correction.text, interruptedStatus: ta.status, correctionFiles});
  }
  const correctionJudgeFile = path.join(raw, "correction-judge.json");
  if (!await exists(correctionJudgeFile)) await writeJson(correctionJudgeFile, await judge(pair.ta, project.workspacePath, path.join(raw, "correction")));
  if (!(await readJson(correctionJudgeFile)).jointSuccess) throw new Error(`Correction did not pass the behavior checks: ${episodeKey}`);
  const cardFile = path.join(raw, "confirmed-card.json");
  let card: KnowledgeCard | null = await exists(cardFile) ? await readJson(cardFile) : null;
  if (!card) {
    const correctionState = await readJson(correctionFile);
    const versions = await Promise.all((correctionState.correctionFiles ?? []).map(async (file: {file: string; beforeText: string; afterText: string}) => ({...file, afterText: await fs.readFile(path.join(project.workspacePath, file.file), "utf8")})));
    const episodeResult = await api.request(route("experiments/recap-from-episode"), correcting, {runId: initial.id, correctionAction: pair.correction.mode === "revise" ? "revise" : "correct", correctionText: pair.correction.text, correctionFiles: versions});
    await writeJson(path.join(raw, "capture-observation.json"), {captureBypassed: episodeResult.captureBypassed, naturallyTriggered: episodeResult.naturallyTriggered});
    await writeJson(path.join(raw, "suggestion.json"), episodeResult.suggestion);
    const draftActor = a;
    const currentSuggestion = (await api.request(route(`knowledge/inbox/${episodeResult.suggestion.id}`), draftActor)).suggestion;
    const draft = currentSuggestion.draftCardId ? (await api.request(route(`knowledge/cards/${currentSuggestion.draftCardId}`), draftActor)).card : (await api.request(route(`knowledge/inbox/${episodeResult.suggestion.id}/ai-draft`), draftActor, {})).card;
    await writeJson(path.join(raw, "draft.json"), draft);
    const {calls} = await api.request(route("experiments/llm-calls"), draftActor);
    const recapCalls = calls.filter((call: any) => call.suggestionId === episodeResult.suggestion.id);
    await writeJson(path.join(raw, "recap-calls.json"), recapCalls);
    if (recapCalls.some((call: any) => isQuotaFailure(call.failureReason ?? ""))) {
      const error = new Error("Model quota interruption during transfer recap");
      await api.stop(error);
      throw error;
    }
    const evidence = (await api.request(route(`knowledge/inbox/${episodeResult.suggestion.id}`), draftActor)).suggestion.evidence;
    const response = recapCalls.flatMap((call: any) => call.responses ?? []).at(-1);
    const parsed = response ? parseAgentRecapDraft(response, evidence) : undefined;
    const quality = response ? draftMetrics(response, "server", evidence, "", [pair.gold.type]) : {validStructure: false, validCitations: false};
    await writeJson(path.join(raw, "recap-quality.json"), {validStructure: quality.validStructure, validCitations: quality.validCitations, fallback: draft.fallback === true,
      failureReason: recapCalls.at(-1)?.failureReason ?? null, modelDraft: parsed ?? null});
    const owner = draft.ownerMemberId;
    const reviewed = await reviewPatch(pair.id, draft, pair.gold);
    await writeJson(path.join(raw, "review.json"), reviewed);
    const confirmed = draft.status === "draft" ? (await api.request(route(`knowledge/cards/${draft.id}/confirm`), owner, {patch: reviewed.patch, edited: reviewed.changedFields.length > 0})).card as KnowledgeCard : draft as KnowledgeCard;
    card = confirmed;
    if (confirmed.scope !== "team") {
      if (confirmed.scope === "personal") await api.request(route(`knowledge/cards/${confirmed.id}/scope/request-team`), owner, {});
      card = (await api.request(route(`knowledge/cards/${confirmed.id}/scope/confirm-team`), owner === a ? b : a, {})).card;
    }
    await writeJson(cardFile, card);
  }
  if (!card || card.status !== "reviewed" || card.scope !== "team") throw new Error(`Shared transfer card is not confirmed: ${episodeKey}`);
  const taJudge = await readJson(path.join(raw, "ta-judge.json"));
  if (ta.provider !== config.provider || ta.model !== config.model || ta.runtime !== "opencode") throw new Error("Transfer episode used an unexpected model or runtime");
  await writeJson(path.join(raw, "episode.json"), {episodeKey, pair: pair.id, repetition, crossOwner: pair.crossOwner, projectId: project.id, taRunId: ta.id,
    actors: {a, b, correcting}, confirmedAt: card.review?.confirmedAt, cardId: card.id, actuallyTrapped: taJudge.functional && !taJudge.trapAvoided});
  return {pair, repetition, raw, project, a, b, correcting, card, ta, taJudge, initial, started, episodeKey};
}

export async function runK4SharedEpisodes(data: Dataset, config: ExperimentConfig, store: RunStore, episodes: SharedEpisode[]) {
  const api = new PlatformClient(config); await api.verifyFor(store.directory);
  await pool(episodes, config.concurrency, async episode => {
    if (["T0", "T3"].every(condition => store.done(`${episode.pair.id}-${condition}-${episode.repetition}`))) return;
    api.checkScheduling();
    const prepared = await prepareSharedEpisode(data, config, api, store, episode);
    for (const condition of ["T0", "T3"] as const) {
      const key = `${episode.pair.id}-${condition}-${episode.repetition}`;
      if (store.done(key)) continue;
      api.checkScheduling();
      const raw = store.raw(key);
      await attemptDirectory(raw, "tb-started.json");
      const {project, members} = await api.create(episode.pair.tb, raw, key);
      const member = members[1];
      const mapping = {[prepared.a]: members[0], [prepared.b]: members[1]};
      await writeJson(path.join(raw, "members.json"), {source: {a: prepared.a, b: prepared.b, correcting: prepared.correcting}, destination: {a: members[0], b: member}, mapping});
      const tbPath = path.join(raw, "tb-started.json");
      if (!await exists(tbPath)) {
        if (condition === "T3") await api.request(api.projectRoute(project, "experiments/cards/import"), members[0], {cards: [prepared.card], memberMapping: mapping});
        await api.configure(project, members[0], {injectEnabled: condition === "T3", toolEnabled: false, proposeEnabled: false, lexicalScoring: "bm25", ranking: "bounded", topK: 5, maxCharsPerCard: 800, maxTotalChars: 4000});
      }
      const tbInitial = await api.run(project, member, episode.pair.tb.prompt, tbPath);
      const tb = await api.wait(project, member, tbInitial);
      const output = await api.collect(project, member, tb, path.join(raw, "tb"));
      if (tb.provider !== config.provider || tb.model !== config.model || tb.runtime !== "opencode") throw new Error("Transfer run used an unexpected model or runtime");
      const actual = await judge(episode.pair.tb, output.snapshot, path.join(raw, "tb"));
      const usage = knowledgeUsage(output.events, condition === "T3" ? [prepared.card.id] : []);
      const observation = await exists(path.join(prepared.raw, "capture-observation.json")) ? await readJson(path.join(prepared.raw, "capture-observation.json")) : {captureBypassed: true, naturallyTriggered: false};
      const recapQuality = await readJson(path.join(prepared.raw, "recap-quality.json"));
      const recapCalls = await readJson(path.join(prepared.raw, "recap-calls.json"));
      const review = await readJson(path.join(prepared.raw, "review.json"));
      const confirmedAt = prepared.card.review?.confirmedAt;
      const firstInjection = output.events.find(event => event.type === "knowledge_injected" && (event.data?.cards as any[] | undefined)?.some(card => card.id === prepared.card.id));
      const injectedAt = firstInjection ? Date.parse(firstInjection.timestamp) : undefined;
      const reuse = await api.request(api.projectRoute(project, "knowledge/metrics/reuse"), member);
      await writeJson(path.join(raw, "reuse.json"), reuse);
      await store.append({key, completed: true, episodeKey: prepared.episodeKey, pair: episode.pair.id, task: episode.pair.tb.id, condition, variant: "shared-episode", repetition: episode.repetition, crossOwner: episode.pair.crossOwner,
        ta: {runId: prepared.ta.id, runStatus: prepared.ta.status, functional: prepared.taJudge.functional, trapAvoided: prepared.taJudge.trapAvoided, actuallyTrapped: prepared.taJudge.functional && !prepared.taJudge.trapAvoided, usage: prepared.ta.usage ?? null},
        functional: actual.functional, trapAvoided: actual.trapAvoided, jointSuccess: actual.jointSuccess, runStatus: tb.status, usage: tb.usage ?? null,
        runId: tb.id, projectId: project.id, initiator: member, ...usage, cardId: prepared.card.id, cardScope: prepared.card.scope, cardOwner: prepared.card.ownerMemberId ? mapping[prepared.card.ownerMemberId] : undefined,
        recapQuality, review, recapCalls, rerankCalls: output.modelCalls, confirmedAt, injectedAt: injectedAt ?? null, reuseLatencyMs: confirmedAt !== undefined && injectedAt !== undefined ? injectedAt - confirmedAt : null,
        agentWallMs: tb.startedAt && tb.finishedAt ? Date.parse(tb.finishedAt) - Date.parse(tb.startedAt) : null,
        captureBypassed: observation.captureBypassed, naturallyTriggered: observation.naturallyTriggered, wallMs: Date.now() - prepared.started,
        artifacts: path.relative(store.directory, raw), episodeArtifacts: path.relative(store.directory, prepared.raw)});
      console.log(JSON.stringify({key, functional: actual.functional, trapAvoided: actual.trapAvoided, taActuallyTrapped: prepared.taJudge.functional && !prepared.taJudge.trapAvoided, targetInjected: usage.targetInjected}));
    }
  }, error => api.stop(error));
}
