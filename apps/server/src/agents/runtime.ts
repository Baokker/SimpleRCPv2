import { runMockAgentTask } from "./mockAgent.js";
import type { AgentReport, AgentTaskInput } from "./types.js";

export type AgentProviderName = "mock";

export async function runAgentTask(
  provider: AgentProviderName,
  input: AgentTaskInput
): Promise<AgentReport> {
  if (provider === "mock") {
    return runMockAgentTask(input);
  }

  throw new Error("Unsupported agent provider");
}
