import type { CaptureEditOp } from "./events.js";

export interface AuthorshipInterval {
  actor: string;
  start: number;
  end: number;
  at: number;
  text: string;
  groupId: string;
  originalText: string;
}

export interface OverwrittenInterval extends AuthorshipInterval {
  deletedText: string;
  deletedChars: number;
  ratio: number;
}

export class AuthorshipIndex {
  private readonly intervals = new Map<string, AuthorshipInterval[]>();
  private sequence = 0;
  constructor(private readonly maxAgeMs = 30 * 60_000) {}

  apply(file: string, actor: string, operations: CaptureEditOp[], at: number): OverwrittenInterval[] {
    const current = (this.intervals.get(file) ?? []).filter(interval => at - interval.at <= this.maxAgeMs);
    const deleted = new Map<string, OverwrittenInterval>();
    const groupSizes = new Map<string, number>();
    for (const interval of current) groupSizes.set(interval.groupId, (groupSizes.get(interval.groupId) ?? 0) + interval.end - interval.start);
    for (const op of operations) {
      for (const interval of current) {
        if (!isMemberActor(actor) || !isMemberActor(interval.actor) || interval.actor === actor) continue;
        const start = Math.max(op.start, interval.start);
        const end = Math.min(op.start + op.deleteCount, interval.end);
        if (end <= start) continue;
        const previous = deleted.get(interval.groupId);
        const text = interval.text.slice(start - interval.start, end - interval.start);
        const deletedChars = (previous?.deletedChars ?? 0) + end - start;
        deleted.set(interval.groupId, { ...interval, deletedText: (previous?.deletedText ?? "") + text, deletedChars, ratio: deletedChars / groupSizes.get(interval.groupId)! });
      }
    }
    for (const op of [...operations].sort((a, b) => b.start - a.start)) {
      transformIntervals(current, op);
      if (op.insertText && isMemberActor(actor)) current.push({ actor, start: op.start, end: op.start + op.insertText.length, at, text: op.insertText, originalText: op.insertText, groupId: `${at}:${++this.sequence}` });
    }
    this.intervals.set(file, current.sort((a, b) => a.start - b.start));
    return [...deleted.values()];
  }

  get(file: string, at?: number) {
    return (this.intervals.get(file) ?? []).filter(interval => at === undefined || at - interval.at <= this.maxAgeMs).map(interval => ({ ...interval }));
  }
  retire(file: string) { this.intervals.delete(file); }
}

export function isMemberActor(actor: string) { return actor !== "filesystem" && actor !== "unknown"; }

export function transformIntervals(intervals: AuthorshipInterval[], op: CaptureEditOp) {
  const transformed: AuthorshipInterval[] = [];
  const deletionEnd = op.start + op.deleteCount;
  const shift = op.insertText.length - op.deleteCount;
  for (const interval of intervals) {
    if (interval.end <= op.start) { transformed.push(interval); continue; }
    if (interval.start >= deletionEnd) { transformed.push({ ...interval, start: interval.start + shift, end: interval.end + shift }); continue; }
    if (interval.start < op.start) transformed.push({ ...interval, end: op.start, text: interval.text.slice(0, op.start - interval.start) });
    if (interval.end > deletionEnd) transformed.push({ ...interval, start: op.start + op.insertText.length, end: interval.end + shift, text: interval.text.slice(deletionEnd - interval.start) });
  }
  intervals.splice(0, intervals.length, ...transformed);
}
