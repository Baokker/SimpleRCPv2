import { runAgentTask } from "./agents/runtime.js";
import type { AgentRunStore } from "./agentRuns.js";
import type { ChatStore } from "./chat.js";
import type { EventLog } from "./eventLog.js";
import type { RoomStore } from "./rooms.js";
import type { TaskStore } from "./tasks.js";
import type { TimelineStore } from "./timeline.js";

export interface ScenarioSummary {
  id: string;
  name: string;
  description: string;
}

interface ScenarioServiceInput {
  workspaceRoot: string;
  events: EventLog;
  rooms: RoomStore;
  tasks: TaskStore;
  chat: ChatStore;
  agentRuns: AgentRunStore;
  timeline: TimelineStore;
}

const scenarios: ScenarioSummary[] = [
  {
    id: "observable-demo",
    name: "Observable demo",
    description:
      "Bob asks MockAgent for help, MockAgent edits src/hello.ts, runs npm test, and reports the result."
  }
];

export function createScenarioService({
  workspaceRoot,
  events,
  rooms,
  tasks,
  chat,
  agentRuns,
  timeline
}: ScenarioServiceInput) {
  return {
    listScenarios() {
      return scenarios;
    },
    async runScenario(scenarioId: string, roomId: string) {
      if (scenarioId !== "observable-demo") {
        throw new Error("Scenario not found");
      }

      timeline.clearRoom(roomId);
      const bob = rooms.joinRoom(roomId, {
        name: "bob",
        kind: "human",
        userId: "scenario-bob",
        connectionId: "scenario-bob-tab"
      });
      const agent = rooms.joinRoom(roomId, {
        name: "MockAgent",
        kind: "agent",
        userId: "scenario-mock-agent",
        connectionId: "scenario-mock-agent",
        provider: "mock"
      });
      timeline.append({
        roomId,
        actorName: bob.displayName,
        actorKind: "human",
        type: "join",
        label: "bob joined the workspace",
        status: "completed"
      });
      const ask = chat.createMessage({
        roomId,
        authorId: bob.id,
        authorName: bob.displayName,
        authorKind: "human",
        text: "@MockAgent please make the sample pass"
      });
      timeline.append({
        roomId,
        actorName: bob.displayName,
        actorKind: "human",
        type: "chat",
        label: "bob asked MockAgent for help",
        status: "completed"
      });
      const task = tasks.createTask({
        roomId,
        title: "Observable demo request",
        description: ask.text,
        creatorId: bob.id,
        assigneeId: agent.id,
        editablePaths: ["src/**"],
        commandWhitelist: ["npm test"],
        acceptanceTarget: "Run npm test and report the result"
      });
      const run = agentRuns.createRun({
        roomId,
        agentId: agent.id,
        agentName: agent.displayName,
        triggerMessageId: ask.id,
        taskId: task.id
      });
      timeline.append({
        roomId,
        actorName: agent.displayName,
        actorKind: "agent",
        type: "agent",
        label: "MockAgent accepted the task",
        status: "running",
        taskId: task.id,
        runId: run.id
      });
      chat.createMessage({
        roomId,
        authorId: agent.id,
        authorName: agent.displayName,
        authorKind: "agent",
        text: "I will edit src/hello.ts, run npm test, and report what changed.",
        taskId: task.id,
        runId: run.id
      });
      agentRuns.updateStatus(run.id, "editing", "Editing src/hello.ts");
      timeline.append({
        roomId,
        actorName: agent.displayName,
        actorKind: "agent",
        type: "edit",
        label: "MockAgent edited src/hello.ts",
        status: "running",
        taskId: task.id,
        runId: run.id
      });
      agentRuns.updateStatus(run.id, "running_command", "Running npm test");
      timeline.append({
        roomId,
        actorName: agent.displayName,
        actorKind: "agent",
        type: "command",
        label: "MockAgent ran npm test",
        status: "running",
        taskId: task.id,
        runId: run.id
      });

      try {
        const report = await runAgentTask("mock", {
          workspaceRoot,
          events,
          tasks,
          taskId: task.id,
          agentId: agent.id
        });
        const completed = agentRuns.updateStatus(
          run.id,
          "completed",
          "MockAgent finished",
          { summary: report.summary }
        );
        chat.createMessage({
          roomId,
          authorId: agent.id,
          authorName: agent.displayName,
          authorKind: "agent",
          text: `${report.summary} The demo loop is complete.`,
          taskId: task.id,
          runId: run.id
        });
        timeline.append({
          roomId,
          actorName: agent.displayName,
          actorKind: "agent",
          type: "result",
          label: "MockAgent finished and tests passed",
          status: "completed",
          detail: report.summary,
          taskId: task.id,
          runId: run.id
        });
        return completed;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const failed = agentRuns.updateStatus(run.id, "failed", "MockAgent failed", {
          error: message
        });
        timeline.append({
          roomId,
          actorName: agent.displayName,
          actorKind: "agent",
          type: "result",
          label: "MockAgent failed",
          status: "failed",
          detail: message,
          taskId: task.id,
          runId: run.id
        });
        return failed;
      }
    }
  };
}

export type ScenarioService = ReturnType<typeof createScenarioService>;
