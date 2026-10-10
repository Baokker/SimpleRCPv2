import ts from "typescript";
import { applyPatch, parsePatch, diffLines } from "diff";
import { minimatch } from "minimatch";

export interface RecapFileVersions { file: string; beforeText: string; afterText: string }

export function compactRecapEvidence(evidence: Record<string, unknown>, budget = 800): Record<string, unknown> {
  if (!Number.isInteger(budget) || budget < 2) throw new Error("Recap evidence budget must be at least two characters");
  const identifiers = correctedIdentifiers(evidence);
  const bindings = correctedSymbolBindings(evidence);
  const versions = new Map(recapFileVersions(evidence).map(version => [version.file, version]));
  const compact = (value: unknown, key: string): unknown => {
    if (Array.isArray(value)) return value.map(item => compact(item, key));
    if (value && typeof value === "object") {
      const source = value as Record<string, unknown>;
      const version = typeof source.file === "string" ? versions.get(source.file) : undefined;
      if (version && source.beforeText === version.beforeText && source.afterText === version.afterText) {
        const excerpts = changedFunctionExcerpts(version, budget);
        return {...source, ...excerpts};
      }
      return Object.fromEntries(Object.entries(source).filter(([name]) => name !== "symbolSources").map(([name, item]) => [name, compact(item, name)]));
    }
    if (typeof value !== "string" || value.length <= budget) return value;
    if (/diff/iu.test(key)) {
      const changes = parsePatch(value).flatMap(patch => patch.hunks.map(hunk => `${patch.newFileName ?? patch.oldFileName}:${hunk.newStart}\n${hunk.lines.filter(line => line.startsWith("+") || line.startsWith("-")).join("\n")}`));
      if (changes.length) {
        const separatorChars = changes.length - 1;
        const perChange = Math.max(0, Math.floor((budget - separatorChars) / changes.length));
        return changes.map(change => change.slice(0, perChange)).join("\n").slice(0, budget);
      }
    }
    return /diff|code|text|replacement/iu.test(key) ? value.slice(0, budget) : value;
  };
  return {...compact(evidence, "evidence") as Record<string, unknown>, correctedIdentifierCandidates: identifiers, correctedBindings: bindings};
}

export function changedFunctionExcerpts(version: RecapFileVersions, budget = 800) {
  if (version.beforeText.length + version.afterText.length <= budget) return {beforeText: version.beforeText, afterText: version.afterText};
  let beforeOffset = 0, afterOffset = 0;
  const beforeChanges: number[] = [], afterChanges: number[] = [];
  for (const change of diffLines(version.beforeText, version.afterText)) {
    if (change.added || change.removed) {beforeChanges.push(beforeOffset); afterChanges.push(afterOffset);}
    if (!change.added) beforeOffset += change.value.length;
    if (!change.removed) afterOffset += change.value.length;
  }
  const excerpt = (text: string, offsets: number[], limit: number) => {
    const source = ts.createSourceFile(version.file, text, ts.ScriptTarget.Latest, true);
    const spans: Array<{start: number; end: number}> = [];
    const visit = (node: ts.Node) => {
      if ((ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node) || ts.isArrowFunction(node)) && offsets.some(offset => offset >= node.getFullStart() && offset <= node.end)) spans.push({start: node.getFullStart(), end: node.end});
      ts.forEachChild(node, visit);
    };
    visit(source);
    const offset = offsets[0] ?? 0;
    const selected = spans.filter(span => offset >= span.start && offset <= span.end).sort((a, b) => a.end - a.start - (b.end - b.start))[0];
    const earliest = Math.max(0, (selected?.start ?? offset) - 80);
    const start = Math.max(earliest, Math.min(text.length - limit, offset - Math.floor(limit / 3)));
    const end = Math.min(text.length, selected ? selected.end + 80 : start + limit);
    return {text: text.slice(start, Math.min(end, start + limit)), startLine: source.getLineAndCharacterOfPosition(start).line + 1, truncated: true};
  };
  const before = excerpt(version.beforeText, beforeChanges, Math.floor(budget / 2));
  const after = excerpt(version.afterText, afterChanges, budget - before.text.length);
  return {beforeText: before.text, afterText: after.text, excerpt: {beforeStartLine: before.startLine, afterStartLine: after.startLine, truncated: true, budget}};
}

export function recapFileVersions(evidence: Record<string, unknown>): RecapFileVersions[] {
  const explicit = Array.isArray(evidence.correctionFiles) ? evidence.correctionFiles : [];
  const versions = explicit.filter((item): item is RecapFileVersions => Boolean(item && typeof item === "object" && typeof item.file === "string" && typeof item.beforeText === "string" && typeof item.afterText === "string"));
  if (typeof evidence.previousDiff === "string" && typeof evidence.correctedDiff === "string") {
    const original = new Map(parsePatch(evidence.previousDiff).filter(patch => patch.oldFileName === "/dev/null").map(patch => [patch.newFileName?.replace(/^[ab]\//u, ""), applyPatch("", patch)]));
    for (const patch of parsePatch(evidence.correctedDiff).filter(patch => patch.oldFileName === "/dev/null")) {
      const file = patch.newFileName?.replace(/^[ab]\//u, ""), beforeText = original.get(file), afterText = applyPatch("", patch);
      if (file && typeof beforeText === "string" && typeof afterText === "string" && !versions.some(version => version.file === file)) versions.push({file, beforeText, afterText});
    }
  }
  return versions;
}

export function correctedSymbolBindings(evidence: Record<string, unknown>): Array<{expression: string; identifier: string}> {
  if (Array.isArray(evidence.correctedBindings)) return evidence.correctedBindings as Array<{expression: string; identifier: string}>;
  const bindings = new Map<string, {expression: string; identifier: string}>();
  const changedFiles = new Set(recapFileVersions(evidence).map(version => `/evidence/${version.file}`));
  const sources = evidence.symbolSources && typeof evidence.symbolSources === "object" ? Object.entries(evidence.symbolSources).filter((entry): entry is [string, string] => typeof entry[1] === "string") : [];
  if (sources.length) {
    const sourceMap = new Map(sources.map(([file, content]) => [`/evidence/${file}`, content]));
    const options: ts.CompilerOptions = {noLib: true, allowImportingTsExtensions: true, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler};
    const host = ts.createCompilerHost(options);
    host.fileExists = file => sourceMap.has(file);
    host.readFile = file => sourceMap.get(file);
    host.directoryExists = directory => [...sourceMap.keys()].some(file => file.startsWith(`${directory}/`));
    host.getSourceFile = (file, languageVersion) => sourceMap.has(file) ? ts.createSourceFile(file, sourceMap.get(file)!, languageVersion, true) : undefined;
    const program = ts.createProgram([...sourceMap.keys()], options, host), checker = program.getTypeChecker();
    for (const source of program.getSourceFiles()) {
      if (!changedFiles.has(source.fileName)) continue;
      const visit = (node: ts.Node) => {
        if (ts.isPropertyAccessExpression(node)) {
          const owner = checker.getTypeAtLocation(node.expression).getSymbol()?.getName();
          if (owner && !owner.startsWith("__")) {
            const expression = node.getText(source), identifier = `${owner}.${node.name.text}`;
            bindings.set(`${expression}:${identifier}`, {expression, identifier});
          }
        }
        ts.forEachChild(node, visit);
      };
      visit(source);
    }
  }
  return [...bindings.values()].sort((a, b) => a.expression.localeCompare(b.expression) || a.identifier.localeCompare(b.identifier));
}

export function correctedIdentifiers(evidence: Record<string, unknown>): string[] {
  if (Array.isArray(evidence.correctedIdentifierCandidates)) return evidence.correctedIdentifierCandidates.filter((item): item is string => typeof item === "string");
  const candidates = new Set(correctedSymbolBindings(evidence).map(binding => binding.identifier));
  const texts: string[] = recapFileVersions(evidence).flatMap(version => [version.beforeText, version.afterText]);
  const visitEvidence = (value: unknown, key: string) => {
    if (typeof value === "string" && /diff|text|replacement|code/iu.test(key)) {
      const patches = value.includes("@@") ? parsePatch(value) : [];
      texts.push(...(patches.length ? patches.flatMap(patch => patch.hunks.flatMap(hunk => hunk.lines.filter(line => line.startsWith("+") || line.startsWith("-")).map(line => line.slice(1)))) : [value]));
    } else if (value && typeof value === "object") for (const [name, item] of Object.entries(value)) visitEvidence(item, name);
  };
  visitEvidence(evidence, "evidence");
  for (const text of texts) {
    const source = ts.createSourceFile("evidence.ts", text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const visit = (node: ts.Node) => {
      if (ts.isPropertyAccessExpression(node)) candidates.add(node.getText(source));
      if ((ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node) || ts.isClassDeclaration(node) || ts.isPropertyDeclaration(node)) && node.name) candidates.add(node.name.getText(source));
      if (ts.isImportSpecifier(node)) candidates.add(node.name.text);
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return [...candidates].filter(value => /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*$/u.test(value)).sort().slice(0, 100);
}

export function validateRecapCheck(check: {kind: "regex-absent" | "regex-present"; pattern: string; fileGlob: string}, evidence: Record<string, unknown>) {
  const files = recapFileVersions(evidence).filter(version => minimatch(version.file, check.fileGlob, {dot: true}));
  let pattern: RegExp;
  try { pattern = new RegExp(check.pattern); } catch { return {offered: true, retained: false, files: files.map(file => file.file), reason: "invalid-pattern"}; }
  const passed = (text: string) => check.kind === "regex-present" ? pattern.test(text) : !pattern.test(text);
  const retained = files.length > 0 && files.some(file => !passed(file.beforeText)) && files.every(file => passed(file.afterText));
  return {offered: true, retained, files: files.map(file => file.file), reason: retained ? "verified-before-and-after" : files.length ? "does-not-distinguish-correction" : "complete-file-versions-unavailable"};
}
