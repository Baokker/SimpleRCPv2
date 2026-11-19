import type { GuardDecision, GuardRequest } from "./types.js";

// Approvals that may be reused for the rest of a session. A command whose only difference is a
// read-only output filter or an output redirection (npm test, npm test 2>&1 | tail -20) is the same
// command class, so the approver is asked once. Requests touching protected or outside paths,
// irreversible operations, history or process control always ask again.

const READ_ONLY_FILTER = /^(?:tail|head|grep|egrep|fgrep|wc|sort|uniq|cut|tr|cat|nl|column|less|more)(?:\s|$)|^sed\s+-n(?:\s|$)/;
const OUTPUT_REDIRECTION = /\s*(?:\d?>&\d|\d?>\s*\/dev\/null|&>\s*\/dev\/null)/g;
const NOT_REUSABLE_RULE = /^(?:hard\.(?:outside|protected|metadata|nonowner\.irreversible|owner\.irreversible-external|owner\.git-clean|git-context|control-character|cwd|legacy-dangerous|interactive-control)|agent\.initiator-offline|role\.[a-z]+\.(?:delete|network|history|process|privilege|install))$/;

export const REMEMBERED_RULE = "approval.remembered";
const DEFAULT_TTL_MS = 30 * 60_000;

// Splits on pipes outside quotes; returns undefined when the command chains or substitutes commands.
function pipelineParts(text: string): string[] | undefined {
  const parts: string[] = [];
  let current = "";
  let quote: string | undefined;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]!;
    if (quote) {
      if (char === quote) quote = undefined;
      else if (quote === "\"" && (char === "`" || (char === "$" && text[index + 1] === "("))) return undefined;
      current += char;
      continue;
    }
    if (char === "'" || char === "\"") { quote = char; current += char; continue; }
    if (char === "`" || char === ";" || char === "\n" || (char === "$" && text[index + 1] === "(")) return undefined;
    if (char === "&" && !/\d?>$/.test(current)) return undefined;
    if (char === "|") {
      if (text[index + 1] === "|") return undefined;
      parts.push(current.trim()); current = ""; continue;
    }
    current += char;
  }
  if (quote) return undefined;
  parts.push(current.trim());
  return parts;
}

export function commandClass(command: string | undefined): string | undefined {
  const text = command?.trim();
  if (!text) return undefined;
  const parts = pipelineParts(text);
  if (!parts) return undefined;
  const [core, ...filters] = parts;
  if (!core || filters.some((filter) => !READ_ONLY_FILTER.test(filter.replace(OUTPUT_REDIRECTION, "").trim()))) return undefined;
  const normalized = core.replace(OUTPUT_REDIRECTION, "").replace(/\s+/g, " ").trim();
  if (!normalized || /[<>]/.test(normalized)) return undefined;
  return normalized;
}

export function isReusable(request: GuardRequest, decision: GuardDecision) {
  if (request.kind !== "command" || decision.action !== "ask") return false;
  if (decision.segments.some((segment) => segment.reversibility === "irreversible" || segment.zone !== "workspace")) return false;
  return decision.matchedRules.every((rule) => !NOT_REUSABLE_RULE.test(rule.replace(/^script\./, "")));
}

export function createApprovalMemory(ttlMs = DEFAULT_TTL_MS, now = () => Date.now()) {
  const entries = new Map<string, { approverId?: string; at: number }>();
  const key = (request: GuardRequest, commandKey: string) => `${request.memberId}\u0000${request.source}\u0000${commandKey}`;

  return {
    // Returns the earlier approval for the same requester, channel and command class, if any.
    recall(request: GuardRequest, decision: GuardDecision) {
      const commandKey = commandClass(request.command);
      if (!commandKey || !isReusable(request, decision)) return undefined;
      const entry = entries.get(key(request, commandKey));
      if (!entry) return undefined;
      if (now() - entry.at > ttlMs) { entries.delete(key(request, commandKey)); return undefined; }
      return { ...entry, commandClass: commandKey };
    },
    remember(request: GuardRequest, decision: GuardDecision, approverId?: string) {
      const commandKey = commandClass(request.command);
      if (!commandKey || !isReusable(request, decision)) return;
      entries.set(key(request, commandKey), { approverId, at: now() });
    },
    clear() { entries.clear(); }
  };
}
