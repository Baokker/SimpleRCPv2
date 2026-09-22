import type { Express } from "express";
import type { AgentPromptContext } from "@simplercp/shared";
import type { AgentRuntime } from "../agent/agentRuntime.js";
import type { AgentRunManager } from "../agent/agentRunManager.js";
import type { AgentSettingsStore } from "../agent/agentSettingsStore.js";

export function registerAgentRoutes(
  app: Express,
  dependencies: {
    agentRuntime: AgentRuntime;
    agentRuns: AgentRunManager;
    agentSettings: AgentSettingsStore;
  }
) {
  const { agentRuntime, agentRuns, agentSettings } = dependencies;

  app.get("/api/agent/settings", (_req, res) => {
    res.json(agentSettings.get());
  });

  app.put("/api/agent/settings", async (req, res, next) => {
    try {
      const current = agentSettings.get();
      const nextSettings = req.body as {
        model?: unknown;
        enabled?: unknown;
      };
      if (
        agentRuns.hasActiveTasks() &&
        (nextSettings.model !== current.model ||
          nextSettings.enabled !== current.enabled)
      ) {
        throw new Error("Agent settings cannot change while tasks are active");
      }
      res.json(await agentSettings.update(req.body));
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/agent/status", async (_req, res, next) => {
    try {
      res.json(await agentRuntime.status());
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/projects/:projectId/agent/sessions", async (req, res, next) => {
    try {
      const memberId = String(req.query.memberId ?? "");
      if (!memberId) {
        res.status(400).json({ error: "memberId is required" });
        return;
      }
      res.json({
        sessions: await agentRuns.listSessions(req.params.projectId, memberId)
      });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/projects/:projectId/agent/sessions", async (req, res, next) => {
    try {
      const memberId = String(req.body?.memberId ?? "");
      if (!memberId) {
        res.status(400).json({ error: "memberId is required" });
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
        const memberId = String(req.query.memberId ?? "");
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
        const memberId = String(req.body?.memberId ?? "");
        const prompt = String(req.body?.prompt ?? "");
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
      res.json({ runs: await agentRuns.listRuns(req.params.projectId) });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/projects/:projectId/agent/runs", async (req, res, next) => {
    try {
      const { memberId, prompt, sessionId, contexts } = req.body as {
        memberId?: string;
        prompt?: string;
        sessionId?: string;
        contexts?: AgentPromptContext[];
      };
      if (!memberId || !prompt) {
        res.status(400).json({ error: "memberId and prompt are required" });
        return;
      }
      const run = await agentRuns.createRun({
        projectId: req.params.projectId,
        memberId,
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
        const memberId = String(req.body?.memberId ?? "");
        if (!memberId) {
          res.status(400).json({ error: "memberId is required" });
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
