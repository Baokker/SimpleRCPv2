import { createRequire } from "node:module";
import fs from "node:fs/promises";
import { getYDoc, docs } from "y-websocket/bin/utils";
import type * as Y from "yjs";
import { applyTextDelta, FILESYSTEM_ORIGIN } from "./textDelta.js";
import { readWorkspaceFile, writeWorkspaceFile, resolveWorkspacePath } from "./workspace.js";

const require = createRequire(import.meta.url);
const YRuntime = require("yjs") as typeof import("yjs");

export interface CollaborativeDocumentStoreOptions {
  workspaceRoot: string;
  projectId?: string;
  persistDelayMs?: number;
  onPersisted?(filePath: string, content: string): void;
  persistGate?(filePath: string): { allowed: boolean; reason?: string };
  onPersistBlocked?(filePath: string, reason?: string): void;
  onPersistConflict?(filePath: string): void;
  onPersistError?(filePath: string, error: unknown): void;
  onDocumentPrepared?(name: string, document: Y.Doc, filePath: string): void;
  onDocumentRetired?(filePath: string): void;
  onDocumentReleased?(filePath: string): void;
  shouldPinDocument?(filePath: string): boolean;
  onPersistenceGateOpened?(): void;
  filesystemOrigin?(filePath: string, content: string): unknown;
  onUnopenedGuardRevert?(filePath: string, before: string, after: string, ownerId: string): void;
}

export function createCollaborativeDocumentStore({
  workspaceRoot,
  projectId,
  persistDelayMs = 300,
  onPersisted,
  persistGate,
  onPersistBlocked,
  onPersistConflict,
  onPersistError,
  onDocumentPrepared,
  onDocumentRetired,
  onDocumentReleased,
  shouldPinDocument,
  onPersistenceGateOpened,
  filesystemOrigin,
  onUnopenedGuardRevert
}: CollaborativeDocumentStoreOptions) {
  const initialized = new Map<string, Promise<Y.Doc>>();
  const persistedContents = new Map<string, string>();
  const persistedSnapshots = new Map<string, Uint8Array>();
  const persistTimers = new Map<string, NodeJS.Timeout>();
  const dirtyNames = new Set<string>();
  const blockedNames = new Set<string>();
  const deferredReleases = new Map<string, { document: Y.Doc; resolve: () => void }>();
  const retired = new Set<string>();
  const revisions = new Map<string, number>();
  const destroyDocuments = new Map<string, () => void>();
  const persistenceOperations = new Map<string, Promise<void>>();
  let disposed = false;

  async function getDocument(roomId: string, filePath: string) {
    return prepareDocument(documentName(roomId, filePath, projectId));
  }

  async function prepareDocument(name: string) {
    if (retired.has(name)) {
      throw new Error("Collaborative document path is no longer active");
    }
    const existing = initialized.get(name);
    if (existing) return existing;

    const loading = initializeDocument(name);
    initialized.set(name, loading);
    try {
      return await loading;
    } catch (error) {
      initialized.delete(name);
      throw error;
    }
  }

  async function initializeDocument(name: string) {
    const { filePath } = parseDocumentName(name);
    const result = await readWorkspaceFile(workspaceRoot, filePath, true);
    if (result.status !== "text") {
      throw new Error("Collaborative editing only supports text files");
    }

    const document = getYDoc(name);
    const destroy = document.destroy.bind(document);
    destroyDocuments.set(name, destroy);
    document.destroy = () => {
      if (disposed) { destroy(); return; }
      if (hasConnections(document) || shouldDeferRelease(name)) {
        docs.set(name, document);
        if (!deferredReleases.has(name)) deferredReleases.set(name, { document, resolve: () => undefined });
        return;
      }
      release(name);
      if (docs.get(name) === document) docs.delete(name);
      destroy();
    };
    const text = document.getText("content");
    if (text.length === 0 && result.content) {
      text.insert(0, result.content);
    }
    persistedContents.set(name, result.content);
    persistedSnapshots.set(name, YRuntime.encodeStateAsUpdate(document));
    text.observe((event) => {
      if (!isExternalOrigin(event.transaction.origin)) {
        revisions.set(filePath, (revisions.get(filePath) ?? 0) + 1);
      }
    });
    document.on("update", (_update, origin) => {
      if (!isExternalOrigin(origin)) {
        dirtyNames.add(name);
        schedulePersist(name, document);
      }
    });
    onDocumentPrepared?.(name, document, filePath);
    return document;
  }

  function schedulePersist(name: string, document: Y.Doc) {
    if (disposed || retired.has(name)) return;
    const existing = persistTimers.get(name);
    if (existing) clearTimeout(existing);
    persistTimers.set(
      name,
      setTimeout(() => {
        persistTimers.delete(name);
        void persistDocument(name, document);
      }, persistDelayMs)
    );
  }

  async function persistDocument(name: string, document: Y.Doc) {
    if (disposed) return;
    const previous = persistenceOperations.get(name) ?? Promise.resolve();
    const operation = previous.then(() => writeDocument(name, document));
    persistenceOperations.set(name, operation);
    await operation;
    if (persistenceOperations.get(name) === operation) persistenceOperations.delete(name);
  }

  async function writeDocument(name: string, document: Y.Doc) {
    if (disposed) return;
    if (!dirtyNames.has(name)) return;
    const { filePath } = parseDocumentName(name);
    try {
      const gate = persistGate?.(filePath) ?? { allowed: true };
      if (!gate.allowed) {
        if (!blockedNames.has(name)) onPersistBlocked?.(filePath, gate.reason);
        blockedNames.add(name);
        schedulePersist(name, document);
        return;
      }
      const wasBlocked = blockedNames.delete(name);
      const current = await readWorkspaceFile(workspaceRoot, filePath, true);
      if (disposed) return;
      const finalGate = persistGate?.(filePath) ?? { allowed: true };
      if (!finalGate.allowed) {
        if (!blockedNames.has(name)) onPersistBlocked?.(filePath, finalGate.reason);
        blockedNames.add(name);
        schedulePersist(name, document);
        return;
      }
      const content = document.getText("content").toString();
      const snapshot = YRuntime.encodeStateAsUpdate(document);
      if (dirtyNames.has(name) && current.status === "text" && current.content !== (persistedContents.get(name) ?? current.content)) onPersistConflict?.(filePath);
      await writeWorkspaceFile(workspaceRoot, filePath, content);
      persistedContents.set(name, content);
      persistedSnapshots.set(name, snapshot);
      if (document.getText("content").toString() === content) dirtyNames.delete(name);
      else schedulePersist(name, document);
      onPersisted?.(filePath, content);
      if (wasBlocked) onPersistenceGateOpened?.();
    } catch (error) {
      onPersistError?.(filePath, error);
    }
  }

  async function flush(roomId: string, filePath: string) {
    const name = documentName(roomId, filePath, projectId);
    const document = await prepareDocument(name);
    const timer = persistTimers.get(name);
    if (timer) {
      clearTimeout(timer);
      persistTimers.delete(name);
    }
    await persistDocument(name, document);
  }

  async function flushDocument(name: string, document: Y.Doc) {
    const timer = persistTimers.get(name);
    if (timer) {
      clearTimeout(timer);
      persistTimers.delete(name);
    }
    if (!retired.has(name)) {
      await persistDocument(name, document);
    }
  }

  async function awaitIdle() {
    await Promise.all(
      [...initialized.entries()].map(async ([name, loading]) => {
        const document = await loading;
        await flushDocument(name, document);
      })
    );
  }

  async function retirePath(filePath: string) {
    const matches = [...initialized.entries()].filter(([name]) => {
      const activePath = parseDocumentName(name).filePath;
      return activePath === filePath || activePath.startsWith(`${filePath}/`);
    });

    await Promise.all(
      matches.map(async ([name, loading]) => {
        retired.add(name);
        const timer = persistTimers.get(name);
        if (timer) clearTimeout(timer);
        persistTimers.delete(name);
        const document = await loading;
        await persistDocument(name, document);
      })
    );
    onDocumentRetired?.(filePath);
  }

  async function reloadPath(filePath: string) {
    if (disposed) return;
    const matches = [...initialized.entries()].filter(
      ([name]) => parseDocumentName(name).filePath === filePath
    );
    if (matches.length === 0) return;

    const result = await readWorkspaceFile(workspaceRoot, filePath, true);
    if (disposed) return;
    if (result.status !== "text") {
      dropPath(filePath);
      return;
    }
    const origin = filesystemOrigin?.(filePath, result.content) ?? FILESYSTEM_ORIGIN;

    await Promise.all(
      matches.map(async ([name, loading]) => {
        const document = await loading;
        if (disposed) return;
        const text = document.getText("content");
        const previousContent = persistedContents.get(name) ?? text.toString();
        if (previousContent === result.content) return;
        if (!dirtyNames.has(name) && text.toString() === previousContent) {
          document.transact(() => {
            applyTextDelta(text, previousContent, result.content);
          }, origin);
          persistedContents.set(name, result.content);
          persistedSnapshots.set(name, YRuntime.encodeStateAsUpdate(document));
          return;
        }
        const snapshot = persistedSnapshots.get(name);
        if (!snapshot) throw new Error(`Missing persistence snapshot for ${name}`);
        const external = new YRuntime.Doc();
        YRuntime.applyUpdate(external, snapshot);
        const vector = YRuntime.encodeStateVector(external);
        applyTextDelta(external.getText("content"), previousContent, result.content);
        const externalUpdate = YRuntime.encodeStateAsUpdate(external, vector);
        YRuntime.applyUpdate(document, externalUpdate, origin);
        persistedContents.set(name, result.content);
        persistedSnapshots.set(name, YRuntime.encodeStateAsUpdate(external));
        external.destroy();
        if (persistGate && !persistGate(filePath).allowed) onPersistConflict?.(filePath);
      })
    );
  }

  function dropPath(filePath: string) {
    for (const name of initialized.keys()) {
      const activePath = parseDocumentName(name).filePath;
      if (activePath !== filePath && !activePath.startsWith(`${filePath}/`)) {
        continue;
      }
      retired.add(name);
      const timer = persistTimers.get(name);
      if (timer) clearTimeout(timer);
      persistTimers.delete(name);
    }
    onDocumentRetired?.(filePath);
  }

  function release(name: string) {
    const { filePath } = parseDocumentName(name);
    if (shouldPinDocument?.(filePath) || dirtyNames.has(name)) return false;
    const deferred = deferredReleases.get(name);
    deferredReleases.delete(name);
    const timer = persistTimers.get(name);
    if (timer) clearTimeout(timer);
    persistTimers.delete(name);
    initialized.delete(name);
    persistedContents.delete(name);
    persistedSnapshots.delete(name);
    dirtyNames.delete(name);
    blockedNames.delete(name);
    onDocumentReleased?.(filePath);
    deferred?.resolve();
    return true;
  }

  function shouldDeferRelease(name: string) {
    const filePath = parseDocumentName(name).filePath;
    return Boolean(shouldPinDocument?.(filePath) || dirtyNames.has(name));
  }

  function waitForRelease(name: string, document: Y.Doc) {
    const existing = deferredReleases.get(name);
    if (existing) return new Promise<void>((resolve) => {
      const previousResolve = existing.resolve;
      existing.resolve = () => { previousResolve(); resolve(); };
    });
    return new Promise<void>((resolve) => deferredReleases.set(name, { document, resolve }));
  }

  function releaseUnpinned() {
    for (const [name, deferred] of [...deferredReleases]) {
      if (hasConnections(deferred.document) || shouldDeferRelease(name)) continue;
      const destroy = destroyDocuments.get(name);
      if (release(name)) {
        if (docs.get(name) === deferred.document) docs.delete(name);
        destroy?.();
        destroyDocuments.delete(name);
      }
    }
  }

  function persistenceStateChanged() {
    if (disposed) return;
    for (const name of blockedNames) {
      const file = parseDocumentName(name).filePath;
      if (!(persistGate?.(file).allowed ?? true)) continue;
      const loading = initialized.get(name);
      if (loading) void loading.then((document) => flushDocument(name, document)).then(releaseUnpinned);
    }
    releaseUnpinned();
  }

  async function dispose() {
    disposed = true;
    for (const timer of persistTimers.values()) clearTimeout(timer);
    persistTimers.clear();
    await Promise.all([...persistenceOperations.values(), ...initialized.values()]);
    for (const [name, destroy] of destroyDocuments) {
      if (docs.has(name)) docs.delete(name);
      destroy();
    }
    destroyDocuments.clear();
    deferredReleases.clear();
  }

  function getRevision(filePath: string) {
    return revisions.get(filePath) ?? 0;
  }

  function getRevisions() {
    return new Map(revisions);
  }

  async function applyGuardRevert(filePath: string, expected: string, content: string, ownerId: string, remove = false) {
    const entry = [...initialized].find(([name]) => parseDocumentName(name).filePath === filePath);
    if (entry) {
      const document = await entry[1];
      const text = document.getText("content");
      const restoring = retired.has(entry[0]) && expected === "";
      if (restoring) {
        try { await fs.stat(resolveWorkspacePath(workspaceRoot, filePath)); return false; }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
      } else if (text.toString() !== expected) return false;
      document.transact(() => applyTextDelta(text, text.toString(), content), { kind: "guard-revert", memberId: ownerId });
      if (retired.has(entry[0])) retired.delete(entry[0]);
      await flushDocument(entry[0], document);
      if (restoring) { onUnopenedGuardRevert?.(filePath, expected, content, ownerId); onDocumentPrepared?.(entry[0], document, filePath); }
      if (remove) { await fs.unlink(resolveWorkspacePath(workspaceRoot, filePath)); dropPath(filePath); }
      return true;
    }
    let result;
    try { result = await readWorkspaceFile(workspaceRoot, filePath, true); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT" || expected !== "") throw error; result = { status: "text" as const, content: "" }; }
    if (result.status !== "text" || result.content !== expected) return false;
    if (remove) await fs.unlink(resolveWorkspacePath(workspaceRoot, filePath));
    else await writeWorkspaceFile(workspaceRoot, filePath, content);
    onUnopenedGuardRevert?.(filePath, expected, content, ownerId);
    onPersisted?.(filePath, content);
    return true;
  }

  return {
    applyGuardRevert,
    getDocument,
    prepareDocument,
    flush,
    flushDocument,
    awaitIdle,
    retirePath,
    reloadPath,
    dropPath,
    release,
    shouldDeferRelease,
    waitForRelease,
    releaseUnpinned,
    persistenceStateChanged,
    dispose,
    getRevision,
    getRevisions
  };
}

function hasConnections(document: Y.Doc) {
  return ((document as Y.Doc & { conns?: Map<object, unknown> }).conns?.size ?? 0) > 0;
}
function isExternalOrigin(origin: unknown) {
  return origin === FILESYSTEM_ORIGIN || Boolean(origin && typeof origin === "object" && "kind" in origin && origin.kind === "agent");
}

export type CollaborativeDocumentStore = ReturnType<
  typeof createCollaborativeDocumentStore
>;

export function documentName(roomId: string, filePath: string, projectId?: string) {
  const name = `${roomId}:${filePath}`;
  return projectId ? `${projectId}|${name}` : name;
}

export function parseDocumentName(name: string) {
  const namespaceSeparator = name.indexOf("|");
  const projectId = namespaceSeparator >= 0 ? name.slice(0, namespaceSeparator) : undefined;
  const documentPart = namespaceSeparator >= 0 ? name.slice(namespaceSeparator + 1) : name;
  const separator = documentPart.indexOf(":");
  if (separator <= 0 || separator === documentPart.length - 1) {
    throw new Error("Invalid collaborative document name");
  }
  return {
    projectId,
    roomId: documentPart.slice(0, separator),
    filePath: documentPart.slice(separator + 1)
  };
}
