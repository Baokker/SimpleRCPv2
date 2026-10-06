import type { AgentRuntime, AgentRuntimeEvent } from "./agentRuntime.js";
import { runWithTimeout } from "./agentRunSupport.js";
import type { createAgentUsageCollector } from "./agentUsage.js";

export async function executeRuntimePrompt(options: {
  runtime: AgentRuntime;
  input: Parameters<AgentRuntime["run"]>[0];
  timeoutMs: number;
  usage: ReturnType<typeof createAgentUsageCollector>;
  onEvent(event: AgentRuntimeEvent): void | Promise<void>;
  onSubscriptionError(error: unknown): Promise<void>;
}) {
  const { runtime, input, usage } = options;
  const stopEvents = await runtime.subscribe(input, options.onEvent);
  let result: Awaited<ReturnType<AgentRuntime["run"]>> | undefined;
  let failure: unknown;
  try {
    result = await runWithTimeout(runtime.run(input), options.timeoutMs, () => runtime.cancel(input));
    usage.addResult(result.usage, result.messageId);
  } catch (error) {
    failure = error;
  } finally {
    try {
      await stopEvents();
    } catch (error) {
      await options.onSubscriptionError(error);
      failure ??= error;
    }
  }
  if (failure !== undefined) throw failure;
  if (!result) throw new Error("Agent runtime returned no result");
  return result;
}
