import * as ts from "typescript";
import type { PairSide, FourStateInput, FourStateResult } from "./classifier.js";

export interface TypecheckFileProvider {
  listFiles(): string[];
  readFile(file: string): string;
  version?(file: string): string | number;
  readLib?(name: string): string;
}

export function createFourStateTypeChecker(options: { files: TypecheckFileProvider; now(): number; timeoutMs?: number }) {
  const files = () => options.files.listFiles().filter((file) => /\.(?:ts|tsx|js|jsx|mts|cts)$/i.test(file));
  const versions = new Map<string, string>();
  let projectVersion = 0;
  const snapshots = new Map<string, ts.IScriptSnapshot>();
  const overrides = new Map<string, string>();
  const host: ts.LanguageServiceHost = {
    getCompilationSettings: () => ({ allowJs: true, checkJs: true, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler, lib: ["lib.es2022.d.ts"], types: [], skipLibCheck: true }),
    getScriptFileNames: () => files().map((file) => `/${file}`),
    getScriptVersion: (file) => String(versions.get(file.replace(/^\//, "")) ?? 0),
    getProjectVersion: () => String(projectVersion),
    getScriptSnapshot: (file) => {
      const name = file.replace(/^\//, "");
      if (name.startsWith("lib.") || name === "lib.d.ts") {
        const text = options.files.readLib?.(name);
        return text === undefined ? undefined : ts.ScriptSnapshot.fromString(text);
      }
      if (!files().includes(name)) return undefined;
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
    fileExists: (file) => file.startsWith("/lib.") || files().includes(file.replace(/^\//, "")),
    readFile: (file) => file.startsWith("/lib.") ? options.files.readLib?.(file.replace(/^\//, "")) : files().includes(file.replace(/^\//, "")) ? options.files.readFile(file.replace(/^\//, "")) : undefined,
    directoryExists: () => true,
    useCaseSensitiveFileNames: () => true
  };
  const service = ts.createLanguageService(host);

  return (input: FourStateInput): FourStateResult => {
    const started = options.now();
    const timeout = options.timeoutMs ?? 500;
    const affected = new Set([input.left.symbol.file, input.right.symbol.file]);
    for (const hop of input.path?.hops ?? []) { affected.add(hop.from.slice(0, hop.from.indexOf("#"))); affected.add(hop.to.slice(0, hop.to.indexOf("#"))); }
    const original = new Map<string, string>();
    for (const file of affected) original.set(file, options.files.readFile(file));
    const states = [
      { name: "baseline", left: input.left.symbol.before, right: input.right.symbol.before },
      { name: "leftOnly", left: input.left.symbol.after, right: input.right.symbol.before },
      { name: "rightOnly", left: input.left.symbol.before, right: input.right.symbol.after },
      { name: "merged", left: input.left.symbol.after, right: input.right.symbol.after }
    ];
    const diagnostics = new Map<string, Set<string>>();
    try {
      for (const state of states) {
        const replacements = new Map<string, Array<{ start: number; end: number; text: string }>>();
        const usedPositions = new Map<string, number>();
        for (const side of [input.left, input.right]) {
          const file = side.symbol.file;
          const source = original.get(file);
          if (source === undefined) continue;
          const start = locateSymbolText(source, side.symbol.before, usedPositions, file, side.symbol.startLine);
          const end = side.symbol.before ? start + side.symbol.before.length : start;
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
        }
        projectVersion += 1;
        const keys = new Set<string>();
        for (const file of affected) {
          const result = service.getSemanticDiagnostics(`/${file}`);
          for (const diagnostic of result) if (diagnostic.category === ts.DiagnosticCategory.Error) keys.add(`${file}:${diagnostic.code}:${ts.flattenDiagnosticMessageText(diagnostic.messageText, " ")}`);
        }
        diagnostics.set(state.name, keys);
        if (options.now() - started > timeout) return { ran: false, skipped: `超过 ${timeout} ms`, durationMs: options.now() - started };
      }
    } finally {
      for (const file of affected) { overrides.delete(file); snapshots.delete(file); }
      projectVersion += 1;
    }
    const merged = diagnostics.get("merged") ?? new Set<string>();
    const baseline = diagnostics.get("baseline") ?? new Set<string>();
    const leftOnly = diagnostics.get("leftOnly") ?? new Set<string>();
    const rightOnly = diagnostics.get("rightOnly") ?? new Set<string>();
    const mergeOnlyDiagnostics = [...merged].filter((diagnostic) => !baseline.has(diagnostic) && !leftOnly.has(diagnostic) && !rightOnly.has(diagnostic));
    return { ran: true, durationMs: options.now() - started, mergeOnlyDiagnostics };
  };
}

export const checkFourStates = createFourStateTypeChecker;

function locateSymbolText(source: string, text: string, used: Map<string, number>, file: string, startLine: number) {
  if (!text) {
    const lines = source.split("\n");
    return lines.slice(0, Math.max(0, startLine - 1)).reduce((offset, line) => offset + line.length + 1, 0);
  }
  const from = used.get(file) ?? 0;
  const found = source.indexOf(text, from);
  const position = found >= 0 ? found : source.indexOf(text);
  used.set(file, Math.max(from, position + text.length));
  return position >= 0 ? position : 0;
}
