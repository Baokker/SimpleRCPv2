import type { CalendarEntry } from "./types.ts";
export function overlaps(left: CalendarEntry, right: CalendarEntry): boolean { return left.start < right.end && right.start < left.end; }
export function duration(entry: CalendarEntry): number { if (entry.end < entry.start) throw new RangeError("time range"); return entry.end - entry.start; }
