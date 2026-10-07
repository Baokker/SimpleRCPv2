import fs from "node:fs/promises";
import path from "node:path";
import {correctedIdentifiers} from "@simplercp/knowledge";
import {configSchema, readJson, writeJson, root, dataset, exists} from "./common.js";
import {PlatformClient} from "./client.js";
import {CollaborationClient} from "./collaboration.js";

const config = configSchema.parse(await readJson(path.join(root, "review-fixes.json")));
const api = new PlatformClient(config);
const directory = path.join(root, "runs/recap-quality-final-review");
const sceneDirectory = path.join(root, "runs/recap-quality-review");
const data = await dataset();
await api.verifyFor(directory);
const old = await readJson(path.join(root, "runs/k2-review/raw/P01-T0-delayed-1-server/response.json"));
const context = await api.create({...data.transfers[0].ta, workspaceSource: path.join(root, "runs/k4-review/raw/P01-T0-delayed-1/correction/workspace")}, path.join(directory, "raw/k2-context"), "recap-k2");
const scenes: Array<{scenario: string; evidence: Record<string, unknown>; mustMention: string; project: typeof context.project; member: string}> = [{scenario: "K2-P01", evidence: old.request.evidence, mustMention: "InventoryStore.transaction", project: context.project, member: context.members[0]}];

for (const scenario of ["revised", "corrected"] as const) {
  const raw = path.join(directory, "raw", scenario);
  const setup = await api.create({...data.transfers[0].ta, workspaceSource: path.join(root, "fixtures/recap-session")}, raw, `recap-${scenario}`);
  const member = setup.members[0], editor = scenario === "revised" ? setup.members[1] : member;
  await api.configure(setup.project, member, {injectEnabled: false, toolEnabled: false});
  const evidenceFile = path.join(sceneDirectory, "raw", scenario, "evidence.json");
  if (!await exists(evidenceFile)) {
    const original = await fs.readFile(path.join(setup.project.workspacePath, "src/session.ts"), "utf8");
    const task = scenario === "revised" ? "Update src/session.ts: remove sharedHelper entirely and make setup and renameSession work directly with the state. Preserve the SessionState interface." : "Update renameSession in src/session.ts to assign state.name directly. Keep sharedHelper available for setup.";
    const started = await api.run(setup.project, member, task, path.join(raw, "agent-started.json"));
    const run = await api.wait(setup.project, member, started);
    if (run.status !== "completed") throw new Error(`Scene run failed: ${run.error}`);
    await api.collect(setup.project, member, run, path.join(raw, "agent"));
    const beforeText = await fs.readFile(path.join(setup.project.workspacePath, "src/session.ts"), "utf8");
    let correctionRun: typeof run | undefined;
    const correction = scenario === "revised" ? "共享 helper 需要保留，请恢复 sharedHelper。" : "不要直接写 state，改用 sharedHelper。";
    if (scenario === "revised") {
      const collaboration = new CollaborationClient(api, setup.project);
      await collaboration.join(editor);
      try {await collaboration.replace(editor, "src/session.ts", beforeText, original);} finally {await collaboration.close();}
    } else {
      const corrected = await api.run(setup.project, editor, correction, path.join(raw, "correction-started.json"), run.sessionId);
      correctionRun = await api.wait(setup.project, editor, corrected);
      if (correctionRun.status !== "completed") throw new Error(`Correction run failed: ${correctionRun.error}`);
      await api.collect(setup.project, editor, correctionRun, path.join(raw, "correction"));
    }
    const afterText = await fs.readFile(path.join(setup.project.workspacePath, "src/session.ts"), "utf8");
    if (beforeText === afterText) throw new Error("Correction did not modify the scene file");
    await writeJson(evidenceFile, {file: "src/session.ts", previousRun: run, correctionRun, correction, editor, correctionFiles: [{file: "src/session.ts", beforeText, afterText}]});
  }
  scenes.push({scenario, evidence: await readJson(evidenceFile), mustMention: "sharedHelper", project: setup.project, member});
}
const rows = [];
for (const scene of scenes) for (let repetition = 1; repetition <= 3; repetition++) {
  const responseFile = path.join(directory, "raw/validated", `${scene.scenario}-${repetition}.json`);
  if (await exists(responseFile)) throw new Error(`Review response already exists: ${responseFile}`);
  const response = await api.request(api.projectRoute(scene.project, "experiments/drafts"), scene.member, {mode: "server", triggerType: scene.scenario === "revised" ? "agent.revised" : "agent.corrected", evidence: scene.evidence});
  await writeJson(responseFile, response);
  rows.push({scenario: scene.scenario, repetition, provider: "minimax", model: config.model, fallback: response.fallback, citations: response.draft.evidenceCitations.length, rule: response.draft.rule, mustMention: scene.mustMention, identifierCovered: response.draft.rule.includes(scene.mustMention), candidates: correctedIdentifiers(response.evidence), checkValidation: response.draft.checkValidation ?? {offered: false, retained: false}, calls: response.calls});
  await writeJson(path.join(directory, "results.json"), rows);
  console.log(JSON.stringify(rows.at(-1)));
}
