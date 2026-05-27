import type { EventLog } from "../eventLog.js";
import type { TaskStore } from "../tasks.js";
import type { AgentConfig } from "../config.js";

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

export type AgentAction =
  | {
      type: "message";
      text: string;
    }
  | {
      type: "edit_file";
      path: string;
      content: string;
    }
  | {
      type: "run_command";
      command: string;
    }
  | {
      type: "final_report";
      summary: string;
      commands?: string[];
      risks?: string[];
    };

export interface AgentProviderRuntimeConfig extends AgentConfig {
  fetch?: typeof fetch;
}
