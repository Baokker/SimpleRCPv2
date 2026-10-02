export type Level = "observer" | "student" | "collaborator" | "trusted" | "owner";

export type Capability =
  | "read"
  | "write"
  | "delete"
  | "exec"
  | "network"
  | "history"
  | "process"
  | "privilege"
  | "install";

export type PathZone = "metadata" | "outside" | "protected" | "workspace";
export type Reversibility = "reversible" | "snapshot" | "irreversible";
export type Action = "allow" | "allow_snapshot" | "ask" | "deny";

export interface GuardRequest {
  projectId: string;
  memberId: string;
  source: "terminal" | "agent";
  agentRunId?: string;
  kind: "command" | "edit" | "read" | "fetch";
  command?: string;
  paths?: string[];
  url?: string;
  cwd: string;
  unknownTool?: boolean;
}

export interface GuardSegment {
  text: string;
  capabilities: Capability[];
  zone: PathZone;
  reversibility: Reversibility;
}

export interface GuardDecision {
  action: Action;
  segments: GuardSegment[];
  legacyRisk: "safe" | "risky" | "dangerous" | "unknown";
  matchedRules: string[];
  unknown: boolean;
  autoEligible: boolean;
  approvers: "owners" | "initiator" | "self" | null;
  llm?: {
    mode: "off" | "suggest" | "auto";
    risk: string;
    confidence: number;
    reason: string;
    applied: boolean;
  };
}

export interface GuardContext {
  memberLevel: Level;
  initiatorOnline: boolean;
  workspaceRoot: string;
  platformDataRoot: string;
  otherWorkspaceRoots?: string[];
  protectedPaths?: string[];
}
