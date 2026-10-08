import diff from "fast-diff";
import { diffLines } from "diff";
import { createHash } from "node:crypto";
import * as ts from "typescript";
import type { ActiveChangeSet, ActorRef, FileChange, GuardConflict } from "../model/types.js";
import { createSemanticIndex, isSemanticFile } from "../semantic/index.js";
import type { SemanticFileProvider } from "../semantic/types.js";
import { innermostSymbols, parseSymbols } from "../semantic/symbols.js";
import { semanticEditRanges } from "../semantic/trivia.js";
import { textDiffOps } from "../tracking/textDiff.js";
import { transformEditRanges } from "../tracking/rangeTransform.js";
import { SemanticChangeTracker } from "../routing/candidates.js";
import { classify, type Decision, type ZoneInput, type ZoneVerdict } from "../routing/classifier.js";
import { createPairCoordinator, type PairEvent, type PairRecord } from "./pairState.js";

export interface AgentTextProposal { file: string; before: string; after: string; deleted?: boolean; existedBefore?: boolean }

export function agentInputRevision(proposals: AgentTextProposal[], active: ActiveChangeSet[], current: (file: string) => string) {
  const hash = (text: string) => createHash("sha256").update(text).digest("hex");
  const actorKey = (actor: ActorRef) => actor.kind === "human" ? `human:${actor.memberId}` : actor.kind === "agent" ? `agent:${actor.runId}` : actor.kind;
  const files = [...new Set([...active.flatMap((set) => [...set.files.keys()]), ...proposals.map((proposal) => proposal.file)])].sort();
  return hash(JSON.stringify([
    files.map((file) => [file, hash(current(file))]),
    active.map((set) => [actorKey(set.actor), [...set.files].map(([file, change]) => [file, hash(change.baseText), [...new Set(change.ranges.map((range) => `${range.start}:${range.end}`))].sort()])])
  ]));
}

export function symbolSignature(text: string | undefined) {
  if (!text) return "";
  const read = (source: ts.SourceFile) => {
    let signature: string | undefined;
    const visit = (node: ts.Node) => {
      if (signature) return;
      if ((ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node) || ts.isGetAccessorDeclaration(node) || ts.isSetAccessorDeclaration(node) || ts.isArrowFunction(node)) && node.body) signature = source.text.slice(node.getStart(source), node.body.getStart(source)).trim();
      else ts.forEachChild(node, visit);
    };
    visit(source); return signature;
  };
  const signature = read(ts.createSourceFile("symbol.ts", text, ts.ScriptTarget.Latest, true)) ?? read(ts.createSourceFile("symbol.ts", `class SymbolOwner { ${text} }`, ts.ScriptTarget.Latest, true)) ?? text;
  return signature.replace(/\s+/g, " ").trim().slice(0, 3000);
}

export function createGuardConflict(options: {
  record: PairRecord;
  self: ActorRef;
  otherDisplayName: string;
  otherChange?: { before: string; after: string };
}): GuardConflict | undefined {
  const { record, self, otherChange, otherDisplayName } = options;
  if (!record.verdict) return undefined;
  const own = [record.pair.left, record.pair.right].find((side) => actorKey(side.actor) === actorKey(self));
  const other = [record.pair.left, record.pair.right].find((side) => actorKey(side.actor) !== actorKey(self));
  if (!own || !other) return undefined;
  return {
    pairId: record.pair.id, revision: record.revision, self, other: other.actor,
    otherDisplayName, symbols: { self: own.symbol, other: other.symbol },
    beforeSignature: symbolSignature(otherChange?.before), afterSignature: symbolSignature(otherChange?.after),
    ruleId: record.verdict.ruleId, zone: record.verdict.zone, decision: record.verdict.decision,
    summaryZh: record.verdict.summary.trim(),
    explanationZh: record.verdict.adjudication?.userExplanation?.trim(),
    suggestionZh: record.verdict.adjudication?.suggestedAction?.trim()
  };
}

export async function evaluateAgentChanges(options: {
  actor: Extract<ActorRef, { kind: "agent" }>;
  proposals: AgentTextProposal[];
  active: ActiveChangeSet[];
  files: SemanticFileProvider;
  mergeShared?: boolean;
  bodyUnrelatedMaxAdjacentLines?: number;
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
  const files: SemanticFileProvider = { readLib: options.files.readLib?.bind(options.files), listFiles: () => [...new Set([...options.files.listFiles(), ...overlay.keys()])], readFile: (file) => overlay.get(file) ?? options.files.readFile(file), version: (file) => overlay.has(file) ? `proposal:${hash(overlay.get(file)!)}` : options.files.version(file) };
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
    const change = currentFileChange(own.files.get(proposal.file)!, options.files.readFile(proposal.file));
    const symbols = index.symbolsInFile(proposal.file);
    change.semanticRanges = change.semanticRanges?.filter((range) => innermostSymbols(symbols, range.start, range.end).some((symbol) => keys.has(symbol.key)));
    if (allowed) change.deletedSymbolKeys = change.deletedSymbolKeys?.filter((key) => allowed.has(key));
    own.files.set(proposal.file, change);
  }
  const active = options.active.filter((set) => actorKey(set.actor) !== actorKey(options.actor)).map((set) => ({ ...set, files: new Map([...set.files].map(([file, change]) => [file, { ...change, ranges: change.ranges.map((range) => ({ ...range })) }])) }));
  semantic.update([...active, own]);
  const records: PairRecord[] = [];
  const inputs: ZoneInput[] = [];
  for (const pair of semantic.getCandidatePairs().filter((pair) => [pair.left.actor, pair.right.actor].some((actor) => actorKey(actor) === actorKey(options.actor)))) {
    const side = (target: typeof pair.left) => ({ actor: target.actor, symbol: semantic.getActiveChangeSets().find((set) => actorKey(set.actor) === actorKey(target.actor))!.files.get(target.symbol.slice(0, target.symbol.indexOf("#")))!.symbols!.find((symbol) => symbol.key === target.symbol)! });
    const input: ZoneInput = { left: side(pair.left), right: side(pair.right), path: pair.path, nested: pair.distance === 0 && pair.left.symbol !== pair.right.symbol, typeOnly: Boolean(pair.path?.typeOnly), project: index, bodyUnrelatedMaxAdjacentLines: options.bodyUnrelatedMaxAdjacentLines };
    inputs.push(input);
    const unavailable: ZoneVerdict = { zone: "grey", decision: "lock", ruleId: "agent-analysis-unavailable", summary: "冲突检查暂不可用，请停止修改此文件并向用户报告。", evidence: [], contractChanged: { left: false, right: false } };
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
        void options.adjudicate!(input, local, combined).then((result) => complete(result.adjudication?.status === "degraded" ? { ...result, decision: "lock", summary: "Agent 研判未完成，本次修改未获批准，请停止重复提交同一修改并向用户报告。" } : result), (error) => { options.onError?.(error); complete(unavailable); }).finally(() => combined.removeEventListener("abort", abort));
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
  return { decision, records, inputs, changeSet: own };
}

export function proposalFileChange(proposal: AgentTextProposal, at: number): FileChange {
  const currentKeys = new Set(parseSymbols(proposal.file, proposal.after).map((symbol) => symbol.key));
  const ranges: Array<{ start: number; end: number }> = [];
  let position = 0;
  for (const [operation, text] of diff(proposal.before, proposal.after)) {
    if (operation === diff.EQUAL) position += text.length;
    else if (operation === diff.INSERT) { ranges.push({ start: position, end: position + text.length }); position += text.length; }
    else ranges.push({ start: position, end: position });
  }
  return { file: proposal.file, baseText: proposal.before, proposalText: proposal.after, ranges, semanticRanges: semanticEditRanges({ file: proposal.file, textBefore: proposal.before, textAfter: proposal.after, ops: textDiffOps(proposal.before, proposal.after) }), firstTouchedAt: at, lastTouchedAt: at, deletedSymbolKeys: parseSymbols(proposal.file, proposal.before).filter((symbol) => !currentKeys.has(symbol.key)).map((symbol) => symbol.key) };
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
    if (overlaps) throw new Error(`${proposal.file} 的修改范围内已有其他参与者的编辑，请重新读取后再修改`);
    const shift = shared.filter((other) => other.from + other.deleted.length <= edit.from).reduce((total, other) => total + other.inserted.length - other.deleted.length, 0);
    const from = edit.from + shift;
    if (text.slice(from, from + edit.deleted.length) !== edit.deleted) throw new Error(`${proposal.file} 的共享文本与修改提案不匹配，请重新读取后再修改`);
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

function currentFileChange(change: FileChange, current: string): FileChange {
  const ops = textDiffOps(change.proposalText ?? current, current);
  return { ...change, proposalText: current, ranges: transformEditRanges(change.ranges, ops), semanticRanges: transformEditRanges(change.semanticRanges ?? change.ranges, ops) };
}

export function mergeActiveChanges(sets: ActiveChangeSet[]) {
  const result = new Map<string, ActiveChangeSet>();
  for (const set of sets) {
    const key = actorKey(set.actor);
    const previous = result.get(key);
    if (!previous) { result.set(key, { ...set, files: new Map(set.files), status: "settled" }); continue; }
    for (const [file, change] of set.files) {
      const earlier = previous.files.get(file);
      previous.files.set(file, earlier ? { ...change, baseText: earlier.baseText, ranges: [...earlier.ranges, ...change.ranges], semanticRanges: [...(earlier.semanticRanges ?? earlier.ranges), ...(change.semanticRanges ?? change.ranges)], deletedSymbolKeys: [...new Set([...(earlier.deletedSymbolKeys ?? []), ...(change.deletedSymbolKeys ?? [])])], firstTouchedAt: Math.min(earlier.firstTouchedAt, change.firstTouchedAt), lastTouchedAt: Math.max(earlier.lastTouchedAt, change.lastTouchedAt) } : change);
    }
  }
  return [...result.values()];
}
export function changedAgentDependencies(options: { actor: ActorRef; startedAt: number; baseline: ReadonlyMap<string, string>; history: Array<{ at: number; set: ActiveChangeSet }>; active: ActiveChangeSet[]; now: number; current(file: string): string }): ActiveChangeSet[] {
  return mergeActiveChanges([...options.history, ...options.active.map((set) => ({ at: options.now, set }))].filter((entry) => entry.at >= options.startedAt && actorKey(entry.set.actor) !== actorKey(options.actor)).map((entry) => ({ ...entry.set, files: new Map([...entry.set.files].flatMap(([file, change]) => {
    if (change.lastTouchedAt <= options.startedAt) return [];
    const baseline = options.baseline.get(file) ?? "";
    const beforeSymbols = new Map(parseSymbols(file, baseline).map((symbol) => [symbol.key, baseline.slice(symbol.start, symbol.end)]));
    const keys = new Set((change.symbols ?? []).filter((symbol) => (beforeSymbols.get(symbol.key) ?? "") !== symbol.after).map((symbol) => symbol.key));
    const current = options.current(file);
    const mapped = currentFileChange(change, current);
    const symbols = parseSymbols(file, current);
    const semanticRanges = mapped.semanticRanges!.filter((range) => innermostSymbols(symbols, range.start, range.end).some((symbol) => keys.has(symbol.key)));
    const deletedSymbolKeys = mapped.deletedSymbolKeys?.filter((key) => keys.has(key));
    return semanticRanges.length || deletedSymbolKeys?.length ? [[file, { ...mapped, baseText: baseline, semanticRanges, deletedSymbolKeys }] as const] : [];
  })) })).filter((set) => set.files.size > 0));
}
