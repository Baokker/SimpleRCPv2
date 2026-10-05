import { format } from "./logic.ts";
export function preview(texts: string[]): string[] { return texts.map((text) => format(text, "short")); }
