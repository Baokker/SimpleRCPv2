import { parseActor, type CaptureEditOp, type CaptureActorKind } from "./events.js";

export interface AuthorshipInterval {
  actor: string;
  ownerId?: string;
  start: number;
  end: number;
  at: number;
  text: string;
  groupId: string;
  originalText: string;
  originalOffset: number;
  sourceId: string;
  groupLength: number;
  groupLineCount: number;
}

export interface OverwrittenInterval extends AuthorshipInterval {
  deletedText: string;
  deletedChars: number;
  ratio: number;
  actorKind: CaptureActorKind;
  runId?: string;
  deletedLineIds: string[];
}

export class AuthorshipIndex {
  private readonly intervals = new Map<string, AuthorshipInterval[]>();
  private readonly deletedByGroup = new Map<string, number>();
  private readonly deletedLinesByGroup = new Map<string, Set<string>>();
  private sequence = 0;
  constructor(private readonly maxAgeMs = 30 * 60_000) {}

  apply(file: string, actor: string, operations: CaptureEditOp[], at: number): OverwrittenInterval[] {
    const current = (this.intervals.get(file) ?? []).filter(interval => at - interval.at <= this.maxAgeMs);
    const editor = parseActor(actor);
    const deleted = new Map<string, OverwrittenInterval>();
    const groupSizes = new Map<string, number>();
    for (const interval of current) {
      const target = parseActor(interval.actor);
      groupSizes.set(interval.groupId, target.kind === "agent" ? interval.groupLength : (groupSizes.get(interval.groupId) ?? 0) + interval.end - interval.start);
    }
    const activeGroups = new Set([...this.intervals.values()].flatMap(intervals => intervals.filter(interval => at - interval.at <= this.maxAgeMs).map(interval => interval.groupId)));
    for (const groupId of this.deletedByGroup.keys()) if (!activeGroups.has(groupId)) {
      this.deletedByGroup.delete(groupId);
      this.deletedLinesByGroup.delete(groupId);
    }
    for (const op of operations) {
      for (const interval of current) {
        const target = parseActor(interval.actor);
        if (editor.kind !== "member" || (target.kind !== "member" && target.kind !== "agent") || interval.actor === actor) continue;
        const start = Math.max(op.start, interval.start);
        const end = Math.min(op.start + op.deleteCount, interval.end);
        if (end <= start) continue;
        const previous = deleted.get(interval.groupId);
        const text = interval.text.slice(start - interval.start, end - interval.start);
        const targetKind = parseActor(interval.actor).kind;
        const originalStart = interval.originalOffset + start - interval.start;
        const originalEnd = interval.originalOffset + end - interval.start;
        const firstLine = interval.originalText.slice(0, originalStart).split("\n").length - 1;
        const lastLine = interval.originalText.slice(0, originalEnd - 1).split("\n").length - 1;
        const deletedLineIds = Array.from({ length: lastLine - firstLine + 1 }, (_, index) => `${interval.sourceId}:${firstLine + index}`);
        const allDeletedLineIds = this.deletedLinesByGroup.get(interval.groupId) ?? new Set<string>();
        for (const lineId of deletedLineIds) allDeletedLineIds.add(lineId);
        this.deletedLinesByGroup.set(interval.groupId, allDeletedLineIds);
        const deletedChars = targetKind === "agent" ? (this.deletedByGroup.get(interval.groupId) ?? 0) + end - start : (previous?.deletedChars ?? 0) + end - start;
        if (targetKind === "agent") this.deletedByGroup.set(interval.groupId, deletedChars);
        deleted.set(interval.groupId, {
          ...interval,
          deletedText: (previous?.deletedText ?? "") + text,
          deletedChars,
          ratio: deletedChars / Math.max(1, groupSizes.get(interval.groupId) ?? interval.groupLength),
          actorKind: target.kind,
          runId: target.runId,
          deletedLineIds: [...allDeletedLineIds]
        });
      }
    }
    for (const op of [...operations].sort((a, b) => b.start - a.start)) {
      transformIntervals(current, op);
      if (op.insertText && (editor.kind === "member" || editor.kind === "agent")) {
        const groupId = `${at}:${++this.sequence}`;
        this.deletedByGroup.set(groupId, 0);
        this.deletedLinesByGroup.set(groupId, new Set());
        current.push({ actor, start: op.start, end: op.start + op.insertText.length, at, text: op.insertText, originalText: op.insertText, originalOffset: 0, sourceId: groupId, groupId, groupLength: op.insertText.length, groupLineCount: countAuthorshipLines(op.insertText) });
      }
    }
    this.intervals.set(file, current.sort((a, b) => a.start - b.start));
    return [...deleted.values()];
  }

  register(file: string, actor: string, ranges: Array<{ start: number; end: number; text: string; ownerId?: string }>, at: number) {
    const parsed = parseActor(actor);
    if (parsed.kind !== "member" && parsed.kind !== "agent") return;
    const current = (this.intervals.get(file) ?? []).filter(interval => at - interval.at <= this.maxAgeMs);
    const groupId = `${at}:${++this.sequence}`;
    const groupLength = ranges.reduce((total, range) => total + range.text.length, 0);
    const groupLineCount = ranges.reduce((total, range) => total + countAuthorshipLines(range.text), 0);
    this.deletedByGroup.set(groupId, 0);
    this.deletedLinesByGroup.set(groupId, new Set());
    for (const [index, range] of ranges.entries()) {
      if (!Number.isInteger(range.start) || !Number.isInteger(range.end) || range.start < 0 || range.end <= range.start || range.end - range.start !== range.text.length) throw new Error("Authorship range is invalid");
      current.push({ actor, ownerId: range.ownerId, start: range.start, end: range.end, at, text: range.text, originalText: range.text, originalOffset: 0, sourceId: `${groupId}:${index}`, groupId, groupLength, groupLineCount });
    }
    this.intervals.set(file, current.sort((a, b) => a.start - b.start));
  }

  get(file: string, at?: number) {
    return (this.intervals.get(file) ?? []).filter(interval => at === undefined || at - interval.at <= this.maxAgeMs).map(interval => ({ ...interval }));
  }
  retire(file: string) {
    const groups = new Set((this.intervals.get(file) ?? []).map((interval) => interval.groupId));
    this.intervals.delete(file);
    for (const groupId of groups) {
      this.deletedByGroup.delete(groupId);
      this.deletedLinesByGroup.delete(groupId);
    }
  }
}

export function isMemberActor(actor: string) { return parseActor(actor).kind === "member"; }
function countAuthorshipLines(text: string) { return text ? text.split("\n").length - (text.endsWith("\n") ? 1 : 0) : 0; }

export function transformIntervals(intervals: AuthorshipInterval[], op: CaptureEditOp) {
  const transformed: AuthorshipInterval[] = [];
  const deletionEnd = op.start + op.deleteCount;
  const shift = op.insertText.length - op.deleteCount;
  for (const interval of intervals) {
    if (interval.end <= op.start) { transformed.push(interval); continue; }
    if (interval.start >= deletionEnd) { transformed.push({ ...interval, start: interval.start + shift, end: interval.end + shift }); continue; }
    if (interval.start < op.start) transformed.push({ ...interval, end: op.start, text: interval.text.slice(0, op.start - interval.start) });
    if (interval.end > deletionEnd) transformed.push({ ...interval, start: op.start + op.insertText.length, end: interval.end + shift, text: interval.text.slice(deletionEnd - interval.start), originalOffset: interval.originalOffset + deletionEnd - interval.start });
  }
  intervals.splice(0, intervals.length, ...transformed);
}
