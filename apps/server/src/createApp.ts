import cors from "cors";
import express from "express";
import path from "node:path";
import { createAgentRunManager } from "./agent/agentRunManager.js";
import { createAgentSettingsStore } from "./agent/agentSettingsStore.js";
import { createOpenCodeRuntime } from "./agent/openCodeRuntime.js";
import type { ServerConfig } from "./config.js";
import { createProjectRuntimeManager } from "./projectRuntimeManager.js";
import { createProjectRegistry } from "./projects.js";
import { registerAgentRoutes } from "./routes/agentRoutes.js";
import { registerCollaborationRoutes } from "./routes/collaborationRoutes.js";
import { registerProjectRoutes } from "./routes/projectRoutes.js";
import { registerWorkspaceRoutes } from "./routes/workspaceRoutes.js";
import { createMemberStore, createIdentityMiddleware } from "./auth/identity.js";
import { requireIdentity } from "./auth/permissions.js";

export async function createApp(config: ServerConfig) {
  const registry = await createProjectRegistry({
    dataDir: config.dataDir,
    workspacesDir: config.workspacesDir ?? path.join(config.dataDir, "workspaces"),
    importRoots: config.importRoots,
    demoProjectRoot: config.demoProjectRoot
  });
  const guardMode = config.guardMode ?? "off";
  const members = createMemberStore({ projects: () => registry.listProjectsSync(), normalizeRoles: guardMode !== "off" });
  const runtimeManager = createProjectRuntimeManager(registry, {
    terminalEnabled: config.terminalEnabled !== false,
    guardMembers: members,
    guardDataRoot: config.dataDir,
    guardMode,
    guardApprovalTimeoutMs: config.guardApprovalTimeoutMs,
    otherWorkspaceRoots: () => registry.listProjectsSync().filter((project) => project.id !== "demo").map((project) => project.workspacePath),
    guardLlm: {
      baseUrl: config.agent?.baseUrl,
      apiKey: config.agent?.apiKey,
      model: config.agent?.model
    }
  });
  const agentSettings = await createAgentSettingsStore({
    storagePath: path.join(config.dataDir, "agent", "settings.json"),
    defaultModel: config.agent?.model ?? "deepseek-chat",
    apiKeyConfigured: Boolean(config.agent?.apiKey)
  });
  const agentRuntime = createOpenCodeRuntime({
    port: config.agent?.openCodePort ?? 4096,
    apiKey: config.agent?.apiKey,
    baseUrl: config.agent?.baseUrl ?? "https://api.deepseek.com/v1",
    getSettings: () => agentSettings.get(),
    guardMode
  });
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

  const app = express();
  app.locals.registry = registry;
  app.locals.runtimeManager = runtimeManager;
  app.locals.agentSettings = agentSettings;
  app.locals.agentRuntime = agentRuntime;
  app.locals.agentRuns = agentRuns;
  app.locals.members = members;
  app.use(cors());
  app.use(express.json({ limit: "5mb" }));
  app.use(createIdentityMiddleware({ members, required: false }));
  app.use("/api/projects/:projectId", (req, res, next) => {
    const publicRequest = (req.method === "GET" && ["/", "/participants"].includes(req.path))
      || (req.method === "POST" && req.path === "/members")
      || (req.method === "DELETE" && req.path === "/");
    if (publicRequest || ["import", "import-zip"].includes(req.params.projectId)) {
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
        terminal: config.terminalEnabled !== false
      }
    });
  });

  registerAgentRoutes(app, { agentRuntime, agentRuns, agentSettings });
  registerProjectRoutes(app, { agentRuns, registry, runtimeManager });
  registerCollaborationRoutes(app, runtimeManager, members);
  registerWorkspaceRoutes(app, runtimeManager);

  app.use(
    (
      error: Error,
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction
    ) => {
      const status = error.message === "Project not found" ? 404 : 400;
      res.status(status).json({ error: error.message });
    }
  );

  return app;
}
