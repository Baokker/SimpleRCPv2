import type { TextEditOp, TrackedRange } from "../model/types.js";

export function transformRanges(ranges: TrackedRange[], ops: TextEditOp[]) {
  return mergeRanges(ranges.map((range) => {
    let current = { ...range };
    let offset = 0;
    for (const op of ops) {
      const from = op.from + offset;
      current = transformRange(current, from, op.deleted.length, op.inserted.length);
      offset += op.inserted.length - op.deleted.length;
    }
    return current;
  }));
}

export function transformEditRanges(ranges: TrackedRange[], ops: TextEditOp[]) {
  const replacements: TextEditOp[] = [];
  for (const op of ops) {
    const previous = replacements.at(-1);
    if (previous && op.from === previous.from + previous.deleted.length) {
      previous.deleted += op.deleted;
      previous.inserted += op.inserted;
    } else replacements.push({ ...op });
  }
  return transformRanges(ranges, replacements);
}

function transformRange(range: TrackedRange, from: number, deletedLength: number, insertedLength: number): TrackedRange {
  const to = from + deletedLength;
  const delta = insertedLength - deletedLength;
  if (deletedLength === 0) {
    if (from <= range.start) return { start: range.start + insertedLength, end: range.end + insertedLength };
    if (from < range.end) return { start: range.start, end: range.end + insertedLength };
    return range;
  }
  if (to <= range.start) return { start: range.start + delta, end: range.end + delta };
  if (from >= range.end) return range;
  const start = range.start < from ? range.start : from;
  const end = range.end > to ? range.end + delta : from + insertedLength;
  return { start, end: Math.max(start, end) };
}

export function mergeRanges(ranges: TrackedRange[]) {
  return ranges
    .sort((left, right) => left.start - right.start)
    .reduce<TrackedRange[]>((merged, range) => {
      const previous = merged.at(-1);
      if (previous && range.start <= previous.end) previous.end = Math.max(previous.end, range.end);
      else merged.push({ ...range });
      return merged;
    }, []);
}
