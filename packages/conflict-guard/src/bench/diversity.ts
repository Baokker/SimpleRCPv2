import * as ts from "typescript";
import { diffArrays } from "diff";
import type { SeedProject } from "./types.js";

export function normalizedTokens(file: string, text: string) {
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, true, file.endsWith(".tsx") ? ts.LanguageVariant.JSX : ts.LanguageVariant.Standard, text);
  const tokens: string[] = [];
  for (let kind = scanner.scan(); kind !== ts.SyntaxKind.EndOfFileToken; kind = scanner.scan()) tokens.push(kind === ts.SyntaxKind.Identifier ? "identifier" : `${kind}:${scanner.getTokenText()}`);
  return tokens;
}

export function tokenSimilarity(left: string[], right: string[]) {
  if (!left.length && !right.length) return 1;
  const equal = diffArrays(left, right).filter((part) => !part.added && !part.removed).reduce((sum, part) => sum + part.value.length, 0);
  return 2 * equal / (left.length + right.length);
}

export function inspectSeedDiversity(projects: SeedProject[], maximum = 0.6) {
  const sizes = projects.map((project) => ({ project: project.name, files: Object.keys(project.files).length, lines: Object.values(project.files).reduce((sum, text) => sum + text.split("\n").filter((line) => line.trim()).length, 0) }));
  const files = projects.flatMap((project) => Object.entries(project.files).filter(([file]) => /\.[cm]?[jt]sx?$/.test(file)).map(([file, text]) => ({ project: project.name, file, tokens: normalizedTokens(file, text) })));
  const comparisons: Array<{ left: string; right: string; similarity: number }> = [];
  for (let index = 0; index < files.length; index += 1) for (const right of files.slice(index + 1)) {
    const left = files[index]!;
    if (left.project === right.project) continue;
    comparisons.push({ left: `${left.project}/${left.file}`, right: `${right.project}/${right.file}`, similarity: tokenSimilarity(left.tokens, right.tokens) });
  }
  comparisons.sort((a, b) => b.similarity - a.similarity || a.left.localeCompare(b.left) || a.right.localeCompare(b.right));
  return { valid: projects.length >= 8 && sizes.every((size) => size.files >= 5 && size.lines >= 300) && comparisons.every((pair) => pair.similarity <= maximum), method: "TypeScript scanner; identifier normalization; token sequence LCS Dice", maximum, projectCount: projects.length, sizes, maximumObserved: comparisons[0]?.similarity ?? 0, violations: comparisons.filter((pair) => pair.similarity > maximum), comparisons };
}
