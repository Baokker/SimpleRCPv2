import type { EventRecord } from "./types.ts";
import { count } from "./logic.ts";
export function summary(events: EventRecord[]): Record<string, number> { return Object.fromEntries([...new Set(events.map((event) => event.name))].map((name) => [name, count(events, name)])); }
