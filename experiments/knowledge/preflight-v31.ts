import fs from "node:fs/promises";
import path from "node:path";
import {createOpenAICompatibleClient} from "@simplercp/knowledge";
import {parse} from "dotenv";
import {configSchema, dataset, readJson, root, platformRoot, RunStore, writeJson} from "./common.js";
import {loadConfig} from "../../apps/server/src/config.js";
import {runK4SharedEpisodes} from "./k4.js";

const config = configSchema.parse(await readJson(path.join(root, "formal-v3.json")));
const directory = path.join(root, ".work/preflight-v31");
await fs.mkdir(directory, {recursive: true});
const configuration = loadConfig({...parse(await fs.readFile(path.join(platformRoot, ".env"))), ...process.env, KNOWLEDGE: "full", MINIMAX_MODEL: "MiniMax-M3", AGENT_MINIMAX_MODEL: "MiniMax-M3", KNOWLEDGE_LLM_PROVIDER: "minimax"});
const client = createOpenAICompatibleClient(configuration.knowledgeLlm!);
const at = Date.now();
const response = await client.complete({model: "MiniMax-M3", messages: [{role: "user", content: "只回复 OK"}], timeoutMs: 120000});
await writeJson(path.join(directory, "quota-check.json"), {provider: "minimax", model: "MiniMax-M3", completed: true, usage: response.usage, durationMs: Date.now() - at});
console.log(JSON.stringify({quotaCheck: "passed", model: "MiniMax-M3"}));
const data = await dataset();
const store = await new RunStore(directory).open("preflight-v31", config, data);
try {
  await runK4SharedEpisodes(data, config, store, data.transfers.filter(pair => ["P01", "P03"].includes(pair.id)).map(pair => ({pair, repetition: 1})));
} finally {await store.close();}
