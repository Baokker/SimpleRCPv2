import type { AgentConfig } from "../config.js";
import { runMockAgentTask } from "./mockAgent.js";
import { runOpenAICompatibleAgentTask } from "./openaiCompatible.js";
import type { AgentReport, AgentTaskInput } from "./types.js";

export type AgentProviderName = "mock" | "openai-compatible";

export async function runAgentTask(
  provider: AgentProviderName,
  input: AgentTaskInput,
  config?: AgentConfig
): Promise<AgentReport> {
  if (provider === "mock") {
    return runMockAgentTask(input);
  }
  if (provider === "openai-compatible") {
    if (!config) {
      throw new Error("Agent config is required");
    }
    return runOpenAICompatibleAgentTask(input, config);
  }

  throw new Error("Unsupported agent provider");
}
