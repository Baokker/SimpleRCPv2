import fs from "node:fs/promises";
import path from "node:path";
import {applyPatch, parsePatch, diffChars} from "diff";
import type {KnowledgeCard} from "@simplercp/knowledge";
import type {AgentRun} from "@simplercp/shared";
import {type Dataset, type ExperimentConfig, RunStore, root, digest, exists, pause, pool, readJson, writeJson} from "./common.js";
import {PlatformClient, judge} from "./client.js";
import {CollaborationClient} from "./collaboration.js";
import {knowledgeUsage} from "./k3.js";

export type K4Condition = "T0" | "T1" | "T2" | "T3" | "T4" | "T5";
export const allK4Conditions: K4Condition[] = ["T0", "T1", "T2", "T3", "T4", "T5"];
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
        const patchFile = path.join(pair.directory, pair.correction.patch ?? "correction.patch");
        const patches = parsePatch(await fs.readFile(patchFile, "utf8"));
        const collaboration = new CollaborationClient(api, project); await collaboration.join(correcting);
        try {
          for (const patch of patches) {
            const file = (patch.newFileName ?? patch.oldFileName)!.replace(/^[ab]\//u, "");
            const current = await fs.readFile(path.join(project.workspacePath, file), "utf8");
            const after = applyPatch(current, patch); if (after === false) throw new Error("Human correction patch cannot be applied");
            await collaboration.replace(correcting, file, current, after);
          }
        } finally {await collaboration.close();}
      }
      const correction = await api.teamRun(project, correcting, team.handle, pair.correction.text, path.join(raw, "correction-run.json"));
      ta = await api.wait(project, a, initial);
      await writeJson(path.join(raw, "ta/run.json"), ta);
      await writeJson(correctionFile, {at: Date.now(), memberId: correcting, correctionRunId: correction.id, text: pair.correction.text, interruptedStatus: ta.status});
    } else ta = await readJson(path.join(raw, "ta/run.json"));
    const revised = await readJson<AgentRun>(path.join(raw, "correction-run.json"));
    const correctionRun = await api.wait(project, a, revised);
    await api.collect(project, a, correctionRun, path.join(raw, "correction"));
    const cardFile = path.join(raw, "confirmed-card.json");
    let card: KnowledgeCard | null = await exists(cardFile) ? await readJson(cardFile) : null;
    if (!await exists(cardFile)) {
      if (condition === "T1") {
        const taDiff = await fs.readFile(path.join(raw, "ta/workspace.patch"), "utf8");
        const response = await api.request(route("knowledge/cards"), a, {type: "context", title: "本次纠正上下文", summary: pair.correction.text, content: `${pair.ta.prompt}\n${pair.correction.text}\n${taDiff}`, tags: ["experiment:T1"], scope: "team"});
        card = response.card;
      } else if (condition !== "T0") {
        let suggestion: any;
        const deadline = Date.now() + 30000;
        while (!suggestion && Date.now() < deadline) {
          const {suggestions} = await api.request(route("knowledge/inbox?view=all"), a);
          suggestion = suggestions.find((item: any) => ["agent.corrected", "agent.interrupted", "agent.revised"].includes(item.triggerType) && item.actors.runIds.includes(initial.id));
          if (!suggestion) await pause(500);
        }
        if (!suggestion) throw new Error(`Correction suggestion is absent: ${key}`);
        await writeJson(path.join(raw, "suggestion.json"), suggestion);
        const draftFile = path.join(raw, "draft.json");
        let draft: KnowledgeCard;
        if (await exists(draftFile)) draft = await readJson(draftFile);
        else {
          draft = (await api.request(route(`knowledge/inbox/${suggestion.id}/ai-draft`), a, {})).card;
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
    await store.append({key, completed: true, pair: pair.id, task: pair.tb.id, condition, variant, repetition, crossOwner: pair.crossOwner,
      ta: {runStatus: ta.status, functional: taJudge.functional, trapAvoided: taJudge.trapAvoided, actuallyTrapped: taJudge.functional && !taJudge.trapAvoided, usage: ta.usage ?? null},
      functional: actual.functional, trapAvoided: actual.trapAvoided, jointSuccess: actual.jointSuccess, runStatus: tb.status, usage: tb.usage ?? null,
      correctionUsage: correctionRun.usage ?? null, ...knowledgeUsage(output.events, card ? [card.id] : []),
      cardId: card?.id, cardScope: card?.scope, cardOwner: card?.ownerMemberId, reuse: metrics.metrics, wallMs: Date.now() - started,
      artifacts: path.relative(store.directory, raw)});
    console.log(JSON.stringify({key, functional: actual.functional, trapAvoided: actual.trapAvoided, taActuallyTrapped: taJudge.functional && !taJudge.trapAvoided}));
  });
}
