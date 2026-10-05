import * as ts from "typescript";
import { collectSymbols, innermostSymbols, symbolInfo, type IndexedSymbol } from "./symbols.js";
import { collectRelations, collectTypeDependencies } from "./relations.js";
import type { RelationEdge, RelationPath, SemanticFileProvider, SemanticIndex } from "./types.js";

export function isSemanticFile(file: string) {
  return /\.(ts|tsx|js|jsx|mts|cts)$/i.test(file) && !file.split("/").some((part) => ["node_modules", ".git", "dist", "build", "coverage"].includes(part));
}

export function createSemanticIndex(options: { files: SemanticFileProvider; now(): number; maxFiles?: number }): SemanticIndex {
  let files: string[] = [];
  let projectVersion = 0;
  let truncated = false;
  const snapshots = new Map<string, { version: string; snapshot: ts.IScriptSnapshot }>();
  const indexedVersions = new Map<string, string>();
  const symbols = new Map<string, IndexedSymbol[]>();
  const edges = new Map<string, RelationEdge[]>();
  const dependencies = new Map<string, Set<string>>();
  const typeDependencies = new Map<string, Set<string>>();
  const compilerOptions: ts.CompilerOptions = { allowJs: true, checkJs: false, noLib: true, skipLibCheck: true, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler, jsx: ts.JsxEmit.Preserve };
  const relative = (file: string) => file.replace(/^\//, "");
  const host: ts.LanguageServiceHost = {
    getCompilationSettings: () => compilerOptions,
    getScriptFileNames: () => files.map((file) => `/${file}`),
    getScriptVersion: (file) => String(options.files.version(relative(file))),
    getProjectVersion: () => String(projectVersion),
    getScriptSnapshot(file) {
      file = relative(file);
      if (!files.includes(file)) return undefined;
      const version = String(options.files.version(file));
      const existing = snapshots.get(file);
      if (existing?.version === version) return existing.snapshot;
      const snapshot = ts.ScriptSnapshot.fromString(options.files.readFile(file));
      snapshots.set(file, { version, snapshot });
      return snapshot;
    },
    getCurrentDirectory: () => "/",
    getDefaultLibFileName: () => "/lib.d.ts",
    fileExists: (file) => files.includes(relative(file)),
    readFile: (file) => files.includes(relative(file)) ? options.files.readFile(relative(file)) : undefined,
    directoryExists: (directory) => files.some((file) => `/${file}`.startsWith(`${directory.replace(/\/$/, "")}/`)),
    useCaseSensitiveFileNames: () => true
  };
  const service = ts.createLanguageService(host);

  function outgoing(key: string) { return [...edges.values()].flat().filter((edge) => edge.from === key); }
  function incoming(key: string) { return [...edges.values()].flat().filter((edge) => edge.to === key); }
  return {
    update(changedFiles) {
      const started = options.now();
      const listed = options.files.listFiles().filter(isSemanticFile).sort();
      const nextFiles = listed.slice(0, options.maxFiles ?? 2_000);
      truncated = listed.length > nextFiles.length;
      const changed = new Set(changedFiles ?? nextFiles);
      for (const file of files) {
        if (!nextFiles.includes(file)) {
          changed.add(file);
          continue;
        }
        const version = String(options.files.version(file));
        if (indexedVersions.get(file) !== version) changed.add(file);
      }
      for (const file of nextFiles) {
        const version = String(options.files.version(file));
        if (indexedVersions.get(file) !== version) changed.add(file);
      }
      for (const file of [...files, ...nextFiles]) if (files.includes(file) !== nextFiles.includes(file)) changed.add(file);
      const affected = new Set(changed);
      for (const [file, fileEdges] of edges) if (fileEdges.some((edge) => changed.has(edge.to.slice(0, edge.to.indexOf("#"))) || edge.via.some((via) => changed.has(via)))) affected.add(file);
      for (const [file, targets] of dependencies) if ([...targets].some((target) => changed.has(target))) affected.add(file);
      for (const [file, targets] of typeDependencies) if ([...targets].some((target) => changed.has(target))) affected.add(file);
      const topologyChanged = files.length !== nextFiles.length || files.some((file, index) => file !== nextFiles[index]);
      files = nextFiles;
      projectVersion += 1;
      if (topologyChanged) service.cleanupSemanticCache();
      for (const file of [...symbols.keys()]) if (!files.includes(file)) { symbols.delete(file); edges.delete(file); snapshots.delete(file); dependencies.delete(file); typeDependencies.delete(file); indexedVersions.delete(file); }
      const program = service.getProgram();
      if (!program) throw new Error("Semantic LanguageService 未生成 Program");
      function moduleTargets(source: ts.SourceFile, exportsOnly = false, visited = new Set<string>()): Set<string> {
        const targets = new Set<string>();
        if (visited.has(source.fileName)) return targets;
        visited.add(source.fileName);
        for (const statement of source.statements) {
          if (!ts.isImportDeclaration(statement) && !ts.isExportDeclaration(statement)) continue;
          if (exportsOnly ? !ts.isExportDeclaration(statement) : !ts.isImportDeclaration(statement)) continue;
          if (!statement.moduleSpecifier || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
          const resolved = ts.resolveModuleName(statement.moduleSpecifier.text, source.fileName, compilerOptions, host).resolvedModule;
          if (!resolved) continue;
          targets.add(relative(resolved.resolvedFileName));
          const target = program!.getSourceFile(resolved.resolvedFileName);
          if (target) {
            // 重导出的模块也影响引用者，普通 import 不继续传播。
            for (const file of moduleTargets(target, true, visited)) targets.add(file);
          }
        }
        return targets;
      }
      for (const file of files) {
        const source = program.getSourceFile(`/${file}`)!;
        const targets = moduleTargets(source);
        dependencies.set(file, targets);
        if ([...targets].some((target) => changed.has(target))) affected.add(file);
      }
      const symbolFiles = topologyChanged ? files : [...affected];
      for (const file of symbolFiles) {
        if (!files.includes(file)) continue;
        const source = program.getSourceFile(`/${file}`);
        if (!source) throw new Error(`Semantic 源文件缺失：${file}`);
        symbols.set(file, collectSymbols(source, file));
      }
      const byNode = new Map([...symbols.values()].flat().map((symbol) => [symbol.node, symbol]));
      const checker = program.getTypeChecker();
      for (const file of affected) if (files.includes(file)) {
        const source = program.getSourceFile(`/${file}`)!;
        edges.set(file, collectRelations(source, checker, byNode));
        typeDependencies.set(file, collectTypeDependencies(source, checker));
      }
      const keys = new Set([...symbols.values()].flat().map((symbol) => symbol.key));
      for (const [file, fileEdges] of edges) edges.set(file, fileEdges.filter((edge) => keys.has(edge.from) && keys.has(edge.to)));
      for (const file of files) indexedVersions.set(file, String(options.files.version(file)));
      return { files: new Set([...symbolFiles, ...affected].filter((file) => files.includes(file))).size, durationMs: options.now() - started, full: changedFiles === undefined };
    },
    symbolsInFile: (file) => (symbols.get(file) ?? []).map(symbolInfo),
    symbolsInRange: (file, start, end) => innermostSymbols((symbols.get(file) ?? []).map(symbolInfo), start, end),
    outgoing,
    incoming,
    findPaths(fromKeys, toKeys, maxHops = 2) {
      if (!Number.isInteger(maxHops) || maxHops < 0) throw new Error("maxHops 必须为非负整数");
      const paths: RelationPath[] = [];
      const targets = new Set(toKeys);
      for (const from of [...new Set(fromKeys)].sort()) {
        const queue: RelationPath[] = [{ from, to: from, hops: [], typeOnly: true }];
        const visited = new Set([from]);
        for (let cursor = 0; cursor < queue.length; cursor += 1) {
          const path = queue[cursor]!;
          if (targets.has(path.to)) paths.push(path);
          if (path.hops.length >= maxHops) continue;
          const neighbors = [...outgoing(path.to).filter((edge) => edge.kind !== "contains").map((edge) => ({ from: path.to, to: edge.to, kind: edge.kind, direction: "forward" as const })), ...incoming(path.to).filter((edge) => edge.kind !== "contains").map((edge) => ({ from: path.to, to: edge.from, kind: edge.kind, direction: "backward" as const }))].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
          for (const hop of neighbors) if (!visited.has(hop.to)) { visited.add(hop.to); queue.push({ from, to: hop.to, hops: [...path.hops, hop], typeOnly: path.typeOnly && hop.kind === "type-reference" }); }
        }
      }
      return paths;
    },
    stats: () => ({ files: files.length, symbols: [...symbols.values()].flat().length, edges: [...edges.values()].flat().length, truncated })
  };
}
