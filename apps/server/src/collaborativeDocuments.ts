import { getYDoc } from "y-websocket/bin/utils";
import type * as Y from "yjs";
import { readWorkspaceFile, writeWorkspaceFile } from "./workspace.js";

export interface CollaborativeDocumentStoreOptions {
  workspaceRoot: string;
  persistDelayMs?: number;
}

export function createCollaborativeDocumentStore({
  workspaceRoot,
  persistDelayMs = 300
}: CollaborativeDocumentStoreOptions) {
  const initialized = new Map<string, Promise<Y.Doc>>();
  const persistTimers = new Map<string, NodeJS.Timeout>();
  const retired = new Set<string>();

  async function getDocument(roomId: string, filePath: string) {
    return prepareDocument(documentName(roomId, filePath));
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
    document.on("update", () => schedulePersist(name, document));
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
    await writeWorkspaceFile(
      workspaceRoot,
      filePath,
      document.getText("content").toString()
    );
  }

  async function flush(roomId: string, filePath: string) {
    const name = documentName(roomId, filePath);
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

  function release(name: string) {
    const timer = persistTimers.get(name);
    if (timer) clearTimeout(timer);
    persistTimers.delete(name);
    initialized.delete(name);
  }

  return {
    getDocument,
    prepareDocument,
    flush,
    flushDocument,
    retirePath,
    release
  };
}

export type CollaborativeDocumentStore = ReturnType<
  typeof createCollaborativeDocumentStore
>;

export function documentName(roomId: string, filePath: string) {
  return `${roomId}:${filePath}`;
}

export function parseDocumentName(name: string) {
  const separator = name.indexOf(":");
  if (separator <= 0 || separator === name.length - 1) {
    throw new Error("Invalid collaborative document name");
  }
  return {
    roomId: name.slice(0, separator),
    filePath: name.slice(separator + 1)
  };
}
