import type {
  AgentFileChange,
  AgentRuntimeStatus
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
  }): Promise<{ text: string; messageId?: string }>;
  getDiff(input: {
    workspacePath: string;
    sessionId: string;
    messageId?: string;
  }): Promise<AgentFileChange[]>;
  cancel(input: {
    workspacePath: string;
    sessionId: string;
    signal?: AbortSignal;
  }): Promise<void>;
  replyQuestion?(input: { workspacePath: string; requestId: string; answers: string[][]; signal?: AbortSignal }): Promise<void>;
  rejectQuestion?(input: { workspacePath: string; requestId: string; signal?: AbortSignal }): Promise<void>;
  subscribe(
    input: { workspacePath: string; sessionId: string },
    listener: (event: AgentRuntimeEvent) => void | Promise<void>,
    onListenerError?: (error: unknown) => void | Promise<void>
  ): Promise<() => Promise<void>>;
  dispose(): Promise<void>;
  acquireRun?(): () => void;
  getCurrentModel?(): string;
}
