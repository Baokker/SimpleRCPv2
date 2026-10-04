import { createHash } from "node:crypto";
import type { ActiveChangeSet, ActorRef, EditBatch, FileChange } from "../model/types.js";
import type { SemanticIndex, RelationPath } from "../semantic/types.js";
import { mapSymbolChanges, type SymbolChange } from "../semantic/changes.js";
import { isSemanticFile } from "../semantic/index.js";

export interface CandidatePair {
  id: string;
  left: { actor: ActorRef; symbol: string; status: SymbolChange["status"] };
  right: { actor: ActorRef; symbol: string; status: SymbolChange["status"] };
  distance: 0 | 1 | 2;
  path: RelationPath | null;
  firstSeenAt: number;
  updatedAt: number;
}

export interface ChangeUnitStatistics { total: number; related: number; unrelated: number; unrelatedRatio: number }

export type SemanticChangeEvent =
  | { type: "change_unit"; actor: ActorRef; batchId: string; symbols: Array<{ key: string; file: string; status: SymbolChange["status"]; beforeHash: string; afterHash: string }> }
  | { type: "pair_candidate_opened" | "pair_candidate_updated" | "pair_candidate_closed"; pair: CandidatePair };

export class SemanticChangeTracker {
  private changeSets: ActiveChangeSet[] = [];
  private pairs = new Map<string, CandidatePair>();
  private readonly fingerprints = new Map<string, string>();
  private readonly units = new Map<string, { actor: string; file: string; generation: string; symbols: string[] }>();
  private readonly relatedUnits = new Set<string>();
  private readonly listeners = new Set<(event: SemanticChangeEvent) => void>();

  constructor(private readonly options: { index: SemanticIndex; readFile(file: string): string; now(): number }) {}

  update(changeSets: ActiveChangeSet[], batches: Array<{ batch: EditBatch; change?: FileChange }> = []) {
    this.changeSets = changeSets;
    for (const changeSet of this.changeSets) for (const change of changeSet.files.values()) change.symbols = isSemanticFile(change.file) ? mapSymbolChanges(change, this.options.readFile(change.file), this.options.index) : [];
    for (const { batch, change } of batches) {
      if (batch.actor.kind !== "human" || !isSemanticFile(batch.file)) continue;
      const changeSet = this.changeSets.find((set) => actorKey(set.actor) === actorKey(batch.actor));
      const fileChange = change ?? changeSet?.files.get(batch.file);
      const symbols = fileChange ? mapSymbolChanges(fileChange, this.options.readFile(fileChange.file), this.options.index) : [];
      if (symbols.length === 0) continue;
      this.emit({ type: "change_unit", actor: batch.actor, batchId: batch.id, symbols: symbols.map((symbol) => ({ key: symbol.key, file: symbol.file, status: symbol.status, beforeHash: hash(symbol.before), afterHash: hash(symbol.after) })) });
      this.units.set(JSON.stringify([actorKey(batch.actor), batch.id]), { actor: actorKey(batch.actor), file: batch.file, generation: generation(fileChange!), symbols: symbols.map((symbol) => symbol.key) });
    }
    const active = this.changeSets.filter((set) => set.actor.kind === "human" && set.status !== "closed").sort((a, b) => actorKey(a.actor).localeCompare(actorKey(b.actor)));
    const nextPairs = new Map<string, CandidatePair>();
    for (let leftIndex = 0; leftIndex < active.length; leftIndex += 1) for (const rightSet of active.slice(leftIndex + 1)) {
      const leftSet = active[leftIndex]!;
      const leftSymbols = symbolsByKey(leftSet);
      const rightSymbols = symbolsByKey(rightSet);
      for (const path of this.options.index.findPaths([...leftSymbols.keys()], [...rightSymbols.keys()], 2)) {
        const leftSymbol = leftSymbols.get(path.from)!;
        const rightSymbol = rightSymbols.get(path.to)!;
        const id = hash(JSON.stringify([actorKey(leftSet.actor), path.from, actorKey(rightSet.actor), path.to]));
        const previous = this.pairs.get(id);
        const fingerprint = hash(JSON.stringify([leftSymbol, rightSymbol, path]));
        const changed = this.fingerprints.get(id) !== fingerprint;
        const at = this.options.now();
        const pair: CandidatePair = { id, left: { actor: leftSet.actor, symbol: path.from, status: leftSymbol.status }, right: { actor: rightSet.actor, symbol: path.to, status: rightSymbol.status }, distance: path.hops.length as 0 | 1 | 2, path: path.hops.length === 0 ? null : path, firstSeenAt: previous?.firstSeenAt ?? at, updatedAt: changed ? at : previous!.updatedAt };
        nextPairs.set(id, pair);
        this.fingerprints.set(id, fingerprint);
        if (!previous || changed) this.emit({ type: previous ? "pair_candidate_updated" : "pair_candidate_opened", pair });
      }
    }
    for (const [id, pair] of this.pairs) if (!nextPairs.has(id)) {
      this.fingerprints.delete(id);
      this.emit({ type: "pair_candidate_closed", pair: { ...pair, updatedAt: this.options.now() } });
    }
    this.pairs = nextPairs;
    const activeByActor = new Map(active.map((set) => [actorKey(set.actor), set]));
    for (const [id, unit] of this.units) {
      const change = activeByActor.get(unit.actor)?.files.get(unit.file);
      if (!change || generation(change) !== unit.generation) continue;
      if ([...this.pairs.values()].some((pair) => [pair.left, pair.right].some((side) => actorKey(side.actor) === unit.actor && unit.symbols.includes(side.symbol)))) this.relatedUnits.add(id);
    }
    return this.getActiveChangeSets();
  }

  getActiveChangeSets() { return this.changeSets; }
  getCandidatePairs() { return [...this.pairs.values()].sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id)); }
  statistics(): ChangeUnitStatistics {
    const total = this.units.size;
    const related = this.relatedUnits.size;
    return { total, related, unrelated: total - related, unrelatedRatio: total === 0 ? 0 : (total - related) / total };
  }
  onEvent(listener: (event: SemanticChangeEvent) => void) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  private emit(event: SemanticChangeEvent) { for (const listener of this.listeners) listener(event); }
}

function actorKey(actor: ActorRef) { return actor.kind === "human" ? `human:${actor.memberId}` : actor.kind === "agent" ? `agent:${actor.runId}` : actor.kind; }
function hash(text: string) { return createHash("sha256").update(text).digest("hex"); }
function symbolsByKey(changeSet: ActiveChangeSet) { return new Map([...changeSet.files.values()].flatMap((file) => file.symbols ?? []).map((symbol) => [symbol.key, symbol])); }
function generation(change: FileChange) { return hash(JSON.stringify([change.file, change.firstTouchedAt, change.baseText])); }
