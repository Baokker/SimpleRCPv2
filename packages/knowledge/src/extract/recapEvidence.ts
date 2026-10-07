import ts from "typescript";
import { applyPatch, parsePatch } from "diff";
import { minimatch } from "minimatch";

export interface RecapFileVersions { file: string; beforeText: string; afterText: string }

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
