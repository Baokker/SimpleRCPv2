export interface SemanticFileProvider {
  listFiles(): string[];
  readFile(file: string): string;
  version(file: string): string | number;
}

export interface SymbolInfo {
  key: string;
  file: string;
  name: string;
  container?: string;
  kind: "function" | "method" | "class" | "property" | "accessor" | "interface" | "type" | "enum" | "variable";
  start: number;
  end: number;
  startLine: number;
  endLine: number;
  exported: boolean;
}

export type RelationKind = "call" | "value-reference" | "type-reference" | "inheritance" | "implementation" | "state-read" | "state-write" | "contains" | "override" | "implements-member";

export interface RelationEdge {
  from: string;
  to: string;
  kind: RelationKind;
  via: string[];
  stale?: boolean;
}

export interface RelationPath {
  from: string;
  to: string;
  hops: Array<{ from: string; to: string; kind: RelationKind; direction: "forward" | "backward" }>;
  typeOnly: boolean;
}

export interface UpdateStats { files: number; durationMs: number; full: boolean }

export interface SemanticIndex {
  update(changedFiles?: string[]): UpdateStats;
  symbolsInFile(file: string): SymbolInfo[];
  symbolsInRange(file: string, start: number, end: number): SymbolInfo[];
  outgoing(key: string): RelationEdge[];
  incoming(key: string): RelationEdge[];
  findPaths(fromKeys: string[], toKeys: string[], maxHops?: number): RelationPath[];
  stats(): { files: number; symbols: number; edges: number; truncated: boolean };
}
