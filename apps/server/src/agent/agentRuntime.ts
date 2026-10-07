import type {
  AgentFileChange,
  AgentRuntimeStatus,
  AgentRunUsage
} from "@simplercp/shared";

export interface AgentRuntimeEvent {
  type: string;
  data: Record<string, unknown>;
}

export interface AgentRuntime {
  status(): Promise<AgentRuntimeStatus>;
  prepareWorkspace?(workspacePath: string): Promise<boolean>;
  prepareRun?(input: { workspacePath: string; sessionId: string; runPrompt: string }): Promise<void>;
  createSession(input: {
    workspacePath: string;
    title: string;
  }): Promise<{ id: string }>;
  run(input: {
    workspacePath: string;
    sessionId: string;
    prompt: string;
    system?: string;
    purpose?: "knowledge-recap";
    model?: string;
  }): Promise<{ text: string; messageId?: string; usage?: AgentRunUsage }>;
  getDiff(input: {
    workspacePath: string;
    sessionId: string;
    messageId?: string;
  }): Promise<AgentFileChange[]>;
  cancel(input: {
    workspacePath: string;
    sessionId: string;
  }): Promise<void>;
  subscribe(
    input: { workspacePath: string; sessionId: string },
    listener: (event: AgentRuntimeEvent) => void | Promise<void>
  ): Promise<() => Promise<void>>;
  dispose(): Promise<void>;
}
