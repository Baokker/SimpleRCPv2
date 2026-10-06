import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import {Readable} from "node:stream";
import {parse} from "dotenv";
import {createApp} from "../../apps/server/src/createApp.js";
import {loadConfig} from "../../apps/server/src/config.js";
import {attachRealtimeServer} from "../../apps/server/src/realtime.js";
import {platformRoot, root} from "./common.js";
import {registerExperimentRoutes} from "./server-routes.js";

if (process.env.SIMPLERCP_KNOWLEDGE_EXPERIMENTS !== "true") throw new Error("SIMPLERCP_KNOWLEDGE_EXPERIMENTS=true is required");
const directory = path.join(root, ".work/server");
await fs.mkdir(directory, {recursive: true});
const configuration = loadConfig({
  ...process.env, ...parse(await fs.readFile(path.join(platformRoot, ".env"))),
  PORT: process.env.PORT ?? "4179", SIMPLERCP_OPENCODE_PORT: process.env.SIMPLERCP_OPENCODE_PORT ?? "4181",
  SIMPLERCP_DATA_DIR: process.env.SIMPLERCP_DATA_DIR ?? path.join(directory, "data"),
  SIMPLERCP_IMPORT_ROOTS: path.resolve(platformRoot, ".."),
  SIMPLERCP_TERMINAL_ENABLED: "false", SIMPLERCP_FAKE_AGENT_RUNTIME: "false", KNOWLEDGE: "full", AGENT_LLM_PROVIDER: "minimax"
});
const upstream = configuration.agent!;
const provider = upstream.provider!;
const model = upstream.model;
const actualKey = upstream.apiKey!;
const baseUrl = upstream.baseUrl;
const speed = Number(process.env.EXPERIMENT_SPEED ?? 10);
if (!Number.isFinite(speed) || speed <= 0) throw new Error("EXPERIMENT_SPEED must be positive");
const timeFields = {
  checkpointIdleMs: 30000, chatWindowMs: 300000, chatCooldownMs: 300000, chatAfterMs: 60000,
  chatBeforeMs: 120000, todoCooldownMs: 300000, magicCooldownMs: 120000, rollbackWindowMs: 300000,
  rollbackCooldownMs: 300000, overwrittenWindowMs: 600000, overwrittenCooldownMs: 300000,
  historyMs: 1800000, agentInterruptWindowMs: 180000, agentRevisionWindowMs: 900000,
  agentRevisionCooldownMs: 300000, agentCorrectionWindowMs: 600000, agentRetryWindowMs: 1800000
};
configuration.captureConfig = {
  ...Object.fromEntries(Object.entries(timeFields).map(([key, value]) => [key, value / speed])),
  ...(process.env.EXPERIMENT_CORRECTION_TERMS === "dataset" ? {correctionTerms: ["改", "改成", "修改", "纠正", "不要", "换成", "重做", "修复", "transaction", "logicalId", "requestId", "redactSensitive", "actorId", "serverMember", "instead", "revert", "change", "correct", "fix", "do not"]} : {})
};
configuration.agent = {...upstream, apiKey: "experiment-local", baseUrl: `http://127.0.0.1:${configuration.port}/experiments/model/v1`};
// 模型凭据由当前服务进程保管，OpenCode 使用本机代理地址。
for (const name of Object.keys(process.env)) if (/KEY|TOKEN|SECRET|PASSWORD/u.test(name)) delete process.env[name];
process.env.TMPDIR = path.join(directory, "temporary");
await fs.mkdir(process.env.TMPDIR, {recursive: true});
const app = await createApp(configuration);
app.post("/experiments/model/v1/chat/completions", async (request, response, next) => {
  try {
    if (request.headers.authorization !== "Bearer experiment-local") {response.sendStatus(401); return;}
    const forwarded = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST", headers: {"Content-Type": "application/json", Authorization: `Bearer ${actualKey}`},
      body: JSON.stringify(request.body), signal: AbortSignal.timeout(configuration.agent!.runTimeoutMs! + 30000)
    });
    response.status(forwarded.status);
    response.setHeader("Content-Type", forwarded.headers.get("Content-Type") ?? "application/json");
    if (!forwarded.body) throw new Error("Model response body is unavailable");
    Readable.fromWeb(forwarded.body as any).pipe(response);
  } catch (error) {next(error);}
});
registerExperimentRoutes(app, {enabled: true, provider, model, speed, configuration});
const server = http.createServer(app);
const realtime = attachRealtimeServer(server, app.locals.runtimeManager, app.locals.agentRuns, {members: app.locals.members});
server.listen(configuration.port, configuration.host, () => console.log(JSON.stringify({origin: `http://${configuration.host}:${configuration.port}`, provider, model, speed, dataDir: configuration.dataDir})));
async function close() {
  realtime.dispose();
  for (const sockets of [realtime.presence, realtime.documents, realtime.terminal]) {for (const socket of sockets.clients) socket.terminate(); sockets.close();}
  await app.locals.agentRuns.dispose();
  await app.locals.agentRuntime.dispose();
  await app.locals.runtimeManager.dispose();
  server.close();
}
process.once("SIGTERM", () => void close());
process.once("SIGINT", () => void close());
