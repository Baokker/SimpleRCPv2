import http from "node:http";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createHash } from "node:crypto";
import type { createExperimentBudget } from "../../../packages/conflict-guard/scripts/experiment-budget.ts";

export async function createAgentBenchmarkProxy(options: { baseUrl: string; apiKey: string; budget: Awaited<ReturnType<typeof createExperimentBudget>> }) {
  const records: Array<Record<string, unknown>> = [];
  const users = new Set<string>();
  const active = new Set<Promise<void>>();
  const controllers = new Set<AbortController>();
  let failure: Error | undefined;
  const server = http.createServer((request, response) => {
    const task = forward(request, response).catch((error: unknown) => {
      failure = error instanceof Error ? error : new Error(String(error));
      records.push({ errorType: failure.name, message: failure.message.split(options.apiKey).join("[REDACTED]") });
      response.destroy();
    });
    active.add(task);
    void task.finally(() => active.delete(task));
  });
  async function forward(request: http.IncomingMessage, response: http.ServerResponse) {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = Buffer.concat(chunks).toString();
    const data = JSON.parse(body);
    await options.budget.consume("agentHttpRequests");
    const userHistory = data.messages.filter((message: { role: string }) => message.role === "user");
    const identity = createHash("sha256").update(JSON.stringify(userHistory)).digest("hex");
    if (!users.has(identity)) { await options.budget.consume("agentExecutionsIncludingFollowups"); users.add(identity); }
    const record: Record<string, unknown> = { sequence: records.length + 1, startedAt: new Date().toISOString(), model: data.model, lastUserSha256: identity };
    records.push(record);
    const controller = new AbortController();
    controllers.add(controller);
    response.once("close", () => { if (!response.writableEnded) controller.abort(); });
    const upstream = await fetch(`${options.baseUrl.replace(/\/$/, "")}/chat/completions`, { method: "POST", headers: { Authorization: `Bearer ${options.apiKey}`, "content-type": "application/json" }, body, signal: AbortSignal.any([controller.signal, AbortSignal.timeout(240000)]) });
    record.httpStatus = upstream.status;
    response.writeHead(upstream.status, { "content-type": upstream.headers.get("content-type") ?? "application/json" });
    if (upstream.body) await pipeline(Readable.fromWeb(upstream.body), response); else response.end();
    record.finishedAt = new Date().toISOString();
    controllers.delete(controller);
  }
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("模型请求计数服务未启动");
  return {
    baseUrl: `http://127.0.0.1:${address.port}/v1`, records,
    assertHealthy() { if (failure) throw failure; },
    async dispose() { for (const controller of controllers) controller.abort(); await Promise.all(active); server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); }
  };
}
