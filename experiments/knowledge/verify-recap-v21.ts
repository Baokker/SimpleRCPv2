import fs from "node:fs/promises";
import path from "node:path";
import {citationExists, parseAgentRecapDraft, compactRecapEvidence} from "@simplercp/knowledge";
import {configSchema, root, benchRoot, readJson, writeJson} from "./common.js";
import {PlatformClient} from "./client.js";

const config = configSchema.parse(await readJson(path.join(root, "formal-v21.json")));
const api = new PlatformClient(config);
const directory = path.join(root, "runs", process.argv[2] ?? "E6-recap-acceptance-v21-m3");
await api.verifyFor(directory);
const source = path.join(root, "runs/E5-k4-pilot-v2/raw/P01-T3-delayed-1");
const suggestion = await readJson(path.join(source, "suggestion.json"));
const task = {...await readJson(path.join(benchRoot, "transfer/pairs/P01/ta/task.json")), directory: path.join(benchRoot, "transfer/pairs/P01/ta"), prompt: "复盘验收", workspaceSource: path.join(source, "correction/workspace")};
const {project, members} = await api.create(task, path.join(directory, "raw/context"), "recap-v21-m3");
await api.configure(project, members[0], {injectEnabled: false, toolEnabled: false});
const rows = [];
for (let repetition = 1; repetition <= 3; repetition++) {
  const response = await api.request(api.projectRoute(project, "experiments/drafts"), members[0], {mode: "server", triggerType: "agent.revised", evidence: suggestion.evidence});
  await writeJson(path.join(directory, "raw", `response-${repetition}.json`), response);
  const parsed = response.draft ? parseAgentRecapDraft(JSON.stringify(response.draft), response.evidence) : undefined;
  const row = {repetition, provider: response.calls[0]?.provider, model: response.calls[0]?.model,
    validStructure: Boolean(parsed), resolvableCitations: parsed?.evidenceCitations.filter(citation => citationExists(citation, response.evidence)).length ?? 0,
    fallback: response.fallback, failed: response.failed, failureReason: response.failureReason,
    rule: parsed?.rule, latencyMs: response.latencyMs, calls: response.calls,
    evidenceChars: JSON.stringify(response.evidence).length, promptEvidenceChars: JSON.stringify(compactRecapEvidence(response.evidence)).length};
  rows.push(row);
  await fs.writeFile(path.join(directory, "results.jsonl"), rows.map(item=>JSON.stringify(item)).join("\n")+"\n");
  console.log(JSON.stringify(row));
}
if (rows.some(row => !row.validStructure || !row.resolvableCitations || row.fallback || row.failed || row.model !== "MiniMax-M3")) throw new Error("三次真实复盘验收未全部通过");
