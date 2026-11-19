// Experiment-only copy of apps/server/src/guard/decide.ts with switches for
// ablating one risk dimension or adding a stricter execution profile.
// With all switches off it must agree with the product decide() on every
// record; run-ablation.ts checks this before reporting any variant.
import { characterize } from "../../../apps/server/src/guard/characterize.js";
import { roleLevel } from "../../../apps/server/src/guard/roles.js";
import { segmentAction, stricter } from "../../../apps/server/src/guard/rules.js";
import type { GuardContext, GuardDecision, GuardRequest, GuardSegment, Level } from "../../../apps/server/src/guard/types.js";

export interface VariantOptions {
  /** Every segment is treated as plain code execution, so the role matrix no longer sees what the command does. */
  noCapability?: boolean;
  /** Every path is treated as the shared workspace, so metadata, protected and outside zones disappear. */
  noZone?: boolean;
  /** Every segment is treated as recoverable by snapshot, so no irreversible rule fires. */
  noReversibility?: boolean;
  /** Non-owner code execution needs approval (strict profile S). */
  strictExec?: boolean;
  /** Code execution needs approval when the executed file was written earlier in the same session by a non-owner (profile P). */
  execOfFreshWrite?: boolean;
}

export const VARIANTS: Record<string, VariantOptions> = {
  F: {},
  "F-capability": { noCapability: true },
  "F-zone": { noZone: true },
  "F-reversibility": { noReversibility: true },
  "F+S": { strictExec: true },
  "F+P": { execOfFreshWrite: true }
};

function transform(segment: GuardSegment, options: VariantOptions): GuardSegment {
  return {
    ...segment,
    capabilities: options.noCapability ? ["exec"] : segment.capabilities,
    zone: options.noZone ? "workspace" : segment.zone,
    reversibility: options.noReversibility && segment.reversibility === "irreversible" ? "snapshot" : segment.reversibility
  };
}

export function decideVariant(request: GuardRequest, context: GuardContext, options: VariantOptions = {}, freshWriteExecuted = false): GuardDecision {
  const level: Level = roleLevel(context.memberLevel);
  const protectedPaths = context.protectedPaths ?? [".env*", "*.pem", "*.key", ".git/hooks/**", ".git/config"];
  const raw = characterize(request, context.platformDataRoot, protectedPaths, context.otherWorkspaceRoots);
  const characterization = { ...raw, segments: raw.segments.map((segment) => transform(segment, options)) };
  let action: GuardDecision["action"] = "allow";
  const matchedRules = new Set<string>();
  const controlCharacterPattern = request.source === "terminal"
    ? /[\u0000-\u001f\u007f-\u009f]/
    : /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/;
  if (request.kind === "command" && controlCharacterPattern.test(request.command ?? "")) {
    action = "deny";
    matchedRules.add("hard.control-character");
  }
  if (request.source === "terminal" && request.kind === "command" && /^(?:cd|chdir|pushd|popd|set-location|sl)(?:\s|$)/i.test(request.command?.trim() ?? "")) {
    action = "deny";
    matchedRules.add("hard.cwd");
  }
  for (const segment of characterization.segments) {
    const result = segmentAction(segment, level);
    action = stricter(action, result.action);
    for (const rule of result.rules) matchedRules.add(rule);
  }
  if (characterization.dynamic) {
    action = stricter(action, "ask");
    matchedRules.add("hard.dynamic");
  }
  if (characterization.gitContext) {
    action = stricter(action, "ask");
    matchedRules.add("hard.git-context");
  }
  if (request.unknownTool) {
    action = stricter(action, "ask");
    matchedRules.add("agent.unknown-tool");
  }
  if (characterization.unknown) {
    action = stricter(action, "ask");
    matchedRules.add("classify.unknown");
  }
  if (characterization.legacyRisk === "dangerous" && characterization.segments.every((segment) => segment.capabilities.every((capability) => capability === "exec"))) {
    action = stricter(action, "ask");
    matchedRules.add("hard.legacy-dangerous");
  }
  const executes = characterization.segments.some((segment) => segment.capabilities.includes("exec"));
  if (options.strictExec && level !== "owner" && executes) {
    action = stricter(action, "ask");
    matchedRules.add("variant.strict-exec");
  }
  if (options.execOfFreshWrite && level !== "owner" && executes && freshWriteExecuted) {
    action = stricter(action, "ask");
    matchedRules.add("variant.exec-fresh-write");
  }
  const humanAction = action;
  let agentOnlyAsk = false;
  if (request.source === "agent") {
    if (!context.initiatorOnline && request.kind !== "read") {
      action = "deny";
      matchedRules.add("agent.initiator-offline");
    }
    const agentCap = characterization.segments.some((segment) => segment.reversibility === "irreversible") ||
      Boolean(request.command && /\|/.test(request.command) && /\b(curl|wget|ssh|scp)\b/i.test(request.command));
    if (agentCap) {
      const plainPipeOnlyApproval = characterization.plainDownloadToShell && [...matchedRules].every((rule) => rule === "hard.dynamic" || rule === "hard.outside" || rule === "hard.nonowner.irreversible" || rule === "hard.owner.irreversible-external");
      agentOnlyAsk = humanAction !== "ask" || plainPipeOnlyApproval;
      action = stricter(action, "ask");
      matchedRules.add("agent.default");
    }
  }
  const onlyRoleAsk = action === "ask" && ![...matchedRules].some((rule) => rule.startsWith("hard.") || rule.startsWith("agent.") || rule === "classify.unknown");
  const autoEligible = action === "ask" && (characterization.unknown || onlyRoleAsk) &&
    characterization.segments.every((segment) => segment.zone === "workspace" && segment.reversibility !== "irreversible") &&
    !characterization.dynamic &&
    !characterization.gitContext &&
    !(/\.\./.test(request.command ?? "") || /(?:^|\s)ln(?:\s|$)/i.test(request.command ?? ""));
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
