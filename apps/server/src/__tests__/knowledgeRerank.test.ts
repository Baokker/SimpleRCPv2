import http from "node:http";
import path from "node:path";
import fs from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";
import { createOpenAICompatibleClient, type KnowledgeCard } from "@simplercp/knowledge";
import { createKnowledgeRerankPolicy, defaultKnowledgeProviderConfig } from "../knowledge/provider.js";
import { selectKnowledgeInjection } from "../knowledge/injection.js";

const servers: http.Server[] = [];

describe("knowledge injection M3 rerank", () => {
  it("uses M3 ordering and keeps the same top five for repeated selection", async () => {
    let selectedId: string | undefined;
    let selectedTitle: string | undefined;
    const server = await startServer(async (request) => {
      const body = JSON.parse(await readBody(request)) as { messages: Array<{ content: string }> };
      const input = JSON.parse(body.messages[1]!.content) as { candidates: Array<{ id: string; title: string }> };
      selectedId = input.candidates[1]?.id;
      selectedTitle = input.candidates[1]?.title;
      return { status: 200, body: JSON.stringify({ choices: [{ message: { content: JSON.stringify({ selected: [{ id: selectedId, reason: "specific task match" }] }) } }] }) };
    });
    const cards = createCards();
    const indexDir = await createIndexDir();
    try {
      const client = createOpenAICompatibleClient({ baseUrl: server.url, model: "MiniMax-M3", provider: "minimax" });
      const policy = createKnowledgeRerankPolicy({ projectId: "demo", client, model: "MiniMax-M3" });
      const first = await select(cards, indexDir, policy);
      const second = await select(cards, indexDir, policy);
      expect(first.rankingSource).toBe("m3");
      expect(first.records[0]?.title).toBe(selectedTitle);
      expect(second.records.map(record => record.id)).toEqual(first.records.map(record => record.id));
    } finally {
      await fs.rm(indexDir, { recursive: true, force: true });
      await stopServer(server.server);
    }
  });

  it.each([
    ["http error", async () => ({ status: 500, body: "{\"error\":{\"message\":\"service unavailable\"}}" }), "OpenAI compatible endpoint returned 500"],
    ["invalid JSON", async () => ({ status: 200, body: JSON.stringify({ choices: [{ message: { content: "not-json" } }] }) }), "did not contain a JSON object"],
  ])("uses BM25 after %s", async (_name, response, reason) => {
    const server = await startServer(response);
    const cards = createCards();
    const indexDir = await createIndexDir();
    try {
      const client = createOpenAICompatibleClient({ baseUrl: server.url, model: "MiniMax-M3", provider: "minimax" });
      const policy = createKnowledgeRerankPolicy({ projectId: "demo", client, model: "MiniMax-M3" });
      const result = await select(cards, indexDir, policy);
      expect(result.rankingSource).toBe("bm25-fallback");
      expect(result.rerankFallbackReason).toContain(reason);
      expect(result.records.map(record => record.id)).toEqual((await select(cards, indexDir)).records.map(record => record.id));
    } finally {
      await fs.rm(indexDir, { recursive: true, force: true });
      await stopServer(server.server);
    }
  });

  it("uses BM25 after a request timeout without retrying", async () => {
    let requests = 0;
    const server = await startServer(async () => {
      requests += 1;
      await new Promise(resolve => setTimeout(resolve, 40));
      return { status: 200, body: JSON.stringify({ choices: [{ message: { content: '{"selected":[]}' } }] }) };
    });
    const cards = createCards();
    const indexDir = await createIndexDir();
    try {
      const client = createOpenAICompatibleClient({ baseUrl: server.url, model: "MiniMax-M3", provider: "minimax" });
      const policy = createKnowledgeRerankPolicy({ projectId: "demo", client, model: "MiniMax-M3", timeoutMs: 10 });
      const result = await select(cards, indexDir, policy);
      expect(result.rankingSource).toBe("bm25-fallback");
      expect(result.rerankFallbackReason).toContain("aborted");
      expect(requests).toBe(1);
    } finally {
      await fs.rm(indexDir, { recursive: true, force: true });
      await stopServer(server.server);
    }
  });
});

async function select(cards: KnowledgeCard[], indexDir: string, selectionPolicy?: ReturnType<typeof createKnowledgeRerankPolicy>) {
  return selectKnowledgeInjection({
    cards,
    viewerMemberId: "member",
    query: "preserve shared helper during session changes",
    activeFiles: ["src/session.ts"],
    config: { ...defaultKnowledgeProviderConfig, lexicalScoring: "bm25", topK: 5, maxCharsPerCard: 800, maxTotalChars: 4000 },
    workspaceId: "demo",
    indexDir,
    selectionPolicy
  });
}

async function createIndexDir() {
  const root = path.join(process.cwd(), ".test-artifacts");
  await fs.mkdir(root, { recursive: true });
  return fs.mkdtemp(path.join(root, "rerank-"));
}

function createCards(): KnowledgeCard[] {
  return ["shared helper", "session state", "database migration", "HTTP retry", "editor layout", "release process"].map((title, index) => ({
    schemaVersion: 3,
    id: `card-${index}`,
    type: "constraint",
    title,
    summary: `Rule about ${title}`,
    content: `Keep the ${title} behavior stable.`,
    source: "manual",
    status: "reviewed",
    scope: "team",
    tags: [title.replaceAll(" ", "-")],
    createdAt: index + 1,
    updatedAt: index + 1,
    metadata: {},
    evolution: [],
    anchors: [{ anchorId: `anchor-${index}`, file: { workspaceRelativePath: "src/session.ts" }, associationLevel: "file", snapshot: { text: title } }]
  }));
}

async function startServer(handler: (request: http.IncomingMessage) => Promise<{ status: number; body: string }>) {
  const server = http.createServer(async (request, response) => {
    const result = await handler(request);
    response.writeHead(result.status, { "content-type": "application/json" });
    response.end(result.body);
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  servers.push(server);
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Rerank server address missing");
  return {server, url: `http://127.0.0.1:${address.port}/v1`};
}

async function stopServer(server: http.Server) {
  const index = servers.indexOf(server);
  if (index >= 0) servers.splice(index, 1);
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
}

async function readBody(request: http.IncomingMessage) {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map(stopServer));
});
