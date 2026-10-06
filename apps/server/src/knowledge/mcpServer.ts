import { randomUUID, timingSafeEqual } from "node:crypto";
import path from "node:path";
import type { Express } from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import * as z from "zod/v4";
import type { ProjectRuntimeManager } from "../projectRuntimeManager.js";
import type { ProjectRegistry } from "../projects.js";
import type { AgentRunManager } from "../agent/agentRunManager.js";
import { redactSensitive } from "../agent/traceStore.js";

interface McpOptions { runtimeManager: ProjectRuntimeManager; registry: ProjectRegistry; agentRuns: AgentRunManager; token: string; enabled: boolean; }
const cardTypes = z.enum(["decision", "constraint", "risk", "context", "negative", "tutorial"]);

export function registerKnowledgeMcp(app: Express, options: McpOptions) {
  app.all("/mcp/knowledge", async (req, res, next) => {
    if (!options.enabled) { res.sendStatus(404); return; }
    if (!["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(req.socket.remoteAddress ?? "")) { res.sendStatus(403); return; }
    const received = Buffer.from(req.header("authorization") ?? "");
    const expected = Buffer.from(`Bearer ${options.token}`);
    if (received.length !== expected.length || !timingSafeEqual(received, expected)) { res.status(401).json({ error: "Knowledge MCP token is invalid" }); return; }
    const server = createMcpServer(options);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    try { await server.connect(transport); await transport.handleRequest(req, res, req.body); }
    catch (error) { next(error); }
    finally { await server.close(); }
  });
}

function createMcpServer(options: McpOptions) {
  const server = new McpServer({ name: "simplercp-knowledge", version: "1.0.0" });
  const workspaceSchema = z.string().min(1).describe("Absolute workspace path provided in the task scope");
  async function call(tool: string, input: { workspace: string; query?: string; files?: string[] }, operation: (runtime: ReturnType<ProjectRuntimeManager["get"]>) => Promise<{ payload: unknown; resultIds: string[] }>) {
    const startedAt = Date.now();
    const project = options.registry.listProjectsSync().find((project) => path.isAbsolute(input.workspace) && path.resolve(project.workspacePath) === path.resolve(input.workspace));
    if (!project) return textResult({ error: "workspace does not belong to a project" }, true);
    const runtime = options.runtimeManager.get(project.id);
    const provider = runtime.knowledgeProvider;
    if (!provider) return textResult({ error: "Knowledge is disabled" }, true);
    let resultIds: string[] = []; let errorMessage: string | undefined;
    try {
      if (!(await provider.getConfig()).toolEnabled) return textResult({ results: [], disabled: true });
      const result = await operation(runtime); resultIds = result.resultIds;
      return textResult(result.payload);
    } catch (error) {
      errorMessage = String(redactSensitive(error instanceof Error ? error.message : String(error), runtime.llm?.apiKey ? [runtime.llm.apiKey] : []));
      return textResult({ error: errorMessage }, true);
    } finally {
      await provider.recordToolCall({ tool, workspace: input.workspace, query: input.query, files: input.files, resultIds, startedAt, latencyMs: Date.now() - startedAt, ...(errorMessage ? { error: errorMessage } : {}) });
    }
  }
  server.registerTool("knowledge_search", { description: "Search reviewed team project knowledge; excludes personal and unconfirmed knowledge.", inputSchema: { workspace: workspaceSchema, query: z.string().min(1).max(8000), files: z.array(z.string()).max(50).optional(), types: z.array(cardTypes).optional(), limit: z.number().int().min(1).max(10).optional() } }, (input) => call("knowledge_search", input, async (runtime) => {
    const results = await runtime.knowledgeProvider!.toolSearch(input.query, input.files ?? [], input.limit ?? 5, input.types);
    return { payload: { results }, resultIds: results.map((result) => result.id) };
  }));
  server.registerTool("knowledge_get", { description: "Read a reviewed team card with current anchor locations and contradiction relations.", inputSchema: { workspace: workspaceSchema, id: z.string().min(1) } }, (input) => call("knowledge_get", input, async (runtime) => {
    const card = await runtime.knowledgeProvider!.toolGet(input.id);
    if (!card) throw new Error("Reviewed team knowledge card not found");
    return { payload: { card }, resultIds: [card.id] };
  }));
  server.registerTool("knowledge_propose", { description: "Send a draft to the initiating human's Inbox. Requires project proposeEnabled and a unique running task. Human confirmation is mandatory.", inputSchema: { workspace: workspaceSchema, title: z.string().min(1).max(200), summary: z.string().min(1).max(2000), content: z.string().min(1).max(20_000), type: cardTypes, files: z.array(z.string()).max(50).optional() } }, (input) => call("knowledge_propose", input, async (runtime) => {
    if (!(await runtime.knowledgeProvider!.getConfig()).proposeEnabled) throw new Error("knowledge_propose is disabled for this project");
    const runs = (await options.agentRuns.listRuns(runtime.project.id)).filter((run) => run.status === "running");
    if (runs.length !== 1) throw new Error(runs.length ? "The active Agent run is ambiguous" : "No active Agent run is available");
    const run = runs[0]!;
    const member = runtime.rooms.getMember(runtime.room.id, run.initiatorMemberId ?? run.memberId);
    if (!member || !runtime.capture) throw new Error("Agent run initiator is unavailable");
    const files = (input.files ?? []).map((file) => file.replaceAll("\\", "/"));
    if (files.some((file) => !file || path.isAbsolute(file) || file.split("/").includes(".."))) throw new Error("Proposal files must be workspace relative paths");
    const suggestion = await runtime.capture.propose({ memberId: member.id, displayName: member.displayName }, run.id, { ...input, files });
    return { payload: { suggestionId: suggestion.id, humanConfirmationRequired: true }, resultIds: [] };
  }));
  return server;
}

function textResult(payload: unknown, isError = false) { return { content: [{ type: "text" as const, text: JSON.stringify(payload) }], ...(isError ? { isError: true } : {}) }; }
export function createKnowledgeMcpToken() { return randomUUID(); }
