import { serverEn } from "./langEn.js";

// Translate Chinese text produced by the knowledge module. The Chinese source is
// the key; with KNOWLEDGE_LANG=en the English entry is used, otherwise the
// Chinese text is returned unchanged, so experiments keep their original output.
export function knowledgeLanguage(): "zh" | "en" {
  return process.env.KNOWLEDGE_LANG === "en" ? "en" : "zh";
}

export function L(source: string, ...values: unknown[]): string {
  const text = knowledgeLanguage() === "en" ? serverEn[source] ?? source : source;
  return text.replace(/\{(\d+)\}/g, (_, index: string) => String(values[Number(index)] ?? ""));
}
