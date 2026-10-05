import type { FormatMode } from "./types.ts";
export function normalize(text: string): string { return text.trim().replace(/\s+/g, " "); }
export function format(text: string, mode: FormatMode): string { const value = normalize(text); return mode === "short" ? value.slice(0, 10) : value; }
