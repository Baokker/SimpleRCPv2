import type { Action, Capability, GuardSegment, Level, PathZone, Reversibility } from "./types.js";

export const ROLE_MATRIX: Record<Exclude<Level, "owner">, Record<Capability, Action>> = {
  observer: { read: "allow", write: "deny", delete: "deny", exec: "deny", network: "deny", history: "deny", process: "deny", privilege: "deny", install: "deny" },
  student: { read: "allow", write: "allow_snapshot", delete: "ask", exec: "allow", network: "ask", history: "ask", process: "ask", privilege: "deny", install: "ask" },
  collaborator: { read: "allow", write: "allow_snapshot", delete: "allow_snapshot", exec: "allow", network: "allow", history: "ask", process: "ask", privilege: "deny", install: "ask" },
  trusted: { read: "allow", write: "allow", delete: "allow_snapshot", exec: "allow", network: "allow", history: "ask", process: "ask", privilege: "ask", install: "ask" }
};

export const ACTION_ORDER: Record<Action, number> = { allow: 0, allow_snapshot: 1, ask: 2, deny: 3 };

export function stricter(left: Action, right: Action): Action {
  return ACTION_ORDER[left] >= ACTION_ORDER[right] ? left : right;
}

export function segmentAction(segment: GuardSegment, level: Level): { action: Action; rules: string[] } {
  let action: Action = level === "owner" ? "allow" : "allow";
  const rules: string[] = [];
  for (const capability of segment.capabilities) {
    const next = level === "owner" ? "allow" : ROLE_MATRIX[level][capability];
    if (next !== "allow") rules.push(`role.${level}.${capability}`);
    action = stricter(action, next);
  }
  if (segment.zone === "metadata") { action = stricter(action, "deny"); rules.push("hard.metadata"); }
  if (segment.zone === "outside") { action = stricter(action, "ask"); rules.push("hard.outside"); }
  if (segment.zone === "protected") { action = stricter(action, "ask"); rules.push("hard.protected"); }
  if (segment.reversibility === "irreversible") {
    if (level === "owner") {
      if (segment.capabilities.some((capability) => ["network", "privilege", "install", "delete"].includes(capability))) {
        action = stricter(action, "ask");
        rules.push("hard.owner.irreversible-external");
      }
    } else {
      action = stricter(action, "ask");
      rules.push("hard.nonowner.irreversible");
    }
  }
  if (level === "owner" && segment.capabilities.includes("delete") && /\bgit\s+clean\b/i.test(segment.text)) {
    action = stricter(action, "ask");
    rules.push("hard.owner.git-clean");
  }
  return { action, rules };
}
