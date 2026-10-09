import fs from "node:fs/promises";
import http from "node:http";
import { createOpencodeClient } from "@opencode-ai/sdk/v2";
import { expect, it } from "vitest";
import { createOpenCodeProcess } from "../agent/openCodeProcess.js";
import { createTestWorkspace } from "./testWorkspace.js";
import { createAgentQuestions } from "../agent/agentQuestions.js";
import { createApprovalBudget } from "../agent/agentRunSupport.js";
import { createOpenCodeRuntime } from "../agent/openCodeRuntime.js";
import { parse } from "dotenv";

it("OpenCode 服务公开 question 工具，查询工具列表无需模型请求", async () => {
  const root = await createTestWorkspace("opencode-question-tools-");
  const server = http.createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("没有可用的服务地址");
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  const process = createOpenCodeProcess({ port: address.port, baseUrl: "http://127.0.0.1:1/v1", model: "deepseek-flash" });
  try {
    const runtime = await process.start();
    const client = createOpencodeClient({ baseUrl: runtime.url });
    const response = await client.tool.ids({ directory: root }, { throwOnError: true, signal: AbortSignal.timeout(10_000) });
    expect(response.data).toContain("question");
    const questions = await client.question.list({ directory: root }, { throwOnError: true, signal: AbortSignal.timeout(10_000) });
    expect(questions.data).toEqual([]);
    const session = await client.session.create({ directory: root, title: "问题清理检查" }, { throwOnError: true });
    const budget = createApprovalBudget();
    const failures: unknown[] = [];
    const questionQueue = createAgentQuestions({
      pause: budget.pause,
      async reply(id, answers, signal) { await client.question.reply({ directory: root, requestID: id, answers }, { throwOnError: true, signal }); },
      async reject(id, signal) { await client.question.reject({ directory: root, requestID: id }, { throwOnError: true, signal }); },
      async abort(signal) { await client.session.abort({ directory: root, sessionID: session.data.id }, { throwOnError: true, signal }); },
      async changed(pending) { await fs.writeFile(root, JSON.stringify(pending)); },
      report(error) { failures.push(error); }
    });
    await expect(questionQueue.dispose()).resolves.toBeUndefined();
    await expect(questionQueue.dispose()).resolves.toBeUndefined();
    expect(failures).toHaveLength(1);
    expect((failures[0] as NodeJS.ErrnoException).code).toBe("EISDIR");
    expect(budget.paused()).toBe(false);
    await client.session.delete({ directory: root, sessionID: session.data.id }, { throwOnError: true });
  } finally { await process.dispose(); await fs.rm(root, { recursive: true, force: true }); }
}, 30_000);

it("准备真实 OpenCode 连接期间取消任务，不会向会话发送旧提示", async () => {
  const root = await createTestWorkspace("opencode-cancel-before-prompt-");
  const env = parse(await fs.readFile(new URL("../../../../.env", import.meta.url)));
  if (!env.DEEPSEEK_API_KEY?.trim()) throw new Error("连接取消检查需要已配置的 DEEPSEEK_API_KEY");
  const portServer = http.createServer();
  await new Promise<void>((resolve) => portServer.listen(0, "127.0.0.1", resolve));
  const address = portServer.address();
  if (!address || typeof address === "string") throw new Error("没有可用的服务地址");
  await new Promise<void>((resolve, reject) => portServer.close((error) => error ? reject(error) : resolve()));
  const options = { port: address.port, baseUrl: "http://127.0.0.1:1/v1", model: "deepseek-flash", apiKey: env.DEEPSEEK_API_KEY.trim() };
  const process = createOpenCodeProcess(options);
  const runtime = createOpenCodeRuntime({ ...options, createProcess: () => process, getSettings: () => ({ provider: "deepseek", model: options.model, enabled: true, apiKeyConfigured: true }) });
  try {
    const session = await runtime.createSession({ workspacePath: root, title: "发送前取消" });
    const task = runtime.run({ workspacePath: root, sessionId: session.id, prompt: "编写 README" });
    const failedTask = expect(task).rejects.toBeDefined();
    await runtime.cancel({ workspacePath: root, sessionId: session.id });
    await failedTask;
    const local = await process.start();
    const client = createOpencodeClient({ baseUrl: local.url });
    const messages = await client.session.messages({ directory: root, sessionID: session.id }, { throwOnError: true });
    expect(messages.data).toEqual([]);
    const questions = await client.question.list({ directory: root }, { throwOnError: true });
    expect(questions.data).toEqual([]);
    await client.session.delete({ directory: root, sessionID: session.id }, { throwOnError: true });
  } finally { await runtime.dispose(); await fs.rm(root, { recursive: true, force: true }); }
}, 30_000);
