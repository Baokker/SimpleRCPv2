import { getYDoc } from "y-websocket/bin/utils";
import type * as Y from "yjs";
import { applyTextDelta, FILESYSTEM_ORIGIN } from "./textDelta.js";
import { readWorkspaceFile, writeWorkspaceFile } from "./workspace.js";

export interface CollaborativeDocumentStoreOptions {
  workspaceRoot: string;
  projectId?: string;
  persistDelayMs?: number;
  onPersisted?(filePath: string): void;
}

export function createCollaborativeDocumentStore({
  workspaceRoot,
  projectId,
  persistDelayMs = 300,
  onPersisted
}: CollaborativeDocumentStoreOptions) {
  const initialized = new Map<string, Promise<Y.Doc>>();
  const persistedContents = new Map<string, string>();
  const persistTimers = new Map<string, NodeJS.Timeout>();
  const retired = new Set<string>();
  const revisions = new Map<string, number>();

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
    const text = document.getText("content");
    if (text.length === 0 && result.content) {
      text.insert(0, result.content);
    }
    persistedContents.set(name, result.content);
    document.on("update", (_update, origin) => {
      if (origin !== FILESYSTEM_ORIGIN) {
        revisions.set(filePath, (revisions.get(filePath) ?? 0) + 1);
        schedulePersist(name, document);
      }
    });
    return document;
  }

  function schedulePersist(name: string, document: Y.Doc) {
    if (retired.has(name)) return;
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
    const { filePath } = parseDocumentName(name);
    const content = document.getText("content").toString();
    await writeWorkspaceFile(workspaceRoot, filePath, content);
    persistedContents.set(name, content);
    onPersisted?.(filePath);
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
  }

  async function reloadPath(filePath: string) {
    const matches = [...initialized.entries()].filter(
      ([name]) => parseDocumentName(name).filePath === filePath
    );
    if (matches.length === 0) return;

    const result = await readWorkspaceFile(workspaceRoot, filePath, true);
    if (result.status !== "text") {
      dropPath(filePath);
      return;
    }

    await Promise.all(
      matches.map(async ([name, loading]) => {
        const document = await loading;
        const text = document.getText("content");
        const previousContent = persistedContents.get(name) ?? text.toString();
        if (previousContent === result.content) return;
        document.transact(() => {
          applyTextDelta(text, previousContent, result.content);
        }, FILESYSTEM_ORIGIN);
        persistedContents.set(name, result.content);
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
  }

  function release(name: string) {
    const timer = persistTimers.get(name);
    if (timer) clearTimeout(timer);
    persistTimers.delete(name);
    initialized.delete(name);
    persistedContents.delete(name);
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
    getRevision,
    getRevisions
  };
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
