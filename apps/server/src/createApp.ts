import cors from "cors";
import express from "express";
import path from "node:path";
import { createAgentRunManager } from "./agent/agentRunManager.js";
import { createChatAgentBridge } from "./agent/chatAgentBridge.js";
import { createAgentSettingsStore } from "./agent/agentSettingsStore.js";
import { createOpenCodeRuntime } from "./agent/openCodeRuntime.js";
import { createFakeAgentRuntime, createTestAgentRuntime } from "./agent/fakeAgentRuntime.js";
import type { ServerConfig } from "./config.js";
import { createProjectRuntimeManager } from "./projectRuntimeManager.js";
import { createProjectRegistry } from "./projects.js";
import { registerAgentRoutes } from "./routes/agentRoutes.js";
import { registerCollaborationRoutes } from "./routes/collaborationRoutes.js";
import { registerProjectRoutes } from "./routes/projectRoutes.js";
import { registerWorkspaceRoutes } from "./routes/workspaceRoutes.js";
import { registerKnowledgeRoutes } from "./routes/knowledgeRoutes.js";
import { createMemberStore, createIdentityMiddleware } from "./auth/identity.js";
import { requireIdentity } from "./auth/permissions.js";
import { createKnowledgeMcpToken, registerKnowledgeMcp } from "./knowledge/mcpServer.js";

export async function createApp(config: ServerConfig) {
  if (config.knowledge === "full" && config.host !== "127.0.0.1") throw new Error("Knowledge MCP requires SIMPLERCP_HOST=127.0.0.1");
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: "5mb" }));
  app.locals.knowledgeMcpUrl = `http://127.0.0.1:${config.port}/mcp/knowledge`;
  const registry = await createProjectRegistry({
    dataDir: config.dataDir,
    workspacesDir: config.workspacesDir ?? path.join(config.dataDir, "workspaces"),
    importRoots: config.importRoots,
    demoProjectRoot: config.demoProjectRoot
  });
  const members = createMemberStore({ projects: () => registry.listProjectsSync() });
  const mcpToken = config.knowledge === "full" ? createKnowledgeMcpToken() : undefined;
  const runtimeManager = createProjectRuntimeManager(registry, {
    terminalEnabled: config.terminalEnabled !== false,
    knowledgeMode: config.knowledge ?? "off",
    knowledgeRecordEvents: config.knowledgeRecordEvents,
    captureConfig: config.captureConfig,
    llm: config.knowledgeLlm
  });
  const agentSettings = await createAgentSettingsStore({
    storagePath: path.join(config.dataDir, "agent", "settings.json"),
    defaultModel: config.agent?.model ?? "deepseek-chat",
    defaultProvider: config.agent?.provider ?? "deepseek",
    apiKeyConfigured: Boolean(config.agent?.apiKey || config.fakeAgentRuntime)
  });
  const openCodeRuntime = createOpenCodeRuntime({
    port: config.agent?.openCodePort ?? 4096,
    provider: config.agent?.provider,
    apiKey: config.agent?.apiKey,
    baseUrl: config.agent?.baseUrl ?? "https://api.deepseek.com/v1",
    getSettings: () => agentSettings.get(),
    ...(mcpToken ? { mcp: { url: () => app.locals.knowledgeMcpUrl as string, token: mcpToken } } : {})
  });
  const agentRuntime = config.fakeAgentRuntime
    ? createTestAgentRuntime(openCodeRuntime, createFakeAgentRuntime(), Boolean(config.agent?.apiKey))
    : openCodeRuntime;
  const agentRuns = createAgentRunManager({
    members,
    runtime: agentRuntime,
    registry,
    runtimeManager,
    getSettings: () => agentSettings.get(),
    apiKey: config.agent?.apiKey,
    sensitiveValues: [config.agent?.apiKey].filter((value): value is string => Boolean(value)),
    runTimeoutMs: config.agent?.runTimeoutMs ?? 600_000,
    appendActivity(projectId, input) {
      return runtimeManager.get(projectId).events.append(input);
    }
  });
  await agentRuns.initialize();
  const chatAgentBridge = createChatAgentBridge({ agentRuns, runtimeManager });

  app.locals.registry = registry;
  app.locals.runtimeManager = runtimeManager;
  app.locals.agentSettings = agentSettings;
  app.locals.agentRuntime = agentRuntime;
  app.locals.agentRuns = agentRuns;
  app.locals.chatAgentBridge = chatAgentBridge;
  app.locals.members = members;
  if (config.knowledge === "full" && mcpToken) {
    registerKnowledgeMcp(app, { runtimeManager, registry, agentRuns, token: mcpToken, enabled: true });
    app.locals.knowledgeMcpToken = mcpToken;
  }
  app.use(createIdentityMiddleware({ members, required: false }));
  app.use("/api/projects/:projectId", (req, res, next) => {
    const publicRequest = (req.method === "GET" && ["/", "/participants"].includes(req.path))
      || (req.method === "POST" && req.path === "/members")
      || (req.method === "DELETE" && req.path === "/");
    const knowledgeDisabled = (config.knowledge ?? "off") === "off" && (req.path.includes("knowledge") || req.originalUrl.includes("/knowledge"));
    if (publicRequest || ["import", "import-zip"].includes(req.params.projectId) || knowledgeDisabled) {
      next();
      return;
    }
    if (requireIdentity(req, res)) next();
  });

  app.get("/api/health", (_req, res) => {
    res.json({
      ok: true,
      dataDir: config.dataDir,
      publicOrigin: config.publicOrigin,
      features: {
        terminal: config.terminalEnabled !== false,
        ...((config.knowledge ?? "off") !== "off"
          ? { knowledge: true, knowledgeMode: config.knowledge }
          : {})
      }
    });
  });

  registerAgentRoutes(app, { agentRuntime, agentRuns, agentSettings, runtimeManager });
  registerProjectRoutes(app, { agentRuns, registry, runtimeManager });
  registerCollaborationRoutes(app, runtimeManager, members, chatAgentBridge);
  registerWorkspaceRoutes(app, runtimeManager);
  registerKnowledgeRoutes(app, runtimeManager, members, (config.knowledge ?? "off") !== "off");

  app.use(
    (
      error: Error,
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction
    ) => {
      const statusCode = (error as Error & { statusCode?: number }).statusCode;
      const status = error.message === "Project not found" || statusCode === 404 ? 404 : statusCode === 409 ? 409 : 400;
      res.status(status).json({ error: error.message });
    }
  );

  return app;
}
