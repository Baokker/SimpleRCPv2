import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { isSemanticFile, type SemanticFileProvider } from "@simplercp/conflict-guard";
import { resolveWorkspacePath } from "../workspace.js";

export function createWorkspaceSemanticFiles(root: string, mirror: (file: string) => { text: string; version: number } | undefined): SemanticFileProvider {
  function listFiles(directory = ""): string[] {
    return readdirSync(path.join(root, directory), { withFileTypes: true }).flatMap((entry) => {
      const file = path.posix.join(directory, entry.name);
      if (["node_modules", ".git", "dist", "build", "coverage"].includes(entry.name)) return [];
      if (entry.isDirectory()) return listFiles(file);
      return entry.isFile() && isSemanticFile(file) ? [file] : [];
    });
  }
  return {
    listFiles,
    readFile: (file) => mirror(file)?.text ?? readFileSync(resolveWorkspacePath(root, file), "utf8"),
    version(file) {
      const current = mirror(file);
      if (current) return `mirror:${current.version}`;
      const stat = statSync(resolveWorkspacePath(root, file));
      return `disk:${stat.mtimeMs}:${stat.size}:${stat.ino}`;
    }
  };
}
