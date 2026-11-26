import { readLocalStorage } from "../localStorage";
import { legacyEn } from "./legacyEn";

// Translate Chinese literals that predate the i18n tables (mainly the knowledge
// interface). The Chinese source is the key, so the Chinese interface is unchanged.
// L() reads the stored locale on every call: text rendered in components follows a
// language switch, while module-level constants keep the locale of the page load.
export function L(source: string, ...values: unknown[]): string {
  const text = readLocalStorage("simplercp.locale") === "en" ? legacyEn[source] ?? source : source;
  return text.replace(/\{(\d+)\}/g, (_, index: string) => String(values[Number(index)] ?? ""));
}

// Locale for dates and times shown next to legacy text.
export function dateLocale(): string {
  return readLocalStorage("simplercp.locale") === "en" ? "en-US" : "zh-CN";
}
