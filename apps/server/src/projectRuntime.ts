import { createChatStore } from "./chat.js";
import { createCollaborativeDocumentStore } from "./collaborativeDocuments.js";
import { createEventLog } from "./eventLog.js";
import type { ProjectRecord } from "./projects.js";
import { createRoomStore } from "./rooms.js";
import { createSharedTerminal } from "./sharedTerminal.js";
import { watchWorkspace } from "./workspaceWatcher.js";

export function createProjectRuntime(project: ProjectRecord) {
  const events = createEventLog();
  const rooms = createRoomStore(events);
  const chat = createChatStore(events);
  const documents = createCollaborativeDocumentStore({
    workspaceRoot: project.workspacePath,
    projectId: project.id
  });
  const terminal = createSharedTerminal({ workspaceRoot: project.workspacePath });
  const room = rooms.createRoom(project.workspacePath, project.name);
  const workspaceListeners = new Set<(path: string) => void>();
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
    if (change.type !== "change") {
      for (const listener of workspaceListeners) listener(change.path);
    }
  });

  return {
    project,
    events,
    rooms,
    chat,
    documents,
    terminal,
    room,
    onWorkspaceChanged(listener: (path: string) => void) {
      workspaceListeners.add(listener);
      return () => workspaceListeners.delete(listener);
    },
    onTerminalData(listener: (data: string) => void) {
      terminalListeners.add(listener);
      return () => terminalListeners.delete(listener);
    },
    async dispose() {
      workspaceListeners.clear();
      terminalListeners.clear();
      removeTerminalListener();
      await documents.awaitIdle();
      terminal.dispose();
      await watcher.close();
    }
  };
}

export type ProjectRuntime = ReturnType<typeof createProjectRuntime>;
