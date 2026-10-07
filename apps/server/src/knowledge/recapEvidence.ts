import path from "node:path";
import ts from "typescript";
import {recapFileVersions} from "@simplercp/knowledge";
import {readWorkspaceFile} from "../workspace.js";

export async function enrichRecapEvidence(evidence: Record<string, unknown>, workspace: string) {
  const sources: Record<string, string> = {};
  const queue = recapFileVersions(evidence).map(version => version.file);
  const seen = new Set<string>();
  const unresolved: string[] = [];
  while (queue.length && seen.size < 30) {
    const file = queue.shift()!;
    if (seen.has(file) || !/\.[cm]?[jt]sx?$/u.test(file)) continue;
    seen.add(file);
    if (!ts.sys.fileExists(path.join(workspace, file))) { unresolved.push(file); continue; }
    const result = await readWorkspaceFile(workspace, file);
    if (result.status !== "text") continue;
    sources[file] = result.content;
    for (const imported of ts.preProcessFile(result.content).importedFiles) {
      if (!imported.fileName.startsWith(".")) continue;
      const direct = path.resolve(workspace, path.dirname(file), imported.fileName);
      const resolved = ts.sys.fileExists(direct) ? direct : ts.resolveModuleName(imported.fileName, path.join(workspace, file), {allowJs: true, moduleResolution: ts.ModuleResolutionKind.Bundler}, ts.sys).resolvedModule?.resolvedFileName;
      if (!resolved) { unresolved.push(`${file}: ${imported.fileName}`); continue; }
      const relative = path.relative(workspace, resolved).split(path.sep).join("/");
      if (relative.startsWith("../") || path.isAbsolute(relative)) continue;
      queue.push(relative);
    }
  }
  return {...evidence, ...(Object.keys(sources).length ? {symbolSources: sources} : {}), ...(unresolved.length ? {unresolvedSymbolSources: unresolved} : {})};
}
