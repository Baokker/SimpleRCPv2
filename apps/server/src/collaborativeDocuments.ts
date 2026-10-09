import { createRequire } from "node:module";
import { getYDoc, docs } from "y-websocket/bin/utils";
import crypto from "node:crypto";
import type * as Y from "yjs";
import { applyTextDelta, FILESYSTEM_ORIGIN } from "./textDelta.js";
import { readWorkspaceFile, writeWorkspaceFile } from "./workspace.js";

const require = createRequire(import.meta.url);
const YRuntime = require("yjs") as typeof import("yjs");

export interface CollaborativeDocumentStoreOptions {
  workspaceRoot: string;
  projectId?: string;
  persistDelayMs?: number;
  onPersisted?(filePath: string, content: string): void;
}

export function createCollaborativeDocumentStore({
  workspaceRoot,
  projectId,
  persistDelayMs = 300,
  onPersisted
}: CollaborativeDocumentStoreOptions) {
  const initialized = new Map<string, Promise<Y.Doc>>();
  const persistedContents = new Map<string, string>();
  const persistedSnapshots = new Map<string, Uint8Array>();
  const persistTimers = new Map<string, NodeJS.Timeout>();
  const dirtyNames = new Set<string>();
  const deferredReleases = new Map<string, Y.Doc>();
  const retired = new Set<string>();
  const revisions = new Map<string, number>();
  const documentEpochs = new WeakMap<Y.Doc, string>();
  const preparedListeners = new Set<(file: string, document: Y.Doc) => void>();
  const retiredListeners = new Set<(file: string) => void>();
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
    documentEpochs.set(document, crypto.randomUUID());
    const destroy = document.destroy.bind(document);
    destroyDocuments.set(name, destroy);
    document.destroy = () => {
      if (disposed) { destroy(); return; }
      if (hasConnections(document) || shouldDeferRelease(name)) {
        docs.set(name, document);
        deferredReleases.set(name, document);
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
      if (event.transaction.origin !== FILESYSTEM_ORIGIN) revisions.set(filePath, (revisions.get(filePath) ?? 0) + 1);
    });
    document.on("update", (_update, origin) => {
      if (origin !== FILESYSTEM_ORIGIN) {
        dirtyNames.add(name);
        schedulePersist(name, document);
      }
    });
    for (const listener of preparedListeners) listener(filePath, document);
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
    if (disposed || !dirtyNames.has(name)) return;
    const { filePath } = parseDocumentName(name);
    const current = await readWorkspaceFile(workspaceRoot, filePath, true);
    if (disposed) return;
    if (current.status === "text" && current.content !== persistedContents.get(name)) await reloadPath(filePath);
    const content = document.getText("content").toString();
    const snapshot = YRuntime.encodeStateAsUpdate(document);
    await writeWorkspaceFile(workspaceRoot, filePath, content);
    persistedContents.set(name, content);
    persistedSnapshots.set(name, snapshot);
    if (document.getText("content").toString() === content) dirtyNames.delete(name);
    else schedulePersist(name, document);
    onPersisted?.(filePath, content);
    releaseUnpinned();
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
        for (const listener of retiredListeners) listener(parseDocumentName(name).filePath);
      })
    );
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

    await Promise.all(
      matches.map(async ([name, loading]) => {
        const document = await loading;
        if (disposed) return;
        const text = document.getText("content");
        const previousContent = persistedContents.get(name) ?? text.toString();
        if (previousContent === result.content) return;
        if (!dirtyNames.has(name) && text.toString() === previousContent) {
          document.transact(() => { applyTextDelta(text, previousContent, result.content); }, FILESYSTEM_ORIGIN);
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
        YRuntime.applyUpdate(document, YRuntime.encodeStateAsUpdate(external, vector), FILESYSTEM_ORIGIN);
        persistedContents.set(name, result.content);
        persistedSnapshots.set(name, YRuntime.encodeStateAsUpdate(external));
        external.destroy();
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
      for (const listener of retiredListeners) listener(activePath);
    }
  }

  function release(name: string) {
    if (dirtyNames.has(name)) return false;
    deferredReleases.delete(name);
    const timer = persistTimers.get(name);
    if (timer) clearTimeout(timer);
    persistTimers.delete(name);
    initialized.delete(name);
    persistedContents.delete(name);
    persistedSnapshots.delete(name);
    dirtyNames.delete(name);
    return true;
  }

  function shouldDeferRelease(name: string) { return dirtyNames.has(name); }

  function releaseUnpinned() {
    for (const [name, document] of [...deferredReleases]) {
      if (hasConnections(document) || shouldDeferRelease(name)) continue;
      const destroy = destroyDocuments.get(name);
      if (release(name)) {
        if (docs.get(name) === document) docs.delete(name);
        destroy?.();
        destroyDocuments.delete(name);
      }
    }
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

  async function getPreparedDocument(name: string) {
    const loading = initialized.get(name);
    if (!loading) return undefined;
    return loading;
  }

  function getDocumentEpoch(document: Y.Doc) {
    return documentEpochs.get(document);
  }

  function getRevision(filePath: string) {
    return revisions.get(filePath) ?? 0;
  }

  function getRevisions() {
    return new Map(revisions);
  }

  return {
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
    releaseUnpinned,
    dispose,
    getPreparedDocument,
    getDocumentEpoch,
    getRevision,
    getRevisions,
    onPrepared(listener: (file: string, document: Y.Doc) => void) {
      preparedListeners.add(listener);
      return () => preparedListeners.delete(listener);
    },
    onRetired(listener: (file: string) => void) {
      retiredListeners.add(listener);
      return () => retiredListeners.delete(listener);
    }
  };
}

function hasConnections(document: Y.Doc) {
  return ((document as Y.Doc & { conns?: Map<object, unknown> }).conns?.size ?? 0) > 0;
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
