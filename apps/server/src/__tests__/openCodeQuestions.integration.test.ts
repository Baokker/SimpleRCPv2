import fs from "node:fs/promises";
import http from "node:http";
import { createOpencodeClient } from "@opencode-ai/sdk/v2";
import { expect, it } from "vitest";
import { createOpenCodeProcess } from "../agent/openCodeProcess.js";
import { createTestWorkspace } from "./testWorkspace.js";

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
  } finally { await process.dispose(); await fs.rm(root, { recursive: true, force: true }); }
}, 30_000);
