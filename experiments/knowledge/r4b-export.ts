import fs from "node:fs/promises";
import path from "node:path";
import {parse} from "dotenv";
import {createOpenAICompatibleClient} from "@simplercp/knowledge";
import {exportAgentsMarkdown} from "../../apps/server/src/knowledge/documentIO.js";
import {benchRoot, platformRoot, readJson, writeJson} from "./common.js";

const option = (name: string) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
};
const libraryFile = option("--library") ?? "trapbench/cards/library-500.json";
const outDirectory = path.resolve(platformRoot, option("--out") ?? "experiments/knowledge/runs/r4-scale-v31/exports");
const libraries = option("--libraries")?.split(",") ?? ["trapbench/cards/library-200.json", "trapbench/cards/library-500.json"];
await fs.mkdir(outDirectory, {recursive: true});

const environment = parse(await fs.readFile(path.join(platformRoot, ".env"), "utf8"));
if (!environment.MINIMAX_API_KEY) throw new Error("MINIMAX_API_KEY is required");
const baseUrl = environment.MINIMAX_BASE_URL || "https://api.minimaxi.com/v1";
const model = environment.MINIMAX_MODEL || "MiniMax-M3";
const client = createOpenAICompatibleClient({
  baseUrl, apiKey: environment.MINIMAX_API_KEY, model, timeoutMs: 180000,
  fetch: (url, request) => fetch(url, {...request, body: JSON.stringify({...JSON.parse(String(request!.body)), thinking: {type: "disabled"}, reasoning_split: true})}),
});
async function promptTokens(content: string) {
  const started = Date.now();
  try {
    const response = await client.complete({model, messages: [{role: "user", content}], temperature: 0, timeoutMs: 180000});
    return {ok: true, durationMs: Date.now() - started, usage: response.usage ?? null, text: response.text.slice(0, 200)};
  } catch (error) {
    return {ok: false, durationMs: Date.now() - started, error: (error instanceof Error ? error.message : String(error)).slice(0, 500)};
  }
}

const report: any = {model, baseUrl, generatedAt: new Date().toISOString(), libraries: {}};
const baseline = await promptTokens("OK");
report.baseline = baseline;
for (const relative of libraries) {
  const library = await readJson<Array<{repository: string; card: any}>>(path.join(benchRoot, relative));
  const scale = relative.match(/library-(\d+)\.json$/u)?.[1] ?? "unknown";
  report.libraries[scale] = {file: relative, repositories: {}};
  for (const repository of ["R1", "R2"]) {
    const cards = library.filter(item => item.repository === repository).map(item => item.card).filter(card => card.status === "reviewed" && card.scope === "team");
    const markdown = exportAgentsMarkdown(cards);
    const file = path.join(outDirectory, `AGENTS-${repository}-${scale}.md`);
    await fs.writeFile(file, markdown);
    const measurement = await promptTokens(markdown);
    report.libraries[scale].repositories[repository] = {
      cards: cards.length,
      chars: markdown.length,
      bytes: Buffer.byteLength(markdown),
      lines: markdown.split("\n").length,
      file: path.relative(platformRoot, file),
      tokens: measurement,
      contentTokens: measurement.ok && baseline.ok && measurement.usage?.promptTokens !== undefined && baseline.usage?.promptTokens !== undefined
        ? measurement.usage.promptTokens - baseline.usage.promptTokens : null,
    };
    console.log(JSON.stringify({scale, repository, cards: cards.length, chars: markdown.length, promptTokens: measurement.usage?.promptTokens ?? null, ok: measurement.ok}));
  }
}
await writeJson(path.join(outDirectory, "token-report.json"), report);
console.log(JSON.stringify(report));
