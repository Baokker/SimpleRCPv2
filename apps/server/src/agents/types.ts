import type { EventLog } from "../eventLog.js";
import type { TaskStore } from "../tasks.js";

export interface AgentTaskInput {
  workspaceRoot: string;
  events: EventLog;
  tasks: TaskStore;
  taskId: string;
  agentId: string;
}

export interface AgentReport {
  taskId: string;
  agentId: string;
  summary: string;
  commands: string[];
  risks: string[];
}
