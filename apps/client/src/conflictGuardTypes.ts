export interface GuardActorRef { kind: string; memberId?: string; runId?: string; ownerId?: string; teamAgent?: string }

export interface GuardConflict {
  pairId: string;
  revision: number;
  self: GuardActorRef;
  other: GuardActorRef;
  otherDisplayName: string;
  symbols: { self: string; other: string };
  beforeSignature: string;
  afterSignature: string;
  ruleId: string;
  zone: "white" | "black" | "grey";
  decision: "allow" | "warn" | "lock";
  summaryZh: string;
  explanationZh?: string;
  suggestionZh?: string;
}

export interface ActiveSymbol {
  key: string;
  file: string;
  name: string;
  status: "modified" | "added" | "deleted";
  kind?: "function" | "method" | "class" | "property" | "accessor" | "interface" | "type" | "enum" | "variable";
  container?: string;
  startLine: number;
  endLine: number;
  lastTouchedAt: number;
}

export interface ConflictGuardState {
  intents?: AgentIntent[];
  ownerCards?: OwnerCard[];
  arbitration?: { mode: string; automaticRetries: number; members: Array<{ memberId: string; interruptions: number; perHour: number; light: number; byKind: Record<string, number> }>; outcomes: Record<string, number>; suspendedMs: number };
  mode: string;
  indexing?: boolean;
  degraded?: boolean;
  degradedReason?: string;
  traceWriteFailures?: number;
  version: number;
  index: { files: number; symbols: number; edges: number; truncated: boolean; latestUpdate: { files: number; durationMs: number; full: boolean } };
  activeSymbols: Array<{ actor: GuardActorRef; symbols: ActiveSymbol[] }>;
  candidatePairs: Array<{
    id: string;
    left: { actor: GuardActorRef; symbol: string; symbols?: string[]; status: ActiveSymbol["status"] };
    right: { actor: GuardActorRef; symbol: string; symbols?: string[]; status: ActiveSymbol["status"] };
    distance: number;
    path: { hops: Array<{ from: string; to: string; kind: string; direction: "forward" | "backward" }>; typeOnly?: boolean } | null;
    firstSeenAt: number;
    updatedAt: number;
  }>;
  statistics: { total: number; related: number; unrelated: number; unrelatedRatio: number; typeOnly?: number };
  pairDecisions?: Array<{
    pair: ConflictGuardState["candidatePairs"][number];
    status: string;
    revision: number;
    updatedAt?: number;
    conflict?: GuardConflict;
    point?: "T2" | "T3";
    shadow?: boolean;
    leftConfirmed?: boolean;
    rightConfirmed?: boolean;
    analysisVisible?: boolean;
    verdict?: { zone: "white" | "black" | "grey"; decision: "allow" | "warn" | "lock"; ruleId: string; summary: string; contractChanged?: { left: boolean; right: boolean }; adjudication?: { point?: "T1" | "T2" | "T3"; source: "fast" | "deep" | "fallback"; confidence?: number; latencyMs: number; status: "success" | "degraded"; userExplanation: string; suggestedAction: string } };
    resolution?: string;
    totalLockMs?: number;
  }>;
  frozenFiles?: Array<{ file: string; regions: Array<{ pairId: string; actor: { kind: string; memberId?: string }; startLine: number; endLine: number; summary: string }> }>;
  analyzingFiles?: Array<{ file: string; regions: Array<{ pairId: string; startLine: number; endLine: number; summary: string }> }>;
  adjudication?: { calls: number; cacheHits: number; escalationRatio: number; p50Ms: number; p95Ms: number; failures: number; costUsd: number };
  blockedPersists?: Array<{ file: string; reason: string }>;
  persistConflicts?: number;
  persistBlockedCount?: number;
  uiActionCount?: number;
  intervention?: {
    decisions: number;
    localDecisionRatio: number;
    white: number;
    black: number;
    grey: number;
    frozenDurationMs: number;
    persistBlockedCount: number;
    uiActionCount: number;
  };
  t0Warnings?: Array<{ id: string; pairId: string; summary: string; at: number }>;
  agentNotices?: Array<{ id: string; runId: string; summary: string; at: number }>;
}

export interface AgentIntent {
  actor: GuardActorRef;
  owner: string;
  task: string;
  plannedScope: string[];
  actualScope: string[];
  baseRevision: Record<string, number>;
  taskRevision: number;
  status: "planning" | "running" | "waiting" | "blocked" | "done" | "reverted";
}
export interface OwnerCard {
  id: string;
  conflict: GuardConflict;
  owners: string[];
  intents: AgentIntent[];
  path: string;
  accepted: string[];
  status: string;
  explanation: string;
  suggestion?: string;
  suggestionStatus: string;
  expiresAt: number;
}

export interface ConflictGuardSymbol {
  symbol?: { key: string; file: string; name: string; kind?: ActiveSymbol["kind"]; container?: string; startLine: number; endLine: number } | null;
  text: string;
  changes: Array<ActiveSymbol & { actor: GuardActorRef; before: string; after: string }>;
  outgoing: Array<{ from: string; to: string; kind: string; via: string[] }>;
  incoming: Array<{ from: string; to: string; kind: string; via: string[] }>;
}
