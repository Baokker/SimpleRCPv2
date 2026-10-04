export interface ActiveSymbol {
  key: string;
  file: string;
  name: string;
  status: "modified" | "added" | "deleted";
  startLine: number;
  endLine: number;
  lastTouchedAt: number;
}

export interface ConflictGuardState {
  mode: string;
  version: number;
  index: { files: number; symbols: number; edges: number; truncated: boolean; latestUpdate: { files: number; durationMs: number; full: boolean } };
  activeSymbols: Array<{ actor: { kind: string; memberId?: string }; symbols: ActiveSymbol[] }>;
  candidatePairs: Array<{
    id: string;
    left: { actor: { kind: string; memberId?: string }; symbol: string; status: ActiveSymbol["status"] };
    right: { actor: { kind: string; memberId?: string }; symbol: string; status: ActiveSymbol["status"] };
    distance: number;
    path: { hops: Array<{ from: string; to: string; kind: string; direction: "forward" | "backward" }> } | null;
    firstSeenAt: number;
    updatedAt: number;
  }>;
  statistics: { total: number; related: number; unrelated: number; unrelatedRatio: number };
}

export interface ConflictGuardSymbol {
  text: string;
  changes: Array<ActiveSymbol & { actor: { kind: string; memberId?: string }; before: string; after: string }>;
  outgoing: Array<{ from: string; to: string; kind: string; via: string[] }>;
  incoming: Array<{ from: string; to: string; kind: string; via: string[] }>;
}
