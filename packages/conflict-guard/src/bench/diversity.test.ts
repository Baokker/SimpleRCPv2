import { expect, it } from "vitest";
import { normalizedTokens, tokenSimilarity, inspectSeedDiversity } from "./diversity.js";

it("recognizes renamed source clones through TypeScript token sequences", () => {
  const original = normalizedTokens("a.ts", "export function price(value: number){ return value * 2; }");
  const renamed = normalizedTokens("b.ts", "export function distance(length: number){ return length * 2; }");
  expect(tokenSimilarity(original, renamed)).toBe(1);
  expect(tokenSimilarity(original, normalizedTokens("c.ts", "class Queue { private waiting = new Set<string>(); add(id: string) { this.waiting.add(id); } }"))).toBeLessThan(0.6);
  expect(inspectSeedDiversity([{ name: "a", files: { "src/a.ts": "export const value = 1;" } }, { name: "b", files: { "src/b.ts": "export const size = 1;" } }])).toMatchObject({ valid: false, maximumObserved: 1 });
});
