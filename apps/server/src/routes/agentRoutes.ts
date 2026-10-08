import type { Express } from "express";
import type { AgentPromptContext } from "@simplercp/shared";
import type { AgentRuntime } from "../agent/agentRuntime.js";
import type { AgentRunManager } from "../agent/agentRunManager.js";
import type { AgentSettingsStore } from "../agent/agentSettingsStore.js";
import { can, requirePermission } from "../auth/permissions.js";
import { requireIdentity } from "../auth/permissions.js";
import { diagnoseAgentFailure } from "../agent/agentRunFailure.js";

export function registerAgentRoutes(
  app: Express,
  dependencies: {
    agentRuntime: AgentRuntime;
    agentRuns: AgentRunManager;
    agentSettings: AgentSettingsStore;
  }
) {
  const { agentRuntime, agentRuns, agentSettings } = dependencies;

  app.get("/api/agent/settings", (req, res) => {
    res.json(agentSettings.get());
  });

  app.put("/api/agent/settings", async (req, res, next) => {
    try {
      if (!can(req.identity, "agent:settings")) { res.sendStatus(403); return; }
      const current = agentSettings.get();
      const nextSettings = req.body as {
        model?: unknown;
        enabled?: unknown;
      };
      if (agentRuns.hasActiveTasks() && nextSettings.enabled !== current.enabled) {
        throw new Error("Agent enabled setting cannot change while tasks are active");
      }
      res.json(await agentSettings.update(req.body));
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/agent/status", async (req, res, next) => {
    try {
      res.json(await agentRuntime.status());
    } catch (error) {
      const failure = diagnoseAgentFailure(error, "creating-session", 0);
      res.status(503).json({ error: failure.guidance, failure });
    }
  });

  app.get("/api/projects/:projectId/agent/sessions", async (req, res, next) => {
    try {
      const memberId = memberIdFor(req);
      if (!memberId) {
        res.status(401).json({ error: "Member identity is required" });
        return;
      }
      res.json({
        sessions: await agentRuns.listSessions(req.params.projectId, memberId)
      });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/projects/:projectId/team-agents", async (req, res, next) => {
    try {
      if (!requireIdentity(req, res)) return;
      res.json({ agents: await agentRuns.listTeamAgents(req.params.projectId) });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/projects/:projectId/team-agents", async (req, res, next) => {
    try {
      const identity = requirePermission(req, res, "agent:create");
      if (!identity) return;
      const name = String(req.body?.name ?? "");
      if (!name.trim()) {
        res.status(400).json({ error: "name is required" });
        return;
      }
      try {
        const agent = await agentRuns.createTeamAgent({
          projectId: req.params.projectId,
          memberId: identity.memberId,
          name,
          description: typeof req.body?.description === "string" ? req.body.description : undefined
        });
        res.status(201).json({ agent });
      } catch (error) {
        if (error instanceof Error && error.message.startsWith("Team Agent handle already exists:")) {
          res.status(409).json({ error: error.message });
          return;
        }
        throw error;
      }
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/projects/:projectId/team-agents/:sessionId/runs", async (req, res, next) => {
    try {
      if (!requireIdentity(req, res)) return;
      const session = await agentRuns.getSession(req.params.projectId, req.params.sessionId);
      if ((session.scope ?? "personal") !== "team") {
        res.status(404).json({ error: "Team Agent not found" });
        return;
      }
      const runs = (await agentRuns.listRuns(req.params.projectId))
        .filter((run) => run.sessionId === session.id);
      res.json({ runs });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/projects/:projectId/agent/sessions", async (req, res, next) => {
    try {
      const memberId = memberIdFor(req);
      if (!memberId) {
        res.status(401).json({ error: "Member identity is required" });
        return;
      }
      const session = await agentRuns.createSession({
        projectId: req.params.projectId,
        memberId,
        title: typeof req.body?.title === "string" ? req.body.title : undefined
      });
      res.status(201).json({ session });
    } catch (error) {
      next(error);
    }
  });

  app.get(
    "/api/projects/:projectId/agent/sessions/:sessionId",
    async (req, res, next) => {
      try {
      const memberId = memberIdFor(req);
        if (!memberId) {
          res.status(400).json({ error: "memberId is required" });
          return;
        }
        try {
          const session = await agentRuns.getSessionForMember(
            req.params.projectId,
            req.params.sessionId,
            memberId
          );
          res.json({ session });
        } catch (error) {
          if (
            error instanceof Error &&
            error.message === "Agent session belongs to another participant"
          ) {
            res.status(403).json({ error: error.message });
            return;
          }
          throw error;
        }
      } catch (error) {
        next(error);
      }
    }
  );

  app.post(
    "/api/projects/:projectId/agent/sessions/:sessionId/runs",
    async (req, res, next) => {
      try {
        const memberId = memberIdFor(req);
        const prompt = String(req.body?.prompt ?? "");
        if (!requirePermission(req, res, "agent:create")) return;
        const contexts = Array.isArray(req.body?.contexts)
          ? req.body.contexts
          : undefined;
        if (!memberId || !prompt) {
          res.status(400).json({ error: "memberId and prompt are required" });
          return;
        }
        const run = await agentRuns.createRun({
          projectId: req.params.projectId,
          memberId,
          initiatorRole: req.identity?.role,
          prompt,
          sessionId: req.params.sessionId,
          contexts
        });
        res.status(202).json({ run });
      } catch (error) {
        next(error);
      }
    }
  );

  app.get("/api/projects/:projectId/agent/runs", async (req, res, next) => {
    try {
      if (!requireIdentity(req, res)) return;
      res.json({ runs: await agentRuns.listRuns(req.params.projectId) });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/projects/:projectId/agent/runs", async (req, res, next) => {
    try {
      if (!requirePermission(req, res, "agent:create")) return;
      const { prompt, sessionId, contexts } = req.body as {
        prompt?: string;
        sessionId?: string;
        contexts?: AgentPromptContext[];
      };
      const memberId = memberIdFor(req);
      if (!memberId || !prompt) {
        res.status(400).json({ error: "memberId and prompt are required" });
        return;
      }
      const run = await agentRuns.createRun({
        projectId: req.params.projectId,
        memberId,
        initiatorRole: req.identity?.role,
        prompt,
        sessionId,
        contexts
      });
      res.status(202).json({ run });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/projects/:projectId/agent/runs/:runId", async (req, res, next) => {
    try {
      if (!requireIdentity(req, res)) return;
      res.json({
        run: await agentRuns.getRun(req.params.projectId, req.params.runId)
      });
    } catch (error) {
      next(error);
    }
  });

  app.get(
    "/api/projects/:projectId/agent/runs/:runId/trace",
    async (req, res, next) => {
      try {
        if (!requireIdentity(req, res)) return;
        const events = await agentRuns.listTrace(
          req.params.projectId,
          req.params.runId
        );
        if (req.query.download === "true") {
          res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
          res.setHeader(
            "Content-Disposition",
            `attachment; filename="trace-${req.params.runId}.jsonl"`
          );
          res.send(`${events.map((event) => JSON.stringify(event)).join("\n")}\n`);
          return;
        }
        res.json({ events });
      } catch (error) {
        next(error);
      }
    }
  );

  app.post(
    "/api/projects/:projectId/agent/runs/:runId/cancel",
    async (req, res, next) => {
      try {
        const memberId = memberIdFor(req);
        const run = await agentRuns.getRun(req.params.projectId, req.params.runId);
        if (!requirePermission(req, res, "agent:cancel", { projectId: req.params.projectId, ownerMemberId: run.initiatorMemberId ?? run.memberId })) return;
        if (!memberId) {
          res.status(401).json({ error: "Member identity is required" });
          return;
        }
        res.json({
          run: await agentRuns.cancelRun(
            req.params.projectId,
            req.params.runId,
            memberId
          )
        });
      } catch (error) {
        next(error);
      }
    }
  );
}

function memberIdFor(req: import("express").Request) {
  return req.identity?.memberId;
}
