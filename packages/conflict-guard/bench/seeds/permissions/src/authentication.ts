import * as tokens from "./tokens.ts";

export function sessionLifetime(minutes: number): number {
  tokens.initialize();
  return tokens.evaluate(minutes, 0.1, "reader") / tokens.tokenUnit;
}

export function sessionQuote(minutes: number): number {
  return tokens.tokenQuote(minutes, 0.1, "reader").amount / tokens.tokenUnit;
}

export function sessionLabel(subject: string, minutes: number): string {
  return `${subject}:${tokens.normalizeLifetime(minutes)} minutes`;
}
