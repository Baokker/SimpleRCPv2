import { nanoid } from "nanoid";
import type { EventLog } from "./eventLog.js";
import type { AgentRun, AgentRunStatus } from "./types.js";

interface CreateRunInput {
  roomId: string;
  agentId: string;
  agentName: string;
  triggerMessageId?: string;
  taskId?: string;
}

export function createAgentRunStore(events: EventLog) {
  const runs = new Map<string, AgentRun>();

  return {
    createRun(input: CreateRunInput) {
      const run: AgentRun = {
        id: nanoid(10),
        roomId: input.roomId,
        agentId: input.agentId,
        agentName: input.agentName,
        triggerMessageId: input.triggerMessageId,
        taskId: input.taskId,
        status: "queued",
        startedAt: new Date().toISOString()
      };
      runs.set(run.id, run);
      events.append({
        type: "agent_run_created",
        roomId: run.roomId,
        memberId: run.agentId,
        taskId: run.taskId,
        payload: { runId: run.id, status: run.status }
      });
      return run;
    },
    updateStatus(
      runId: string,
      status: AgentRunStatus,
      lastAction?: string,
      patch: Pick<AgentRun, "summary" | "error"> = {}
    ) {
      const run = runs.get(runId);
      if (!run) {
        throw new Error("Agent run not found");
      }
      run.status = status;
      run.lastAction = lastAction ?? run.lastAction;
      run.summary = patch.summary ?? run.summary;
      run.error = patch.error ?? run.error;
      if (status === "completed" || status === "failed" || status === "blocked") {
        run.endedAt = new Date().toISOString();
      }
      events.append({
        type: "agent_run_updated",
        roomId: run.roomId,
        memberId: run.agentId,
        taskId: run.taskId,
        payload: {
          runId: run.id,
          status: run.status,
          lastAction: run.lastAction,
          summary: run.summary,
          error: run.error
        }
      });
      return run;
    },
    getRun(runId: string) {
      return runs.get(runId);
    },
    listRuns(roomId: string) {
      return [...runs.values()].filter((run) => run.roomId === roomId);
    }
  };
}

export type AgentRunStore = ReturnType<typeof createAgentRunStore>;
