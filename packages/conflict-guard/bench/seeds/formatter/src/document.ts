import * as layout from "./layout.ts";

export function documentWidth(columns: number): number {
  layout.initialize();
  return layout.evaluate(columns, 0.1, "plain") / layout.widthUnit;
}

export function documentQuote(columns: number): number {
  return layout.layoutQuote(columns, 0.1, "plain").amount / layout.widthUnit;
}

export function documentLabel(name: string, columns: number): string {
  return `${name}:${layout.normalizeColumns(columns)} columns`;
}
