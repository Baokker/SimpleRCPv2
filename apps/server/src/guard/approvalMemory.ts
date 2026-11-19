import type { GuardDecision, GuardRequest } from "./types.js";
import type { ApproverRole } from "./approvals.js";

const OUTPUT_REDIRECTION = /[ \t]+(?:\d?>&\d|\d?>[ \t]*\/dev\/null|&>[ \t]*\/dev\/null)$/;
const NOT_REUSABLE_RULE = /^(?:hard\.(?:outside|protected|metadata|dynamic|nonowner\.irreversible|owner\.irreversible-external|owner\.git-clean|git-context|control-character|cwd|legacy-dangerous|interactive-control)|agent\.(?:initiator-offline|provenance\.[a-z]+)|role\.[a-z]+\.(?:delete|network|history|process|privilege|install))$/;
const NOT_REUSABLE_CAPABILITIES = new Set(["delete", "network", "history", "process", "privilege", "install"]);

export const REMEMBERED_RULE = "approval.remembered";
export const DEFAULT_APPROVAL_MEMORY_TTL_MS = 30 * 60_000;

export function commandClass(command: string | undefined): string | undefined {
  const text = command?.trim();
  if (!text) return undefined;
  const core = /['"]/.test(text) ? text : text.replace(OUTPUT_REDIRECTION, "").replace(/[ \t]+/g, " ");
  return /[<|;&`$()\\\r\n]/.test(core) ? undefined : core;
}

export function isReusable(request: GuardRequest, decision: GuardDecision) {
  if (request.kind !== "command" || decision.action !== "ask" || !commandClass(request.command)) return false;
  if (!decision.segments.length || decision.segments.some((segment) => segment.reversibility === "irreversible" || segment.zone !== "workspace" || segment.capabilities.some((capability) => NOT_REUSABLE_CAPABILITIES.has(capability)))) return false;
  if (decision.matchedRules.includes("script.foreign-writer")) return false;
  return decision.matchedRules.every((rule) => !NOT_REUSABLE_RULE.test(rule.replace(/^(?:script\.)+/, "")));
}

export function createApprovalMemory(ttlMs = DEFAULT_APPROVAL_MEMORY_TTL_MS, now = () => Date.now()) {
  const entries = new Map<string, Map<string, { approverId: string; approverRole: ApproverRole; at: number }>>();
  const key = (request: GuardRequest, decision: GuardDecision, commandKey: string) =>
    JSON.stringify([request.source, request.sessionScope ?? "personal", request.cwd, commandKey, [...decision.matchedRules].sort()]);

  return {
    recall(request: GuardRequest, decision: GuardDecision) {
      const commandKey = commandClass(request.command);
      if (!commandKey || !isReusable(request, decision)) return undefined;
      const approvals = entries.get(request.memberId);
      const entryKey = key(request, decision, commandKey);
      const entry = approvals?.get(entryKey);
      if (!entry) return undefined;
      if (now() - entry.at >= ttlMs) { approvals!.delete(entryKey); return undefined; }
      return { ...entry, commandClass: commandKey };
    },
    remember(request: GuardRequest, decision: GuardDecision, approverId: string, approverRole: ApproverRole, at = now()) {
      const commandKey = commandClass(request.command);
      if (!commandKey || !isReusable(request, decision)) return;
      const approvals = entries.get(request.memberId) ?? new Map();
      approvals.set(key(request, decision, commandKey), { approverId, approverRole, at });
      entries.set(request.memberId, approvals);
    },
    clearMember(memberId: string) { entries.delete(memberId); },
    clear() { entries.clear(); }
  };
}
