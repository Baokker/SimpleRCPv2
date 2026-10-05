import type { EventRecord } from "./types.ts";
export function dispatch(events: EventRecord[], name: string): unknown[] { return events.filter((event) => event.name === name).map((event) => event.payload); }
export function count(events: EventRecord[], name: string): number { return dispatch(events, name).length; }
