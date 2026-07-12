import cors from "cors";
import express from "express";
import { createAgentRunStore } from "./agentRuns.js";
import { runAgentTask } from "./agents/runtime.js";
import type { AgentRunStore } from "./agentRuns.js";
import { createChatStore } from "./chat.js";
import type { ChatStore } from "./chat.js";
import type { ServerConfig } from "./config.js";
import { createEventLog, type EventLog } from "./eventLog.js";
import { createRoomStore } from "./rooms.js";
import type { RoomStore } from "./rooms.js";
import { runWorkspaceCommand } from "./runner.js";
import { createScenarioService } from "./scenarios.js";
import { createTaskStore } from "./tasks.js";
import type { TaskStore } from "./tasks.js";
import { createTimelineStore } from "./timeline.js";
import type { TimelineStore } from "./timeline.js";
import {
  createWorkspaceDirectory,
  createWorkspaceFile,
  deleteWorkspacePath,
  listWorkspaceTree,
  readWorkspaceFile,
  renameWorkspacePath,
  writeWorkspaceFile
} from "./workspace.js";

export interface CreateAppOptions {
  agentFetch?: typeof fetch;
}

export function createApp(config: ServerConfig, options: CreateAppOptions = {}) {
  const app = express();
  const events = createEventLog();
  const rooms = createRoomStore(events);
  const tasks = createTaskStore(events);
  const chat = createChatStore(events);
  const agentRuns = createAgentRunStore(events);
  const timeline = createTimelineStore();
  const scenarios = createScenarioService({
    workspaceRoot: config.workspaceRoot,
    events,
    rooms,
    tasks,
    chat,
    agentRuns,
    timeline
  });
  const defaultRoom = rooms.createRoom(config.workspaceRoot);

  app.locals.events = events;
  app.locals.rooms = rooms;
  app.locals.tasks = tasks;
  app.locals.chat = chat;
  app.locals.agentRuns = agentRuns;
  app.locals.timeline = timeline;
  app.locals.scenarios = scenarios;
  app.locals.defaultRoom = defaultRoom;

  app.use(cors());
  app.use(express.json({ limit: "5mb" }));

  app.get("/api/health", (_req, res) => {
    res.json({
      ok: true,
      workspaceRoot: config.workspaceRoot,
      roomId: defaultRoom.id
    });
  });

  app.get("/api/rooms/:roomId", (req, res, next) => {
    try {
      const room = rooms.getRoom(req.params.roomId);
      if (!room) {
        res.status(404).json({ error: "Room not found" });
        return;
      }
      res.json({ room });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/rooms/:roomId/members", (req, res, next) => {
    try {
      const { name, kind, clientId, userId, connectionId, provider } = req.body as {
        name?: string;
        kind?: "human" | "agent";
        clientId?: string;
        userId?: string;
        connectionId?: string;
        provider?: string;
      };
      if (!name) {
        res.status(400).json({ error: "name is required" });
        return;
      }
      const stableClientId =
        clientId ?? `${kind ?? "human"}:${provider ?? name.toLowerCase()}`;
      res.json({
        member: rooms.joinRoom(req.params.roomId, {
          name,
          kind: kind ?? "human",
          clientId: stableClientId,
          userId,
          connectionId,
          provider
        })
      });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/rooms/:roomId/connections/:connectionId/offline", (req, res, next) => {
    try {
      rooms.markConnectionOffline(req.params.roomId, req.params.connectionId);
      rooms.cleanupStaleMembers(req.params.roomId);
      res.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/events", (_req, res) => {
    res.json({ events: events.list() });
  });

  app.get("/api/rooms/:roomId/chat", (req, res) => {
    res.json({ messages: chat.listMessages(req.params.roomId) });
  });

  app.post("/api/rooms/:roomId/chat", async (req, res, next) => {
    const { authorId, authorName, authorKind, text, taskId, runId } = req.body as {
      authorId?: string;
      authorName?: string;
      authorKind?: "human" | "agent";
      text?: string;
      taskId?: string;
      runId?: string;
    };
    if (!authorId || !authorName || !authorKind || !text) {
      res
        .status(400)
        .json({ error: "authorId, authorName, authorKind, and text are required" });
      return;
    }
    try {
      const message = chat.createMessage({
        roomId: req.params.roomId,
        authorId,
        authorName,
        authorKind,
        text,
        taskId,
        runId
      });
      if (message.mentions.includes("MockAgent")) {
        const agentRun = await runMentionedMockAgent({
          roomId: req.params.roomId,
          text,
          authorId,
          triggerMessageId: message.id,
          config,
          rooms,
          tasks,
          chat,
          agentRuns,
          events,
          timeline
        });
        res.json({ message, agentRun });
        return;
      }
      if (mentionsConfiguredAgent(message.mentions, config.agent.mentionAliases)) {
        const agentRun = await runMentionedConfiguredAgent({
          roomId: req.params.roomId,
          text,
          authorId,
          triggerMessageId: message.id,
          config,
          rooms,
          tasks,
          chat,
          agentRuns,
          events,
          timeline,
          agentFetch: options.agentFetch
        });
        res.json({ message, agentRun });
        return;
      }
      res.json({ message });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/rooms/:roomId/agent-runs", (req, res) => {
    res.json({ runs: agentRuns.listRuns(req.params.roomId) });
  });

  app.get("/api/config/commands", (_req, res) => {
    res.json({ commands: config.commandWhitelist });
  });

  app.post("/api/tasks", (req, res, next) => {
    try {
      const task = tasks.createTask(req.body);
      res.json({ task });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/tasks", (req, res) => {
    const roomId =
      typeof req.query.roomId === "string" ? req.query.roomId : undefined;
    res.json({ tasks: tasks.listTasks(roomId) });
  });

  app.post("/api/tasks/:taskId/agent/mock/run", async (req, res, next) => {
    try {
      const { agentId } = req.body as { agentId?: string };
      if (!agentId) {
        res.status(400).json({ error: "agentId is required" });
        return;
      }
      const report = await runAgentTask("mock", {
        workspaceRoot: config.workspaceRoot,
        events,
        tasks,
        taskId: req.params.taskId,
        agentId
      });
      res.json({ report });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/tasks/:taskId/agent/run", async (req, res, next) => {
    try {
      const { agentId } = req.body as { agentId?: string };
      if (!agentId) {
        res.status(400).json({ error: "agentId is required" });
        return;
      }
      const report = await runAgentTask(
        config.agent.provider,
        {
          workspaceRoot: config.workspaceRoot,
          events,
          tasks,
          taskId: req.params.taskId,
          agentId
        },
        config.agent
      );
      res.json({ report });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/tasks/:taskId/run", async (req, res, next) => {
    try {
      const task = tasks.getTask(req.params.taskId);
      const { command, initiatorId } = req.body as {
        command?: string;
        initiatorId?: string;
      };
      if (!task || !command || !initiatorId) {
        res
          .status(400)
          .json({ error: "task, command, and initiatorId are required" });
        return;
      }
      const run = await runWorkspaceCommand({
        workspaceRoot: config.workspaceRoot,
        command,
        whitelist: task.commandWhitelist,
        commandMode: config.commandMode,
        events,
        roomId: task.roomId,
        taskId: task.id,
        initiatorId,
        timeoutMs: 30_000
      });
      res.json({ run });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/runner/run", async (req, res, next) => {
    try {
      const { command, initiatorId } = req.body as {
        command?: string;
        initiatorId?: string;
      };
      if (!command || !initiatorId) {
        res.status(400).json({ error: "command and initiatorId are required" });
        return;
      }
      const run = await runWorkspaceCommand({
        workspaceRoot: config.workspaceRoot,
        command,
        whitelist: config.commandWhitelist,
        commandMode: config.commandMode,
        events,
        roomId: defaultRoom.id,
        initiatorId,
        timeoutMs: 30_000
      });
      res.json({ run });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/config/runtime", (_req, res) => {
    res.json({
      commandMode: config.commandMode,
      commands: config.commandWhitelist,
      agentProvider: config.agent.provider,
      agentConfigured: config.agent.provider === "mock" || Boolean(config.agent.apiKey),
      agentName: config.agent.name,
      agentMentionAliases: config.agent.mentionAliases
    });
  });

  app.get("/api/scenarios", (_req, res) => {
    res.json({ scenarios: scenarios.listScenarios() });
  });

  app.post("/api/scenarios/:scenarioId/run", async (req, res, next) => {
    try {
      const result = await scenarios.runScenario(
        req.params.scenarioId,
        defaultRoom.id
      );
      res.json({
        result,
        timeline: timeline.list(defaultRoom.id),
        messages: chat.listMessages(defaultRoom.id),
        runs: agentRuns.listRuns(defaultRoom.id)
      });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/rooms/:roomId/timeline", (req, res) => {
    res.json({ timeline: timeline.list(req.params.roomId) });
  });

  app.get("/api/workspace/tree", async (_req, res, next) => {
    try {
      res.json({ tree: await listWorkspaceTree(config.workspaceRoot) });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/workspace/file", async (req, res, next) => {
    try {
      const filePath = String(req.query.path ?? "");
      res.json({
        path: filePath,
        content: await readWorkspaceFile(config.workspaceRoot, filePath)
      });
    } catch (error) {
      next(error);
    }
  });

  app.put("/api/workspace/file", async (req, res, next) => {
    try {
      const { path, content } = req.body as {
        path?: string;
        content?: string;
      };
      if (!path || typeof content !== "string") {
        res.status(400).json({ error: "path and content are required" });
        return;
      }

      await writeWorkspaceFile(config.workspaceRoot, path, content);
      res.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/workspace/file", async (req, res, next) => {
    try {
      const { path, content } = req.body as {
        path?: string;
        content?: string;
      };
      if (!path) {
        res.status(400).json({ error: "path is required" });
        return;
      }

      await createWorkspaceFile(config.workspaceRoot, path, content ?? "");
      events.append({
        type: "workspace_file_created",
        roomId: defaultRoom.id,
        payload: { path }
      });
      res.json({ ok: true, tree: await listWorkspaceTree(config.workspaceRoot) });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/workspace/directory", async (req, res, next) => {
    try {
      const { path } = req.body as { path?: string };
      if (!path) {
        res.status(400).json({ error: "path is required" });
        return;
      }

      await createWorkspaceDirectory(config.workspaceRoot, path);
      events.append({
        type: "workspace_directory_created",
        roomId: defaultRoom.id,
        payload: { path }
      });
      res.json({ ok: true, tree: await listWorkspaceTree(config.workspaceRoot) });
    } catch (error) {
      next(error);
    }
  });

  app.patch("/api/workspace/path", async (req, res, next) => {
    try {
      const { fromPath, toPath } = req.body as {
        fromPath?: string;
        toPath?: string;
      };
      if (!fromPath || !toPath) {
        res.status(400).json({ error: "fromPath and toPath are required" });
        return;
      }

      await renameWorkspacePath(config.workspaceRoot, fromPath, toPath);
      events.append({
        type: "workspace_path_renamed",
        roomId: defaultRoom.id,
        payload: { fromPath, toPath }
      });
      res.json({ ok: true, tree: await listWorkspaceTree(config.workspaceRoot) });
    } catch (error) {
      next(error);
    }
  });

  app.delete("/api/workspace/path", async (req, res, next) => {
    try {
      const workspacePath = String(req.query.path ?? "");
      if (!workspacePath) {
        res.status(400).json({ error: "path is required" });
        return;
      }

      await deleteWorkspacePath(config.workspaceRoot, workspacePath);
      events.append({
        type: "workspace_path_deleted",
        roomId: defaultRoom.id,
        payload: { path: workspacePath }
      });
      res.json({ ok: true, tree: await listWorkspaceTree(config.workspaceRoot) });
    } catch (error) {
      next(error);
    }
  });

  app.use(
    (
      error: Error,
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction
    ) => {
      res.status(400).json({ error: error.message });
    }
  );

  return app;
}

interface MentionedMockAgentInput {
  roomId: string;
  text: string;
  authorId: string;
  triggerMessageId: string;
  config: ServerConfig;
  rooms: RoomStore;
  tasks: TaskStore;
  chat: ChatStore;
  agentRuns: AgentRunStore;
  events: EventLog;
  timeline: TimelineStore;
}

async function runMentionedMockAgent({
  roomId,
  text,
  authorId,
  triggerMessageId,
  config,
  rooms,
  tasks,
  chat,
  agentRuns,
  events,
  timeline
}: MentionedMockAgentInput) {
  const agentMember = rooms.joinRoom(roomId, {
    name: "MockAgent",
    kind: "agent",
    userId: "agent-mock",
    connectionId: "agent-mock",
    provider: "mock"
  });
  const task = tasks.createTask({
    roomId,
    title: "Chat request for MockAgent",
    description: text,
    creatorId: authorId,
    assigneeId: agentMember.id,
    editablePaths: ["src/**"],
    commandWhitelist: ["npm test"],
    acceptanceTarget: "Run npm test and report the result"
  });
  const run = agentRuns.createRun({
    roomId,
    agentId: agentMember.id,
    agentName: agentMember.displayName,
    triggerMessageId,
    taskId: task.id
  });
  timeline.append({
    roomId,
    actorName: agentMember.displayName,
    actorKind: "agent",
    type: "agent",
    label: "MockAgent accepted a chat request",
    status: "running",
    taskId: task.id,
    runId: run.id
  });

  chat.createMessage({
    roomId,
    authorId: agentMember.id,
    authorName: agentMember.displayName,
    authorKind: "agent",
    text: "I picked this up. I will inspect the sample, edit the authorized file, run npm test, and report back.",
    taskId: task.id,
    runId: run.id
  });

  try {
    agentRuns.updateStatus(run.id, "thinking", "Reading task context");
    agentRuns.updateStatus(run.id, "editing", "Editing src/hello.ts");
    agentRuns.updateStatus(run.id, "running_command", "Running npm test");
    const report = await runAgentTask("mock", {
      workspaceRoot: config.workspaceRoot,
      events,
      tasks,
      taskId: task.id,
      agentId: agentMember.id
    });
    const completed = agentRuns.updateStatus(
      run.id,
      "completed",
      "MockAgent finished",
      { summary: report.summary }
    );
    chat.createMessage({
      roomId,
      authorId: agentMember.id,
      authorName: agentMember.displayName,
      authorKind: "agent",
      text: `${report.summary} I ran npm test.`,
      taskId: task.id,
      runId: run.id
    });
    timeline.append({
      roomId,
      actorName: agentMember.displayName,
      actorKind: "agent",
      type: "result",
      label: "MockAgent completed the chat request",
      status: "completed",
      detail: report.summary,
      taskId: task.id,
      runId: run.id
    });
    return completed;
  } catch (error) {
    const failed = agentRuns.updateStatus(run.id, "failed", "MockAgent failed", {
      error: error instanceof Error ? error.message : String(error)
    });
    chat.createMessage({
      roomId,
      authorId: agentMember.id,
      authorName: agentMember.displayName,
      authorKind: "agent",
      text: `I could not complete the task: ${failed.error}`,
      taskId: task.id,
      runId: run.id
    });
    timeline.append({
      roomId,
      actorName: agentMember.displayName,
      actorKind: "agent",
      type: "result",
      label: "MockAgent failed the chat request",
      status: "failed",
      detail: failed.error,
      taskId: task.id,
      runId: run.id
    });
    return failed;
  }
}

interface MentionedConfiguredAgentInput extends MentionedMockAgentInput {
  agentFetch?: typeof fetch;
}

async function runMentionedConfiguredAgent({
  roomId,
  text,
  authorId,
  triggerMessageId,
  config,
  rooms,
  tasks,
  chat,
  agentRuns,
  events,
  timeline,
  agentFetch
}: MentionedConfiguredAgentInput) {
  const agentMember = rooms.joinRoom(roomId, {
    name: config.agent.name,
    kind: "agent",
    userId: `agent:${config.agent.name.toLowerCase()}`,
    connectionId: `agent:${config.agent.name.toLowerCase()}`,
    provider: config.agent.provider
  });
  const task = tasks.createTask({
    roomId,
    title: `Chat request for ${config.agent.name}`,
    description: text,
    creatorId: authorId,
    assigneeId: agentMember.id,
    editablePaths: config.agent.editablePaths,
    commandWhitelist: config.commandWhitelist,
    acceptanceTarget: "Complete the requested coding work and report the result"
  });
  const run = agentRuns.createRun({
    roomId,
    agentId: agentMember.id,
    agentName: agentMember.displayName,
    triggerMessageId,
    taskId: task.id
  });

  timeline.append({
    roomId,
    actorName: agentMember.displayName,
    actorKind: "agent",
    type: "agent",
    label: `${agentMember.displayName} accepted a chat request`,
    status: "running",
    taskId: task.id,
    runId: run.id
  });
  chat.createMessage({
    roomId,
    authorId: agentMember.id,
    authorName: agentMember.displayName,
    authorKind: "agent",
    text: "I picked this up. I will use the configured coding provider and report back here.",
    taskId: task.id,
    runId: run.id
  });

  if (!config.agent.apiKey) {
    const blocked = agentRuns.updateStatus(
      run.id,
      "blocked",
      `${agentMember.displayName} needs an API key`,
      { error: "Agent API key is not configured" }
    );
    chat.createMessage({
      roomId,
      authorId: agentMember.id,
      authorName: agentMember.displayName,
      authorKind: "agent",
      text: "I cannot start yet because the server is missing an API key.",
      taskId: task.id,
      runId: run.id
    });
    timeline.append({
      roomId,
      actorName: agentMember.displayName,
      actorKind: "agent",
      type: "result",
      label: `${agentMember.displayName} is blocked by missing API key`,
      status: "blocked",
      detail: blocked.error,
      taskId: task.id,
      runId: run.id
    });
    return blocked;
  }

  try {
    agentRuns.updateStatus(run.id, "thinking", "Reading task context");
    agentRuns.updateStatus(run.id, "running_command", "Calling configured provider");
    const report = await runAgentTask(
      config.agent.provider,
      {
        workspaceRoot: config.workspaceRoot,
        events,
        tasks,
        taskId: task.id,
        agentId: agentMember.id
      },
      config.agent,
      agentFetch
    );
    const completed = agentRuns.updateStatus(
      run.id,
      "completed",
      `${agentMember.displayName} finished`,
      { summary: report.summary }
    );
    chat.createMessage({
      roomId,
      authorId: agentMember.id,
      authorName: agentMember.displayName,
      authorKind: "agent",
      text: report.summary,
      taskId: task.id,
      runId: run.id
    });
    timeline.append({
      roomId,
      actorName: agentMember.displayName,
      actorKind: "agent",
      type: "result",
      label: `${agentMember.displayName} completed the chat request`,
      status: "completed",
      detail: report.summary,
      taskId: task.id,
      runId: run.id
    });
    return completed;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const failed = agentRuns.updateStatus(
      run.id,
      "failed",
      `${agentMember.displayName} failed`,
      { error: message }
    );
    chat.createMessage({
      roomId,
      authorId: agentMember.id,
      authorName: agentMember.displayName,
      authorKind: "agent",
      text: `I could not complete the task: ${message}`,
      taskId: task.id,
      runId: run.id
    });
    timeline.append({
      roomId,
      actorName: agentMember.displayName,
      actorKind: "agent",
      type: "result",
      label: `${agentMember.displayName} failed the chat request`,
      status: "failed",
      detail: message,
      taskId: task.id,
      runId: run.id
    });
    return failed;
  }
}

function mentionsConfiguredAgent(mentions: string[], aliases: string[]) {
  const normalizedMentions = new Set(
    mentions.map((mention) => mention.toLowerCase())
  );
  return aliases.some((alias) => normalizedMentions.has(alias.toLowerCase()));
}
