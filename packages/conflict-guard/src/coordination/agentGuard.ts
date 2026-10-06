import diff from "fast-diff";
import { diffLines } from "diff";
import { createHash } from "node:crypto";
import type { ActiveChangeSet, ActorRef, FileChange } from "../model/types.js";
import { createSemanticIndex, isSemanticFile } from "../semantic/index.js";
import type { SemanticFileProvider } from "../semantic/types.js";
import { innermostSymbols, parseSymbols } from "../semantic/symbols.js";
import { SemanticChangeTracker } from "../routing/candidates.js";
import { classify, type Decision, type ZoneInput, type ZoneVerdict } from "../routing/classifier.js";
import { createPairCoordinator, type PairEvent, type PairRecord } from "./pairState.js";

export interface AgentTextProposal { file: string; before: string; after: string; deleted?: boolean; existedBefore?: boolean }

export async function evaluateAgentChanges(options: {
  actor: Extract<ActorRef, { kind: "agent" }>;
  proposals: AgentTextProposal[];
  active: ActiveChangeSet[];
  files: SemanticFileProvider;
  mergeShared?: boolean;
  currentView?: boolean;
  changedSymbols?: ReadonlyMap<string, ReadonlySet<string>>;
  now(): number;
  signal: AbortSignal;
  adjudicate?(input: ZoneInput, local: ZoneVerdict, signal: AbortSignal): Promise<ZoneVerdict>;
  onEvent?(event: PairEvent & { symbols: Array<{ key: string; beforeHash: string; afterHash: string }> }): void;
  onError?(error: unknown): void;
}) {
  const proposals = options.proposals.map((proposal) => options.mergeShared ? mergeAgentProposal(proposal, options.files.readFile(proposal.file)) : proposal);
  const overlay = new Map(proposals.filter((proposal) => isSemanticFile(proposal.file)).map((proposal) => [proposal.file, proposal.before]));
  const files: SemanticFileProvider = { ...options.files, listFiles: () => [...new Set([...options.files.listFiles(), ...overlay.keys()])], readFile: (file) => overlay.get(file) ?? options.files.readFile(file), version: (file) => overlay.has(file) ? `proposal:${hash(overlay.get(file)!)}` : options.files.version(file) };
  const index = createSemanticIndex({ files, now: options.now });
  index.update();
  const semantic = new SemanticChangeTracker({ index, readFile: files.readFile, now: options.now });
  const own: ActiveChangeSet = { actor: options.actor, status: "settled", files: new Map(proposals.map((proposal) => [proposal.file, proposalFileChange(proposal, options.now())])) };
  semantic.captureStaleEdges([...options.active, own]);
  for (const proposal of proposals) if (isSemanticFile(proposal.file)) overlay.set(proposal.file, options.currentView ? options.files.readFile(proposal.file) : proposal.after);
  index.update();
  if (options.currentView) for (const proposal of proposals) {
    const before = new Map(parseSymbols(proposal.file, proposal.before).map((symbol) => [symbol.key, proposal.before.slice(symbol.start, symbol.end)]));
    const allowed = options.changedSymbols?.get(proposal.file);
    const keys = new Set(parseSymbols(proposal.file, proposal.after).filter((symbol) => (!allowed || allowed.has(symbol.key)) && before.get(symbol.key) !== proposal.after.slice(symbol.start, symbol.end)).map((symbol) => symbol.key));
    const change = own.files.get(proposal.file)!;
    change.ranges = index.symbolsInFile(proposal.file).filter((symbol) => keys.has(symbol.key)).map((symbol) => ({ start: symbol.start, end: symbol.end }));
    if (allowed) change.deletedSymbolKeys = change.deletedSymbolKeys?.filter((key) => allowed.has(key));
    for (const symbol of parseSymbols(proposal.file, proposal.before)) if (change.deletedSymbolKeys?.includes(symbol.key)) change.ranges.push({ start: symbol.start, end: symbol.end });
  }
  const active = options.active.filter((set) => actorKey(set.actor) !== actorKey(options.actor)).map((set) => ({ ...set, files: new Map([...set.files].map(([file, change]) => [file, { ...change, ranges: change.ranges.map((range) => ({ ...range })) }])) }));
  semantic.update([...active, own]);
  const records: PairRecord[] = [];
  for (const pair of semantic.getCandidatePairs().filter((pair) => [pair.left.actor, pair.right.actor].some((actor) => actorKey(actor) === actorKey(options.actor)))) {
    const side = (target: typeof pair.left) => ({ actor: target.actor, symbol: semantic.getActiveChangeSets().find((set) => actorKey(set.actor) === actorKey(target.actor))!.files.get(target.symbol.slice(0, target.symbol.indexOf("#")))!.symbols!.find((symbol) => symbol.key === target.symbol)! });
    const input: ZoneInput = { left: side(pair.left), right: side(pair.right), path: pair.path, nested: pair.distance === 0 && pair.left.symbol !== pair.right.symbol, typeOnly: Boolean(pair.path?.typeOnly), project: index };
    const unavailable: ZoneVerdict = { zone: "grey", decision: "lock", ruleId: "agent-analysis-unavailable", summary: "Agent 修改暂未通过检查，请稍后重试。", evidence: [], contractChanged: { left: false, right: false } };
    let finish!: () => void;
    const done = new Promise<void>((resolve) => { finish = resolve; });
    const coordinator = createPairCoordinator({ now: options.now, classify: () => {
      try { return classify(input); }
      catch (error) { options.onError?.(error); return unavailable; }
    }, ...(options.adjudicate ? { adjudicate(_pair, local, signal, complete) {
      const combined = AbortSignal.any([signal, options.signal]);
      const abort = () => complete(unavailable);
      combined.addEventListener("abort", abort, { once: true });
      if (combined.aborted) { abort(); return; }
      try {
        void options.adjudicate!(input, local, combined).then((result) => complete(result.adjudication?.status === "degraded" ? { ...result, decision: "lock", summary: "Agent 研判未完成，请稍后重试。" } : result), (error) => { options.onError?.(error); complete(unavailable); }).finally(() => combined.removeEventListener("abort", abort));
      } catch (error) { combined.removeEventListener("abort", abort); options.onError?.(error); complete(unavailable); }
    } } : {}) });
    coordinator.onEvent((event) => {
      if (event.type === "pair_judged") finish();
      try { options.onEvent?.({ ...event, symbols: [input.left.symbol, input.right.symbol].map((symbol) => ({ key: symbol.key, beforeHash: hash(symbol.before), afterHash: hash(symbol.after) })) }); }
      catch (error) { options.onError?.(error); }
    });
    coordinator.update([pair]);
    await done;
    records.push(coordinator.get(pair.id)!);
    coordinator.dispose();
    if (options.signal.aborted) break;
  }
  const decision: Decision = options.signal.aborted || records.some((record) => record.verdict?.decision === "lock") ? "lock" : records.some((record) => record.verdict?.decision === "warn") ? "warn" : "allow";
  return { decision, records, changeSet: own };
}

export function proposalFileChange(proposal: AgentTextProposal, at: number): FileChange {
  const currentKeys = new Set(parseSymbols(proposal.file, proposal.after).map((symbol) => symbol.key));
  return { file: proposal.file, baseText: proposal.before, ranges: [{ start: 0, end: Math.max(proposal.before.length, proposal.after.length) }], firstTouchedAt: at, lastTouchedAt: at, deletedSymbolKeys: parseSymbols(proposal.file, proposal.before).filter((symbol) => !currentKeys.has(symbol.key)).map((symbol) => symbol.key) };
}

export function proposalSymbolKeys(proposal: AgentTextProposal): Set<string> {
  const baseline = parseSymbols(proposal.file, proposal.before);
  const before = new Map(baseline.map((symbol) => [symbol.key, proposal.before.slice(symbol.start, symbol.end)]));
  const current = parseSymbols(proposal.file, proposal.after);
  const currentKeys = new Set(current.map((symbol) => symbol.key));
  const changed = current.filter((symbol) => before.get(symbol.key) !== proposal.after.slice(symbol.start, symbol.end));
  const deleted = baseline.filter((symbol) => !currentKeys.has(symbol.key));
  return new Set([
    ...current.filter((symbol) => !before.has(symbol.key)).map((symbol) => symbol.key),
    ...innermostSymbols(changed, 0, proposal.after.length).map((symbol) => symbol.key),
    ...deleted.map((symbol) => symbol.key)
  ]);
}

export function selectAgentReverts(baseline: string, agent: string, current: string) {
  const blocks: Array<{ from: number; before: string; after: string }> = [];
  let agentPosition = 0;
  let block: (typeof blocks)[number] | undefined;
  for (const { added, removed, value } of diffLines(baseline, agent)) {
    if (!added && !removed) { block = undefined; agentPosition += value.length; continue; }
    if (!block) { block = { from: agentPosition, before: "", after: "" }; blocks.push(block); }
    if (removed) block.before += value;
    else { block.after += value; agentPosition += value.length; }
  }
  const lineBlocks = blocks.flatMap((change) => {
    const before = change.before.match(/[^\n]*\n|[^\n]+$/g) ?? [];
    const after = change.after.match(/[^\n]*\n|[^\n]+$/g) ?? [];
    if (before.length !== after.length) return [change];
    let from = change.from;
    return after.map((text, index) => { const result = { from, before: before[index]!, after: text }; from += text.length; return result; });
  });
  const intervening: Array<{ from: number; length: number; inserted: number }> = [];
  let position = 0;
  for (const [operation, value] of diff(agent, current)) {
    if (operation === diff.EQUAL) position += value.length;
    else if (operation === diff.DELETE) { intervening.push({ from: position, length: value.length, inserted: 0 }); position += value.length; }
    else intervening.push({ from: position, length: 0, inserted: value.length });
  }
  const reverted: Array<{ from: number; beforeHash: string; afterHash: string }> = [];
  const skipped: Array<{ from: number; reason: string }> = [];
  const edits: Array<{ from: number; deleted: string; inserted: string }> = [];
  for (const change of lineBlocks) {
    const end = change.from + change.after.length;
    const touched = intervening.some((edit) => edit.length > 0 ? edit.from < end && edit.from + edit.length > change.from || change.after.length === 0 && edit.from <= change.from && edit.from + edit.length >= change.from : edit.from > change.from && edit.from < end || change.after.length === 0 && edit.from === change.from);
    const shift = intervening.filter((edit) => edit.from + edit.length <= change.from).reduce((total, edit) => total + edit.inserted - edit.length, 0);
    const from = change.from + shift;
    if (touched || current.slice(from, from + change.after.length) !== change.after) { skipped.push({ from, reason: "其他参与者已修改此处，需要人工处理。" }); continue; }
    edits.push({ from, deleted: change.after, inserted: change.before });
    reverted.push({ from, beforeHash: hash(change.before), afterHash: hash(change.after) });
  }
  let text = current;
  for (const edit of [...edits].sort((left, right) => right.from - left.from)) text = text.slice(0, edit.from) + edit.inserted + text.slice(edit.from + edit.deleted.length);
  return { text, edits, reverted, skipped };
}

export function mergeAgentProposal(proposal: AgentTextProposal, current: string): AgentTextProposal {
  const edits = textEdits(proposal.before, proposal.after);
  const shared = textEdits(proposal.before, current);
  let text = current;
  for (const edit of [...edits].reverse()) {
    const end = edit.from + edit.deleted.length;
    const overlaps = shared.some((other) => {
      const otherEnd = other.from + other.deleted.length;
      if (!edit.deleted.length && !other.deleted.length) return edit.from === other.from;
      if (!edit.deleted.length) return edit.from >= other.from && edit.from <= otherEnd;
      if (!other.deleted.length) return other.from > edit.from && other.from < end;
      return edit.from < otherEnd && other.from < end;
    });
    if (overlaps) throw new Error(`Shared text changed inside the proposed edit in ${proposal.file}; reread and retry.`);
    const shift = shared.filter((other) => other.from + other.deleted.length <= edit.from).reduce((total, other) => total + other.inserted.length - other.deleted.length, 0);
    const from = edit.from + shift;
    if (text.slice(from, from + edit.deleted.length) !== edit.deleted) throw new Error(`Shared text no longer matches the proposal in ${proposal.file}; reread and retry.`);
    text = text.slice(0, from) + edit.inserted + text.slice(from + edit.deleted.length);
  }
  return { ...proposal, before: current, after: text };
}

function textEdits(before: string, after: string) {
  const edits: Array<{ from: number; deleted: string; inserted: string }> = [];
  let position = 0;
  let pending: (typeof edits)[number] | undefined;
  for (const [operation, value] of diff(before, after)) {
    if (operation === diff.EQUAL) { position += value.length; pending = undefined; continue; }
    if (!pending) { pending = { from: position, deleted: "", inserted: "" }; edits.push(pending); }
    if (operation === diff.DELETE) { pending.deleted += value; position += value.length; }
    else pending.inserted += value;
  }
  return edits;
}

function hash(text: string) { return createHash("sha256").update(text).digest("hex"); }
function actorKey(actor: ActorRef) { return actor.kind === "human" ? `human:${actor.memberId}` : actor.kind === "agent" ? `agent:${actor.runId}` : actor.kind; }
