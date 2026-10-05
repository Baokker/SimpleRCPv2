import cors from "cors";
import express from "express";
import path from "node:path";
import { execFileSync } from "node:child_process";
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
import { registerConflictGuardRoutes } from "./routes/conflictGuardRoutes.js";
import { createMemberStore, createIdentityMiddleware } from "./auth/identity.js";
import { requireIdentity } from "./auth/permissions.js";

export async function createApp(config: ServerConfig) {
  const gitCommit = config.conflictGuard && config.conflictGuard.mode !== "off" ? readGitCommit() : undefined;
  const sensitiveValues = [...new Set([config.agent?.apiKey, ...(config.sensitiveValues ?? [])].filter((value): value is string => Boolean(value)))];
  const registry = await createProjectRegistry({
    dataDir: config.dataDir,
    workspacesDir: config.workspacesDir ?? path.join(config.dataDir, "workspaces"),
    importRoots: config.importRoots,
    demoProjectRoot: config.demoProjectRoot
  });
  const members = createMemberStore({ projects: () => registry.listProjectsSync() });
  const runtimeManager = createProjectRuntimeManager(registry, {
    terminalEnabled: config.terminalEnabled !== false,
    conflictGuard: config.conflictGuard,
    gitCommit,
    sensitiveValues
  });
  if (config.conflictGuard?.mode === "rules" || config.conflictGuard?.mode === "full") {
    console.warn(`CONFLICT_GUARD=${config.conflictGuard.mode} currently uses observe behavior`);
  }
  const agentSettings = await createAgentSettingsStore({
    storagePath: path.join(config.dataDir, "agent", "settings.json"),
    defaultModel: config.agent?.model ?? "deepseek-chat",
    apiKeyConfigured: Boolean(config.agent?.apiKey || config.fakeAgentRuntime)
  });
  const openCodeRuntime = createOpenCodeRuntime({
    port: config.agent?.openCodePort ?? 4096,
    apiKey: config.agent?.apiKey,
    baseUrl: config.agent?.baseUrl ?? "https://api.deepseek.com/v1",
    getSettings: () => agentSettings.get()
  });
  const agentRuntime = config.fakeAgentRuntime
    ? createTestAgentRuntime(openCodeRuntime, createFakeAgentRuntime(), Boolean(config.agent?.apiKey), () => agentSettings.get().model)
    : openCodeRuntime;
  const agentRuns = createAgentRunManager({
    members,
    runtime: agentRuntime,
    registry,
    runtimeManager,
    getSettings: () => agentSettings.get(),
    apiKey: config.agent?.apiKey,
    sensitiveValues,
    runTimeoutMs: config.agent?.runTimeoutMs ?? 600_000,
    maxConcurrentRuns: config.agent?.maxConcurrentRuns ?? 3,
    appendActivity(projectId, input) {
      return runtimeManager.get(projectId).events.append(input);
    }
  });
  await agentRuns.initialize();
  const chatAgentBridge = createChatAgentBridge({ agentRuns, runtimeManager });

  const app = express();
  app.locals.registry = registry;
  app.locals.runtimeManager = runtimeManager;
  app.locals.agentSettings = agentSettings;
  app.locals.agentRuntime = agentRuntime;
  app.locals.agentRuns = agentRuns;
  app.locals.chatAgentBridge = chatAgentBridge;
  app.locals.members = members;
  app.use(cors());
  app.use(express.json({ limit: "5mb" }));
  app.use(createIdentityMiddleware({ members, required: false }));
  app.use("/api/projects/:projectId", (req, res, next) => {
    const publicRequest = (req.method === "GET" && ["/", "/participants"].includes(req.path))
      || (req.method === "POST" && req.path === "/members")
      || (req.method === "DELETE" && req.path === "/");
    const conflictGuardRequest = req.path.startsWith("/conflict-guard/");
    if (publicRequest || conflictGuardRequest || ["import", "import-zip"].includes(req.params.projectId)) {
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
        conflictGuard: config.conflictGuard?.mode ?? "off",
        terminal: config.terminalEnabled !== false
      }
    });
  });

  registerAgentRoutes(app, { agentRuntime, agentRuns, agentSettings });
  registerProjectRoutes(app, { agentRuns, registry, runtimeManager });
  registerCollaborationRoutes(app, runtimeManager, members, chatAgentBridge);
  registerWorkspaceRoutes(app, runtimeManager);
  registerConflictGuardRoutes(app, runtimeManager);

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

function readGitCommit() {
  try {
    const commit = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
    if (!commit) throw new Error("Git commit is empty");
    return commit;
  } catch (error) {
    console.error("Unable to read Git commit for conflict guard", error);
    return "unknown";
  }
}
