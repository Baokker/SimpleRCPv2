import type { AgentRun } from "../types";
import { useI18n } from "../i18n";

export function AgentResponse({ run }: { run: AgentRun }) {
  const { t } = useI18n();
  const messages = run.activity?.messages?.filter((part) =>
    part.text.trim() && (!run.runtimeSessionId || part.sessionId === run.runtimeSessionId)
  ) ?? [];
  const text = messages.length ? messages.map((part) => part.text).join("\n\n") : run.output;
  return text ? <div className="agent-run-output" data-testid="agent-response" aria-label={t("agentResponse")}>{text}</div> : null;
}
