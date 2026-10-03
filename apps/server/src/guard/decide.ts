import { characterize } from "./characterize.js";
import { roleLevel } from "./roles.js";
import { segmentAction, stricter } from "./rules.js";
import type { GuardContext, GuardDecision, GuardRequest, Level } from "./types.js";

export function decide(request: GuardRequest, context: GuardContext): GuardDecision {
  const level: Level = roleLevel(context.memberLevel);
  const protectedPaths = context.protectedPaths ?? [".env*", "*.pem", "*.key", ".git/hooks/**", ".git/config"];
  const characterization = characterize(request, context.platformDataRoot, protectedPaths, context.otherWorkspaceRoots);
  let action: GuardDecision["action"] = "allow";
  const matchedRules = new Set<string>();
  for (const segment of characterization.segments) {
    const result = segmentAction(segment, level);
    action = stricter(action, result.action);
    for (const rule of result.rules) matchedRules.add(rule);
  }
  if (characterization.dynamic) {
    action = stricter(action, "ask");
    matchedRules.add("hard.dynamic");
  }
  if (request.unknownTool) {
    action = stricter(action, "ask");
    matchedRules.add("agent.unknown-tool");
  }
  if (characterization.unknown) {
    action = stricter(action, "ask");
    matchedRules.add("classify.unknown");
  }
  const humanAction = action;
  let agentOnlyAsk = false;
  if (request.source === "agent") {
    if (!context.initiatorOnline && request.kind !== "read") {
      action = "deny";
      matchedRules.add("agent.initiator-offline");
    }
    const agentCap = characterization.segments.some((segment) => segment.reversibility === "irreversible") ||
      characterization.segments.some((segment) => segment.capabilities.includes("network") && segment.capabilities.includes("exec")) ||
      Boolean(request.command && /\|/.test(request.command) && /\b(curl|wget|ssh|scp)\b/i.test(request.command));
    if (agentCap) {
      agentOnlyAsk = true;
      action = stricter(action, "ask");
      matchedRules.add("agent.default");
    }
  }
  const onlyRoleAsk = action === "ask" && ![...matchedRules].some((rule) => rule.startsWith("hard.") || rule.startsWith("agent.") || rule === "classify.unknown");
  const autoEligible = action === "ask" && (characterization.unknown || onlyRoleAsk) &&
    characterization.segments.every((segment) => segment.zone === "workspace" && segment.reversibility !== "irreversible") &&
    !characterization.dynamic;
  let approvers: GuardDecision["approvers"] = null;
  if (action === "ask") {
    approvers = request.source === "agent" && agentOnlyAsk
      ? "initiator"
      : level === "owner" && request.source === "terminal" ? "self" : "owners";
  }
  return {
    action,
    segments: characterization.segments,
    legacyRisk: characterization.legacyRisk,
    matchedRules: [...matchedRules],
    unknown: characterization.unknown,
    autoEligible,
    approvers
  };
}
