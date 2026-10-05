import * as ts from "typescript";
import type { SemanticFileProvider } from "../semantic/types.js";

export class MemoryFileProvider implements SemanticFileProvider {
  private readonly files = new Map<string, { text: string; version: number }>();
  private versionCounter = 0;

  constructor(initial: Record<string, string> = {}) {
    for (const file of Object.keys(initial).sort()) this.open(file, initial[file] ?? "");
  }

  open(file: string, text: string) {
    this.versionCounter += 1;
    this.files.set(file, { text, version: this.versionCounter });
  }

  set(file: string, text: string) {
    const current = this.files.get(file);
    if (current?.text === text) return;
    this.versionCounter += 1;
    this.files.set(file, { text, version: this.versionCounter });
  }

  remove(file: string) {
    if (this.files.delete(file)) this.versionCounter += 1;
  }

  listFiles() {
    return [...this.files.keys()].sort();
  }

  readFile(file: string) {
    return this.files.get(file)?.text ?? "";
  }

  version(file: string) {
    return this.files.get(file)?.version ?? 0;
  }

  readLib(name: string) {
    return ts.sys.readFile(requireLibPath(name)) ?? "";
  }
}

function requireLibPath(name: string) {
  const path = ts.getDefaultLibFilePath({ target: ts.ScriptTarget.ES2022 });
  return path.endsWith("lib.d.ts") ? path.replace(/lib\.d\.ts$/, name) : path;
}

