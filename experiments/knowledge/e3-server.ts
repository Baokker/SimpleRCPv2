import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import {createOpenAICompatibleClient, type LlmClient} from "@simplercp/knowledge";
import {createApp} from "../../apps/server/src/createApp.js";
import {requireIdentity} from "../../apps/server/src/auth/permissions.js";
import {redactSensitive} from "../../apps/server/src/agent/traceStore.js";
import {rerankKnowledge, estimateRerankCost} from "../../apps/server/src/knowledge/rerank.js";
import {registerExperimentRoutes} from "./server-routes.js";
import {benchRoot, configSchema} from "./common.js";
import {PlatformClient} from "./client.js";

export async function startRetrievalServer(repository: string, directory: string, model?: {baseUrl: string; apiKey: string}) {
  await fs.mkdir(directory, {recursive: true});
  const configuration = {port: 0, host: "127.0.0.1", publicOrigin: "http://127.0.0.1", dataDir: path.join(directory, "data"), demoProjectRoot: path.join(benchRoot, "repos", repository), terminalEnabled: false, knowledge: "full" as const};
  const app = await createApp(configuration);
  let client: LlmClient | undefined;
  if (model) client = createOpenAICompatibleClient({...model, provider: "minimax", model: "MiniMax-M3", timeoutMs: 120000});
  app.post("/api/projects/:projectId/experiments/retrieval", (request, response, next) => {
    void (async () => {
      const identity = requireIdentity(request, response); if (!identity) return;
      const {prompt, seed, condition} = request.body;
      if (typeof prompt !== "string" || typeof seed !== "string" || !["A", "B", "C"].includes(condition)) throw new Error("Invalid retrieval request");
      if (condition === "C" && !client) throw new Error("MiniMax credentials are required");
      const runtime = app.locals.runtimeManager.get(request.params.projectId);
      const member = runtime.rooms.getMember(runtime.room.id, identity.memberId);
      if (!member) throw new Error("Project membership is required");
      const call: Record<string, any> = {provider: "minimax", model: "MiniMax-M3", mode: "retrieval-rerank", seed, startedAt: new Date().toISOString()};
      const started = performance.now();
      let result: unknown;
      let failed = false;
      let failureReason: string | undefined;
      try {
        result = await runtime.knowledgeProvider.buildContext({project: runtime.project, initiator: member,
          run: {id: `retrieval-probe-${seed}`, projectId: runtime.project.id, memberId: member.id, initiatorMemberId: member.id, prompt, status: "queued", runtime: "opencode", provider: "minimax", model: "MiniMax-M3", createdAt: new Date().toISOString()}
        }, {recordUsage: false, ...(condition === "C" ? {selectionPolicy: async (input: Parameters<typeof rerankKnowledge>[0]) => {
          const selected = await rerankKnowledge(input, {client: client!, seed, async onResponse(value) {Object.assign(call, value, {estimatedCostCny: estimateRerankCost(value.usage)});}});
          call.selectedIds = selected;
          return selected;
        }} : {})});
      } catch (error) {
        // 实验将失败请求作为结果保存，调用方不会把失败视为正确的空选择。
        failed = true;
        failureReason = String(redactSensitive(error instanceof Error ? error.message : String(error), model ? [model.apiKey] : []));
      }
      const latencyMs = performance.now() - started;
      if (condition === "C") {
        Object.assign(call, {failed, failureReason, latencyMs});
        await fs.appendFile(path.join(directory, "llm-calls.jsonl"), JSON.stringify(redactSensitive(call, model ? [model.apiKey] : [])) + "\n", {mode: 0o600});
      }
      response.json(redactSensitive({failed, failureReason, result, latencyMs, ...(condition === "C" ? {call} : {})}, model ? [model.apiKey] : []));
    })().catch(next);
  });
  registerExperimentRoutes(app, {enabled: true, provider: "minimax", model: "MiniMax-M3", speed: 1, configuration});
  const server = http.createServer(app);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Server address unavailable");
  return {api: new PlatformClient(configSchema.parse({origin: `http://127.0.0.1:${address.port}`, timeoutMs: 150000})),
    async close() {
      await app.locals.agentRuns.dispose();
      await app.locals.agentRuntime.dispose();
      await app.locals.runtimeManager.dispose();
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
  };
}
