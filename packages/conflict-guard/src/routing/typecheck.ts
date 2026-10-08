import * as ts from "typescript";
import type { PairSide, FourStateInput, FourStateResult } from "./classifier.js";
import { collectSymbols, parseSymbols } from "../semantic/symbols.js";
import { textDiffOps } from "../tracking/textDiff.js";
import type { TextEditOp } from "../model/types.js";

export interface TypecheckFileProvider {
  listFiles(): string[];
  readFile(file: string): string;
  version?(file: string): string | number;
  readLib?(name: string): string;
}

export function createFourStateTypeChecker(options: { files: TypecheckFileProvider; now(): number; timeoutMs?: number }) {
  let fileNames: string[] = [];
  let knownFiles = new Set<string>();
  const files = () => fileNames;
  const versions = new Map<string, string>();
  let projectVersion = 0;
  const snapshots = new Map<string, ts.IScriptSnapshot>();
  const overrides = new Map<string, string>();
  const host: ts.LanguageServiceHost = {
    getCompilationSettings: () => ({ allowJs: true, checkJs: true, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler, lib: ["lib.es2022.d.ts"], types: [], skipLibCheck: true }),
    getScriptFileNames: () => files().map((file) => `/${file}`),
    getScriptVersion: (file) => {
      const name = file.replace(/^\//, "");
      if (!knownFiles.has(name)) return "0";
      return overrides.has(name) ? `override:${projectVersion}` : String(options.files.version?.(name) ?? 0);
    },
    getProjectVersion: () => String(projectVersion),
    getScriptSnapshot: (file) => {
      const name = file.replace(/^\//, "");
      if (name.startsWith("lib.") || name === "lib.d.ts") {
        const text = options.files.readLib?.(name);
        return text === undefined ? undefined : ts.ScriptSnapshot.fromString(text);
      }
      if (!knownFiles.has(name)) return undefined;
      const version = overrides.has(name) ? `override:${projectVersion}` : String(options.files.version?.(name) ?? 0);
      const previous = snapshots.get(name);
      if (previous && versions.get(name) === version) return previous;
      const snapshot = ts.ScriptSnapshot.fromString(overrides.get(name) ?? options.files.readFile(name));
      snapshots.set(name, snapshot);
      versions.set(name, version);
      return snapshot;
    },
    getCurrentDirectory: () => "/",
    getDefaultLibFileName: () => "/lib.es2022.d.ts",
    fileExists: (file) => file.startsWith("/lib.") || knownFiles.has(file.replace(/^\//, "")),
    readFile: (file) => file.startsWith("/lib.") ? options.files.readLib?.(file.replace(/^\//, "")) : knownFiles.has(file.replace(/^\//, "")) ? options.files.readFile(file.replace(/^\//, "")) : undefined,
    directoryExists: () => true,
    useCaseSensitiveFileNames: () => true
  };
  const service = ts.createLanguageService(host);

  return (input: FourStateInput): FourStateResult => {
    const started = options.now();
    fileNames = options.files.listFiles().filter((file) => /\.(?:ts|tsx|js|jsx|mts|cts|mjs|cjs)$/i.test(file));
    knownFiles = new Set(fileNames);
    const timeout = options.timeoutMs ?? 500;
    const affected = new Set([input.left.symbol.file, input.right.symbol.file]);
    for (const hop of input.path?.hops ?? []) { affected.add(hop.from.slice(0, hop.from.indexOf("#"))); affected.add(hop.to.slice(0, hop.to.indexOf("#"))); }
    const original = new Map<string, string>();
    for (const file of affected) original.set(file, options.files.readFile(file));
    const locations = new Map<PairSide, { start: number; end: number }>();
    for (const side of [input.left, input.right]) {
      const source = original.get(side.symbol.file)!;
      const current = parseSymbols(side.symbol.file, source).find((symbol) => symbol.key === side.symbol.key);
      if (current) locations.set(side, { start: current.start, end: current.end });
      else if (side.symbol.status === "deleted") {
        const start = source.split("\n").slice(0, Math.max(0, side.symbol.startLine - 1)).reduce((offset, line) => offset + line.length + 1, 0);
        locations.set(side, { start: Math.min(source.length, start), end: Math.min(source.length, start) });
      } else return { ran: false, skipped: `无法定位当前符号 ${side.symbol.key}`, durationMs: options.now() - started };
    }
    const sameSymbol = input.left.symbol.key === input.right.symbol.key && input.left.symbol.file === input.right.symbol.file;
    const sharedStates = sameSymbol ? sameSymbolStates(input) : undefined;
    if (sameSymbol && !sharedStates) return { ran: false, skipped: "无法组合同一声明的修改范围", durationMs: options.now() - started };
    const states = sharedStates ?? [
      { name: "baseline", left: input.left.symbol.before, right: input.right.symbol.before },
      { name: "leftOnly", left: input.left.symbol.after, right: input.right.symbol.before },
      { name: "rightOnly", left: input.left.symbol.before, right: input.right.symbol.after },
      { name: "merged", left: input.left.symbol.after, right: input.right.symbol.after }
    ];
    const diagnostics = new Map<string, Set<string>>();
    const returnTypes = new Map<string, string>();
    try {
      for (const state of states) {
        const replacements = new Map<string, Array<{ start: number; end: number; text: string }>>();
        for (const side of [input.left, input.right]) {
          if (sameSymbol && side === input.right) continue;
          const file = side.symbol.file;
          const source = original.get(file);
          if (source === undefined) continue;
          const { start, end } = locations.get(side)!;
          const text = side === input.left ? state.left : state.right;
          const entries = replacements.get(file) ?? [];
          entries.push({ start, end, text });
          replacements.set(file, entries);
        }
        for (const [file, entries] of replacements) {
          let text = original.get(file)!;
          for (const entry of entries.sort((a, b) => b.start - a.start)) text = text.slice(0, entry.start) + entry.text + text.slice(entry.end);
          overrides.set(file, text);
          snapshots.delete(file);
          versions.set(file, `override:${projectVersion + 1}`);
        }
        projectVersion += 1;
        const keys = new Set<string>();
        for (const file of affected) {
          const result = service.getSemanticDiagnostics(`/${file}`);
          for (const diagnostic of result) if (diagnostic.category === ts.DiagnosticCategory.Error) keys.add(`${file}:${diagnostic.code}:${ts.flattenDiagnosticMessageText(diagnostic.messageText, " ")}`);
        }
        diagnostics.set(state.name, keys);
        if (sameSymbol) {
          const program = service.getProgram();
          const source = program?.getSourceFile(`/${input.left.symbol.file}`);
          const node = source ? collectSymbols(source, input.left.symbol.file).find((symbol) => symbol.key === input.left.symbol.key)?.node : undefined;
          const declaration = node && (ts.isVariableDeclaration(node) || ts.isPropertyDeclaration(node)) ? node.initializer : node;
          if (program && declaration && ts.isFunctionLike(declaration)) {
            const checker = program.getTypeChecker();
            const signature = checker.getSignatureFromDeclaration(declaration);
            if (signature) returnTypes.set(state.name, checker.typeToString(checker.getReturnTypeOfSignature(signature), declaration, ts.TypeFormatFlags.NoTruncation));
          }
        }
        if (options.now() - started > timeout) return { ran: false, skipped: `超过 ${timeout} ms`, durationMs: options.now() - started };
      }
    } finally {
      for (const file of affected) { overrides.delete(file); snapshots.delete(file); versions.set(file, String(options.files.version?.(file) ?? 0)); }
      projectVersion += 1;
    }
    const merged = diagnostics.get("merged") ?? new Set<string>();
    const baseline = diagnostics.get("baseline") ?? new Set<string>();
    const leftOnly = diagnostics.get("leftOnly") ?? new Set<string>();
    const rightOnly = diagnostics.get("rightOnly") ?? new Set<string>();
    const mergeOnlyDiagnostics = [...merged].filter((diagnostic) => !baseline.has(diagnostic) && !leftOnly.has(diagnostic) && !rightOnly.has(diagnostic));
    const baselineReturn = returnTypes.get("baseline");
    return { ran: true, durationMs: options.now() - started, mergeOnlyDiagnostics, ...(baselineReturn !== undefined ? { inferredReturnTypeChanged: { left: returnTypes.get("leftOnly") !== baselineReturn, right: returnTypes.get("rightOnly") !== baselineReturn } } : {}) };
  };
}

function sameSymbolStates(input: FourStateInput) {
  const left = input.left.symbol;
  const right = input.right.symbol;
  if (left.before === right.before) {
    const merged = combineIndependentEdits(left.before, left.after, right.after);
    if (merged === undefined) return undefined;
    return [
      { name: "baseline", left: left.before, right: left.before },
      { name: "leftOnly", left: left.after, right: left.after },
      { name: "rightOnly", left: right.after, right: right.after },
      { name: "merged", left: merged, right: merged }
    ];
  }
  if (left.after === right.after) {
    const baseline = combineIndependentEdits(left.after, left.before, right.before);
    if (baseline === undefined) return undefined;
    return [
      { name: "baseline", left: baseline, right: baseline },
      { name: "leftOnly", left: right.before, right: right.before },
      { name: "rightOnly", left: left.before, right: left.before },
      { name: "merged", left: left.after, right: left.after }
    ];
  }
  if (left.before === right.after) {
    const leftOnly = combineIndependentEdits(left.before, left.after, right.before);
    if (leftOnly === undefined) return undefined;
    return [
      { name: "baseline", left: right.before, right: right.before },
      { name: "leftOnly", left: leftOnly, right: leftOnly },
      { name: "rightOnly", left: right.after, right: right.after },
      { name: "merged", left: left.after, right: left.after }
    ];
  }
  if (right.before === left.after) {
    const rightOnly = combineIndependentEdits(right.before, right.after, left.before);
    if (rightOnly === undefined) return undefined;
    return [
      { name: "baseline", left: left.before, right: left.before },
      { name: "leftOnly", left: left.after, right: left.after },
      { name: "rightOnly", left: rightOnly, right: rightOnly },
      { name: "merged", left: right.after, right: right.after }
    ];
  }
  return undefined;
}

function combineIndependentEdits(before: string, left: string, right: string): string | undefined {
  const replacements = (after: string) => {
    const ops: TextEditOp[] = [];
    for (const op of textDiffOps(before, after)) {
      const previous = ops.at(-1);
      if (previous && op.from === previous.from + previous.deleted.length) {
        previous.deleted += op.deleted;
        previous.inserted += op.inserted;
      } else ops.push({ ...op });
    }
    return ops;
  };
  const leftOps = replacements(left);
  const rightOps = replacements(right);
  if (leftOps.some((a) => rightOps.some((b) => a.from <= b.from + b.deleted.length && b.from <= a.from + a.deleted.length))) return undefined;
  return [...leftOps, ...rightOps].sort((a, b) => b.from - a.from).reduce((text, op) => text.slice(0, op.from) + op.inserted + text.slice(op.from + op.deleted.length), before);
}

export const checkFourStates = createFourStateTypeChecker;
