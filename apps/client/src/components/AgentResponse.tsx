import type { AgentRun } from "../types";

export function AgentResponse({ run }: { run: AgentRun }) {
  const messages = run.activity?.messages?.filter((part) =>
    part.text.trim() && (!run.runtimeSessionId || part.sessionId === run.runtimeSessionId)
  ) ?? [];
  const text = messages.length ? messages.map((part) => part.text).join("\n\n") : run.output;
  return text ? <div className="agent-run-output" data-testid="agent-response" aria-label="Agent 回复">{text}</div> : null;
}
