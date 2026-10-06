import { readdirSync, readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { isSemanticFile, type SemanticFileProvider } from "@simplercp/conflict-guard";
import { resolveWorkspacePath } from "../workspace.js";

export function createWorkspaceSemanticFiles(root: string, mirror: (file: string) => { text: string; version: number } | undefined): SemanticFileProvider & { contextFiles(): string[] } {
  const require = createRequire(import.meta.url);
  function listFiles(directory = "", context = false): string[] {
    let entries;
    try {
      entries = readdirSync(path.join(root, directory), { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
    return entries.flatMap((entry) => {
      const file = path.posix.join(directory, entry.name);
      if (["node_modules", ".git", "dist", "build", "coverage"].includes(entry.name)) return [];
      if (entry.isDirectory()) return listFiles(file, context);
      return entry.isFile() && (isSemanticFile(file) || context && /\.[cm]?[jt]sx?$/.test(file)) ? [file] : [];
    });
  }
  return {
    listFiles,
    contextFiles: () => listFiles("", true),
    readFile(file) {
      const current = mirror(file);
      if (current) return current.text;
      try { return readFileSync(resolveWorkspacePath(root, file), "utf8"); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return ""; throw error; }
    },
    version(file) {
      const current = mirror(file);
      if (current) return `mirror:${current.version}`;
      const stat = statSync(resolveWorkspacePath(root, file));
      return `disk:${stat.mtimeMs}:${stat.size}:${stat.ino}`;
    },
    readLib(name: string) { return readFileSync(require.resolve(`typescript/lib/${name}`), "utf8"); }
  };
}
