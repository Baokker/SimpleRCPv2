import type { AgentRun } from "@simplercp/shared";

export function canReadAgentRun(run: AgentRun, memberId: string) {
  return run.sessionScope === "team" || run.sessionScope === undefined && run.source === "chat" || run.memberId === memberId;
}
