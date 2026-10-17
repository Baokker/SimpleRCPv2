import type { SymbolChange } from "../semantic/changes.js";
import { parseDeclaration } from "./declarations.js";

export function declarationSyntax(change: SymbolChange) {
  const beforeComplete = change.status === "added" || Boolean(parseDeclaration(change, "before"));
  const afterComplete = change.status === "deleted" || Boolean(parseDeclaration(change, "after"));
  return {
    complete: beforeComplete && afterComplete,
    ...(beforeComplete ? {} : { reason: "before declaration has syntax diagnostics" }),
    ...(afterComplete || !beforeComplete ? {} : { reason: "after declaration has syntax diagnostics" })
  };
}

export function createSyntaxWaitTracker() {
  const waits = new Map<string, { startedAt?: number; elapsedMs: number; revisions: Set<string>; finalizedRevision?: string }>();
  return {
    observe(id: string, revision: string, symbols: SymbolChange[], now: number, batchClosed = false) {
      const incomplete = symbols.some((symbol) => !declarationSyntax(symbol).complete);
      let wait = waits.get(id);
      if (incomplete && wait?.finalizedRevision !== revision) {
        if (!wait) { wait = { elapsedMs: 0, revisions: new Set() }; waits.set(id, wait); }
        wait.startedAt ??= now;
        wait.revisions.add(revision);
      } else if (wait?.startedAt !== undefined) {
        wait.elapsedMs += Math.max(0, now - wait.startedAt);
        wait.startedAt = undefined;
      }
      if (wait && batchClosed) {
        if (wait.startedAt !== undefined) wait.elapsedMs += Math.max(0, now - wait.startedAt);
        wait.startedAt = undefined;
        wait.finalizedRevision = revision;
      }
      return wait ? { deferred: wait.revisions.size, waitMs: wait.elapsedMs + (wait.startedAt === undefined ? 0 : Math.max(0, now - wait.startedAt)) } : undefined;
    },
    finalize(id: string, revision: string, now: number) {
      const wait = waits.get(id);
      if (!wait || wait.finalizedRevision === revision) return;
      if (wait.startedAt !== undefined) wait.elapsedMs += Math.max(0, now - wait.startedAt);
      wait.startedAt = undefined;
      wait.finalizedRevision = revision;
    },
    reset(id: string) { waits.delete(id); },
    retain(ids: ReadonlySet<string>) { for (const id of waits.keys()) if (!ids.has(id)) waits.delete(id); }
  };
}
