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
  mode: string;
  indexing?: boolean;
  degraded?: boolean;
  degradedReason?: string;
  traceWriteFailures?: number;
  version: number;
  index: { files: number; symbols: number; edges: number; truncated: boolean; latestUpdate: { files: number; durationMs: number; full: boolean } };
  activeSymbols: Array<{ actor: { kind: string; memberId?: string }; symbols: ActiveSymbol[] }>;
  candidatePairs: Array<{
    id: string;
    left: { actor: { kind: string; memberId?: string }; symbol: string; status: ActiveSymbol["status"] };
    right: { actor: { kind: string; memberId?: string }; symbol: string; status: ActiveSymbol["status"] };
    distance: number;
    path: { hops: Array<{ from: string; to: string; kind: string; direction: "forward" | "backward" }>; typeOnly?: boolean } | null;
    firstSeenAt: number;
    updatedAt: number;
  }>;
  statistics: { total: number; related: number; unrelated: number; unrelatedRatio: number; typeOnly?: number };
}

export interface ConflictGuardSymbol {
  symbol?: { key: string; file: string; name: string; kind?: ActiveSymbol["kind"]; container?: string; startLine: number; endLine: number } | null;
  text: string;
  changes: Array<ActiveSymbol & { actor: { kind: string; memberId?: string }; before: string; after: string }>;
  outgoing: Array<{ from: string; to: string; kind: string; via: string[] }>;
  incoming: Array<{ from: string; to: string; kind: string; via: string[] }>;
}
