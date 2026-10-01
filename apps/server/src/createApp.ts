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
import { createAuthStore, createIdentityMiddleware } from "./auth/identity.js";
import { createAccessLog, registerAccess } from "./auth/access.js";

export async function createApp(config: ServerConfig) {
  const registry = await createProjectRegistry({
    dataDir: config.dataDir,
    workspacesDir: config.workspacesDir ?? path.join(config.dataDir, "workspaces"),
    importRoots: config.importRoots,
    demoProjectRoot: config.demoProjectRoot
  });
  const auth = createAuthStore({
    dataDir: config.dataDir,
    adminToken: config.adminToken,
    projects: () => registry.listProjectsSync()
  });
  const admin = await auth.initialize();
  const runtimeManager = createProjectRuntimeManager(registry, {
    terminalEnabled: config.terminalEnabled !== false
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
    getSettings: () => agentSettings.get()
  });
  const agentRuns = createAgentRunManager({
    runtime: agentRuntime,
    registry,
    runtimeManager,
    getSettings: () => agentSettings.get(),
    apiKey: config.agent?.apiKey,
    sensitiveValues: [config.agent?.apiKey, admin.adminToken].filter((value): value is string => Boolean(value)),
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
  app.locals.auth = auth;
  app.locals.adminToken = admin.adminToken;
  const accessLog = createAccessLog(path.join(config.dataDir, "instance", "access.json"), runtimeManager);
  app.locals.accessLog = accessLog;
  app.locals.allowedOrigins = config.allowedOrigins ?? [config.publicOrigin];
  app.use(cors({ origin: config.allowedOrigins ?? [config.publicOrigin], credentials: true }));
  app.use(express.json({ limit: "5mb" }));
  app.use(createIdentityMiddleware({ auth, required: false }));
  registerAccess(app, { auth, publicOrigin: config.publicOrigin, allowedOrigins: app.locals.allowedOrigins, accessLog });

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
  registerProjectRoutes(app, { agentRuns, registry, runtimeManager, auth, publicOrigin: config.publicOrigin });
  registerCollaborationRoutes(app, runtimeManager, auth);
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
