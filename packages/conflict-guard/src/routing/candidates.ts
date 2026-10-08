import { createHash } from "node:crypto";
import type { ActiveChangeSet, ActorRef, EditBatch, FileChange } from "../model/types.js";
import type { RelationEdge, SemanticIndex, RelationPath } from "../semantic/types.js";
import { mapSymbolChanges, type SymbolChange } from "../semantic/changes.js";
import { isSemanticFile } from "../semantic/index.js";
import { parseSymbols } from "../semantic/symbols.js";

export interface CandidatePair {
  id: string;
  left: { actor: ActorRef; symbol: string; symbols?: string[]; status: SymbolChange["status"] };
  right: { actor: ActorRef; symbol: string; symbols?: string[]; status: SymbolChange["status"] };
  relations?: Array<{ left: string; right: string; path: RelationPath | null }>;
  distance: 0 | 1 | 2;
  path: RelationPath | null;
  firstSeenAt: number;
  updatedAt: number;
  /** 双方符号内容与关系路径的稳定指纹，用于变更对修订号。 */
  revisionKey?: string;
}

export interface ChangeUnitStatistics { total: number; related: number; unrelated: number; unrelatedRatio: number; typeOnly: number }

export type SemanticChangeEvent =
  | { type: "change_unit"; actor: ActorRef; batchId: string; commentOnly: boolean; symbols: Array<{ key: string; file: string; status: SymbolChange["status"]; beforeHash: string; afterHash: string }> }
  | { type: "pair_candidate_opened" | "pair_candidate_updated" | "pair_candidate_closed"; pair: CandidatePair };

export class SemanticChangeTracker {
  private changeSets: ActiveChangeSet[] = [];
  private pairs = new Map<string, CandidatePair>();
  private readonly fingerprints = new Map<string, string>();
  private readonly units = new Map<string, { actor: string; file: string; generation: string; symbols: string[] }>();
  private readonly relatedUnits = new Set<string>();
  private readonly relatedSymbols = new Map<string, Set<string>>();
  private readonly listeners = new Set<(event: SemanticChangeEvent) => void>();
  private readonly staleEdges = new Map<string, RelationEdge>();

  constructor(private readonly options: { index: SemanticIndex; readFile(file: string): string; now(): number }) {}

  update(changeSets: ActiveChangeSet[], batches: Array<{ batch: EditBatch; change?: FileChange }> = []) {
    this.changeSets = changeSets;
    for (const changeSet of this.changeSets) for (const change of changeSet.files.values()) change.symbols = isSemanticFile(change.file) ? mapSymbolChanges(change, change.proposalText ?? this.options.readFile(change.file), this.options.index) : [];
    for (const { batch, change } of batches) {
      if (!["human", "agent"].includes(batch.actor.kind) || !isSemanticFile(batch.file)) continue;
      const changeSet = this.changeSets.find((set) => actorKey(set.actor) === actorKey(batch.actor));
      const cumulative = change ?? changeSet?.files.get(batch.file);
      const fileChange = cumulative ? {
        ...cumulative,
        baseText: cumulative.baseText,
        ranges: batch.ranges,
        semanticRanges: batch.semanticRanges,
        firstTouchedAt: cumulative.firstTouchedAt,
        lastTouchedAt: batch.endedAt,
        symbols: undefined
      } : undefined;
      const symbols = fileChange ? mapSymbolChanges(fileChange, batch.textAfter, this.options.index) : [];
      if (symbols.length === 0 && !batch.commentOnly) continue;
      this.emit({ type: "change_unit", actor: batch.actor, batchId: batch.id, commentOnly: batch.commentOnly === true, symbols: symbols.map((symbol) => ({ key: symbol.key, file: symbol.file, status: symbol.status, beforeHash: hash(symbol.before), afterHash: hash(symbol.after) })) });
      if (symbols.length === 0) continue;
      this.units.set(JSON.stringify([actorKey(batch.actor), batch.id]), { actor: actorKey(batch.actor), file: batch.file, generation: generation(fileChange!), symbols: symbols.map((symbol) => symbol.key) });
    }
    const active = this.changeSets.filter((set) => ["human", "agent"].includes(set.actor.kind) && set.status !== "closed").sort((a, b) => actorKey(a.actor).localeCompare(actorKey(b.actor)));
    const deletedKeys = new Set(active.flatMap((set) => [...set.files.values()].flatMap((file) => file.symbols ?? []).filter((symbol) => symbol.status === "deleted").map((symbol) => symbol.key)));
    for (const [key, edge] of this.staleEdges) if (edge.dangling || (!deletedKeys.has(edge.from) && !deletedKeys.has(edge.to))) this.staleEdges.delete(key);
    const deletedSymbols = active.flatMap((set) => [...set.files.values()].flatMap((file) => (file.symbols ?? []).filter((symbol) => symbol.status === "deleted").map((symbol) => ({ actor: actorKey(set.actor), symbol }))));
    for (const set of active) for (const change of set.files.values()) for (const symbol of change.symbols ?? []) {
      if (symbol.status === "deleted") continue;
      for (const deleted of deletedSymbols) {
        if (deleted.actor === actorKey(set.actor) || !this.options.index.unresolvedReferences?.(symbol.key).some((reference) => reference.name === deleted.symbol.name && (reference.via.includes(deleted.symbol.file) || symbol.file === deleted.symbol.file))) continue;
        this.staleEdges.set(`${symbol.key}:${deleted.symbol.key}:value-reference`, { from: symbol.key, to: deleted.symbol.key, kind: "value-reference", via: [], stale: true, dangling: true });
      }
    }
    const nextPairs = new Map<string, CandidatePair>();
    for (let leftIndex = 0; leftIndex < active.length; leftIndex += 1) for (const rightSet of active.slice(leftIndex + 1)) {
      const leftSet = active[leftIndex]!;
      const leftSymbols = symbolsByKey(leftSet);
      const rightSymbols = symbolsByKey(rightSet);
      const leftClusters = this.clusters(leftSet, leftSymbols);
      const rightClusters = this.clusters(rightSet, rightSymbols);
      const modifiedTypes = new Set([...leftSymbols.values(), ...rightSymbols.values()].filter((symbol) => ["interface", "type", "enum"].includes(symbol.kind)).map((symbol) => symbol.key));
      const paths = this.findPaths([...leftSymbols.keys()], [...rightSymbols.keys()], 2).filter((path) => !path.typeOnly || [path.from, path.to, ...path.hops.flatMap((hop) => [hop.from, hop.to])].some((key) => modifiedTypes.has(key)));
      for (const leftSymbol of leftSymbols.values()) for (const rightSymbol of rightSymbols.values()) {
        if (leftSymbol.key === rightSymbol.key || isNestedPair(leftSymbol.key, rightSymbol.key)) paths.push({ from: leftSymbol.key, to: rightSymbol.key, hops: [], typeOnly: true });
      }
      const shortest = new Map<string, RelationPath>();
      for (const path of paths) {
        const key = `${path.from}:${path.to}`;
        const previous = shortest.get(key);
        if (!previous || path.hops.length < previous.hops.length) shortest.set(key, path);
      }
      const grouped = new Map<string, RelationPath[]>();
      for (const path of shortest.values()) {
        const clusterKey = JSON.stringify([leftClusters.get(path.from), rightClusters.get(path.to)]);
        const group = grouped.get(clusterKey) ?? [];
        group.push(path);
        grouped.set(clusterKey, group);
      }
      for (const group of grouped.values()) {
        group.sort((a, b) => a.hops.length - b.hops.length || a.from.localeCompare(b.from) || a.to.localeCompare(b.to));
        const path = group[0]!;
        const leftSymbol = leftSymbols.get(path.from)!;
        const rightSymbol = rightSymbols.get(path.to)!;
        const leftKeys = leftClusters.get(path.from)!;
        const rightKeys = rightClusters.get(path.to)!;
        const id = hash(JSON.stringify([actorKey(leftSet.actor), leftKeys.length === 1 ? leftKeys[0] : leftKeys, actorKey(rightSet.actor), rightKeys.length === 1 ? rightKeys[0] : rightKeys]));
        const previous = this.pairs.get(id);
        const fingerprint = hash(JSON.stringify(leftKeys.length === 1 && rightKeys.length === 1 ? [
          { key: leftSymbol.key, before: hash(leftSymbol.before), after: hash(leftSymbol.after) },
          { key: rightSymbol.key, before: hash(rightSymbol.before), after: hash(rightSymbol.after) },
          path
        ] : [
          leftKeys.map((key) => ({ key, before: hash(leftSymbols.get(key)!.before), after: hash(leftSymbols.get(key)!.after) })),
          rightKeys.map((key) => ({ key, before: hash(rightSymbols.get(key)!.before), after: hash(rightSymbols.get(key)!.after) })),
          group
        ]));
        const changed = this.fingerprints.get(id) !== fingerprint;
        const at = this.options.now();
        const pair: CandidatePair = { id, left: { actor: leftSet.actor, symbol: path.from, symbols: leftKeys, status: leftSymbol.status }, right: { actor: rightSet.actor, symbol: path.to, symbols: rightKeys, status: rightSymbol.status }, relations: group.map((relation) => ({ left: relation.from, right: relation.to, path: relation.hops.length ? relation : null })), distance: path.hops.length as 0 | 1 | 2, path: path.hops.length === 0 ? null : path, firstSeenAt: previous?.firstSeenAt ?? at, updatedAt: changed ? at : previous!.updatedAt, revisionKey: fingerprint };
        nextPairs.set(id, pair);
        for (const [set, keys] of [[leftSet, leftKeys], [rightSet, rightKeys]] as const) for (const key of keys) {
          const file = key.slice(0, key.indexOf("#"));
          const change = set.files.get(file)!;
          const identity = JSON.stringify([actorKey(set.actor), generation(change)]);
          const related = this.relatedSymbols.get(identity) ?? new Set<string>();
          related.add(key);
          this.relatedSymbols.set(identity, related);
        }
        this.fingerprints.set(id, fingerprint);
        if (!previous || changed) this.emit({ type: previous ? "pair_candidate_updated" : "pair_candidate_opened", pair });
      }
    }
    for (const [id, pair] of this.pairs) if (!nextPairs.has(id)) {
      this.fingerprints.delete(id);
      this.emit({ type: "pair_candidate_closed", pair: { ...pair, updatedAt: this.options.now() } });
    }
    this.pairs = nextPairs;
    for (const [id, unit] of this.units) {
      const related = this.relatedSymbols.get(JSON.stringify([unit.actor, unit.generation]));
      if (unit.symbols.some((key) => related?.has(key))) this.relatedUnits.add(id);
    }
    return this.getActiveChangeSets();
  }

  private clusters(set: ActiveChangeSet, symbols: Map<string, SymbolChange>) {
    const parents = new Map([...symbols.keys()].map((key) => [key, key]));
    const root = (key: string): string => { const parent = parents.get(key)!; return parent === key ? key : root(parent); };
    for (const change of set.files.values()) {
      const known = [...this.units.values()].filter((unit) => unit.actor === actorKey(set.actor) && unit.file === change.file && unit.generation === generation(change));
      const batches = known.length ? known.map((unit) => unit.symbols) : [(change.symbols ?? []).map((symbol) => symbol.key)];
      for (const batch of batches) {
        const keys = [...new Set(batch.filter((key) => symbols.has(key)))].sort();
        for (let position = 0; position < keys.length; position += 1) for (const other of keys.slice(position + 1)) {
          const key = keys[position]!;
          if (!isNestedPair(key, other) && !this.options.index.findPaths([key], [other], 1).length) continue;
          parents.set(root(other), root(key));
        }
      }
    }
    const groups = new Map<string, string[]>();
    for (const key of symbols.keys()) { const id = root(key); const group = groups.get(id) ?? []; group.push(key); groups.set(id, group); }
    return new Map([...symbols.keys()].map((key) => [key, groups.get(root(key))!.sort()]));
  }

  captureStaleEdges(changeSets = this.changeSets) {
    for (const changeSet of changeSets) for (const change of changeSet.files.values()) {
      const baselineSymbols = isSemanticFile(change.file) ? parseSymbols(change.file, change.baseText) : [];
      const activeSymbols = [...(change.symbols ?? []), ...baselineSymbols];
      for (const symbol of activeSymbols) for (const edge of [...this.options.index.outgoing(symbol.key), ...this.options.index.incoming(symbol.key)]) {
        this.staleEdges.set(`${edge.from}:${edge.to}:${edge.kind}`, { ...edge, stale: true });
      }
    }
  }

  findPaths(fromKeys: string[], toKeys: string[], maxHops: number) {
    const paths = this.options.index.findPaths(fromKeys, toKeys, maxHops);
    const targets = new Set(toKeys);
    const outgoing = (key: string) => [...this.options.index.outgoing(key), ...[...this.staleEdges.values()].filter((edge) => edge.from === key)];
    const incoming = (key: string) => [...this.options.index.incoming(key), ...[...this.staleEdges.values()].filter((edge) => edge.to === key)];
    for (const from of [...new Set(fromKeys)]) {
      const queue: RelationPath[] = [{ from, to: from, hops: [], typeOnly: true }];
      const visited = new Set([`${from}:true`]);
      for (let cursor = 0; cursor < queue.length; cursor += 1) {
        const path = queue[cursor]!;
        if (targets.has(path.to) && path.hops.length > 0) paths.push(path);
        if (path.hops.length >= maxHops) continue;
        const neighbors = [
          ...outgoing(path.to).filter((edge) => edge.kind !== "contains").map((edge) => ({ from: path.to, to: edge.to, kind: edge.kind, direction: "forward" as const })),
          ...incoming(path.to).filter((edge) => edge.kind !== "contains").map((edge) => ({ from: path.to, to: edge.from, kind: edge.kind, direction: "backward" as const }))
        ];
        for (const hop of neighbors) {
          const typeOnly = path.typeOnly && hop.kind === "type-reference";
          const visitKey = `${hop.to}:${typeOnly}`;
          if (visited.has(visitKey)) continue;
          visited.add(visitKey);
          queue.push({ from, to: hop.to, hops: [...path.hops, hop], typeOnly });
        }
      }
    }
    const changedTypes = new Set(this.changeSets.flatMap((set) => [...set.files.values()].flatMap((change) => (change.symbols ?? []).filter((symbol) => ["interface", "type", "enum"].includes(symbol.kind)).map((symbol) => symbol.key))));
    return paths.filter((path) => !path.typeOnly || [path.from, path.to, ...path.hops.flatMap((hop) => [hop.from, hop.to])].some((key) => changedTypes.has(key)));
  }

  getActiveChangeSets() { return this.changeSets; }
  getCandidatePairs() { return [...this.pairs.values()].sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id)); }
  statistics(actor?: ActorRef | string): ChangeUnitStatistics {
    const key = typeof actor === "string" ? actor : actor ? actorKey(actor) : undefined;
    const units = [...this.units].filter(([, unit]) => !key || unit.actor === key);
    const total = units.length;
    const related = units.filter(([id]) => this.relatedUnits.has(id)).length;
    const typeOnly = [...this.pairs.values()].filter((pair) => pair.path?.typeOnly === true).length;
    return { total, related, unrelated: total - related, unrelatedRatio: total === 0 ? 0 : (total - related) / total, typeOnly };
  }
  statisticsByActor() {
    return Object.fromEntries([...new Set([...this.units.values()].map((unit) => unit.actor))].sort().map((key) => [key, this.statistics(key)]));
  }
  onEvent(listener: (event: SemanticChangeEvent) => void) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  private emit(event: SemanticChangeEvent) { for (const listener of this.listeners) listener(event); }
}

function actorKey(actor: ActorRef) { return actor.kind === "human" ? `human:${actor.memberId}` : actor.kind === "agent" ? `agent:${actor.runId}` : actor.kind; }
function hash(text: string) { return createHash("sha256").update(text).digest("hex"); }
function symbolsByKey(changeSet: ActiveChangeSet) { return new Map([...changeSet.files.values()].flatMap((file) => file.symbols ?? []).map((symbol) => [symbol.key, symbol])); }
function generation(change: FileChange) { return hash(JSON.stringify([change.file, change.firstTouchedAt, change.baseText])); }

function isNestedPair(left: string, right: string) {
  const leftParts = left.split("#");
  const rightParts = right.split("#");
  if (leftParts[0] !== rightParts[0]) return false;
  const leftPath = leftParts[1] ?? "";
  const rightPath = rightParts[1] ?? "";
  return leftPath.startsWith(`${rightPath}.`) || rightPath.startsWith(`${leftPath}.`);
}
