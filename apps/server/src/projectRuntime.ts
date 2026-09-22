import path from "node:path";
import { createChatStore } from "./chat.js";
import { createCollaborativeDocumentStore } from "./collaborativeDocuments.js";
import { createEventLog } from "./eventLog.js";
import { createParticipantStore } from "./participantStore.js";
import type { ProjectRecord } from "./projects.js";
import { createRoomStore } from "./rooms.js";
import { createSharedTerminal } from "./sharedTerminal.js";
import type { WorkspaceChange } from "./types.js";
import { watchWorkspace } from "./workspaceWatcher.js";

export function createProjectRuntime(
  project: ProjectRecord,
  options: { terminalEnabled?: boolean } = {}
) {
  const projectRoot = path.dirname(project.workspacePath);
  const events = createEventLog(path.join(projectRoot, "activity.json"));
  const participants = createParticipantStore(project.id, projectRoot);
  const rooms = createRoomStore(events);
  const chat = createChatStore(events, {
    storagePath: path.join(path.dirname(project.workspacePath), "chat.json")
  });
  const workspaceListeners = new Set<(change: WorkspaceChange) => void>();
  let suppressedWorkspaceChanges: Array<{
    types: WorkspaceChange["type"][];
    path: string;
    descendants: boolean;
    expiresAt: number;
  }> = [];
  const fileSavedListeners = new Set<(path: string) => void>();
  const documents = createCollaborativeDocumentStore({
    workspaceRoot: project.workspacePath,
    projectId: project.id,
    onPersisted(path) {
      for (const listener of fileSavedListeners) listener(path);
    }
  });
  const terminal = createSharedTerminal({
    workspaceRoot: project.workspacePath,
    enabled: options.terminalEnabled !== false
  });
  const room = rooms.createRoom(project.workspacePath, project.name);
  const terminalListeners = new Set<(data: string) => void>();
  const removeTerminalListener = terminal.onData((data) => {
    for (const listener of terminalListeners) listener(data);
  });
  const watcher = watchWorkspace(project.workspacePath, async (change) => {
    if (change.type === "change" || change.type === "add") {
      await documents.reloadPath(change.path);
    }
    if (change.type === "unlink" || change.type === "unlinkDir") {
      documents.dropPath(change.path);
    }
    if (change.type !== "change" && !isSuppressedWorkspaceChange(change)) {
      for (const listener of workspaceListeners) listener(change);
    }
  });

  function isSuppressedWorkspaceChange(change: WorkspaceChange) {
    const now = Date.now();
    suppressedWorkspaceChanges = suppressedWorkspaceChanges.filter(
      (suppression) => suppression.expiresAt > now
    );
    return suppressedWorkspaceChanges.some(
      (suppression) =>
        suppression.types.includes(change.type) &&
        (change.path === suppression.path ||
          (suppression.descendants &&
            change.path.startsWith(`${suppression.path}/`)))
    );
  }

  function suppressWatcherDuplicates(change: WorkspaceChange) {
    const expiresAt = Date.now() + 2_000;
    if (change.type === "rename") {
      suppressedWorkspaceChanges.push(
        {
          types: ["unlink", "unlinkDir"],
          path: change.fromPath,
          descendants: true,
          expiresAt
        },
        {
          types: ["add", "addDir"],
          path: change.path,
          descendants: true,
          expiresAt
        }
      );
      return;
    }
    if (change.type === "unlink" || change.type === "unlinkDir") {
      suppressedWorkspaceChanges.push({
        types: ["unlink", "unlinkDir"],
        path: change.path,
        descendants: true,
        expiresAt
      });
      return;
    }
    suppressedWorkspaceChanges.push({
      types: [change.type],
      path: change.path,
      descendants: false,
      expiresAt
    });
  }

  return {
    project,
    terminalEnabled: terminal.enabled,
    events,
    participants,
    rooms,
    chat,
    documents,
    terminal,
    room,
    onWorkspaceChanged(listener: (change: WorkspaceChange) => void) {
      workspaceListeners.add(listener);
      return () => workspaceListeners.delete(listener);
    },
    suppressWorkspaceChange(change: WorkspaceChange) {
      suppressWatcherDuplicates(change);
    },
    announceWorkspaceChange(change: WorkspaceChange) {
      for (const listener of workspaceListeners) listener(change);
    },
    onFileSaved(listener: (path: string) => void) {
      fileSavedListeners.add(listener);
      return () => fileSavedListeners.delete(listener);
    },
    onTerminalData(listener: (data: string) => void) {
      terminalListeners.add(listener);
      return () => terminalListeners.delete(listener);
    },
    async dispose() {
      workspaceListeners.clear();
      suppressedWorkspaceChanges = [];
      fileSavedListeners.clear();
      terminalListeners.clear();
      removeTerminalListener();
      await documents.awaitIdle();
      await chat.awaitIdle();
      await events.awaitIdle();
      terminal.dispose();
      await watcher.close();
    }
  };
}

export type ProjectRuntime = ReturnType<typeof createProjectRuntime>;
