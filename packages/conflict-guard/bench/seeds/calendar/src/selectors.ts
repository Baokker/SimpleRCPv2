import type { CalendarEntry } from "./types.ts";
import { overlaps } from "./logic.ts";
export function conflicts(entries: CalendarEntry[], proposal: CalendarEntry): CalendarEntry[] { return entries.filter((entry) => overlaps(entry, proposal)); }
