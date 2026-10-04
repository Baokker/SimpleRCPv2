import path from "node:path";
import { createChatStore } from "./chat.js";
import { createCollaborativeDocumentStore } from "./collaborativeDocuments.js";
import { createEventLog } from "./eventLog.js";
import { getProjectMetadataPath, type ProjectRecord } from "./projects.js";
import { createRoomStore } from "./rooms.js";
import { createSharedTerminal } from "./sharedTerminal.js";
import { createKnowledgeService } from "./knowledge/knowledgeService.js";
import { createCaptureService } from "./knowledge/captureService.js";
import type { CaptureConfigInput } from "@simplercp/knowledge";
import type { ChatMessage, WorkspaceChange, ServerMessage } from "./types.js";
import { watchWorkspace } from "./workspaceWatcher.js";

export interface ProjectRuntimeOptions {
  terminalEnabled?: boolean; knowledgeMode?: string; knowledgeRecordEvents?: boolean;
  captureConfig?: CaptureConfigInput; llm?: { apiKey?: string; baseUrl: string; model: string };
}
export function createProjectRuntime(
  project: ProjectRecord,
  options: ProjectRuntimeOptions = {}
) {
  const projectRoot = getProjectMetadataPath(project);
  const events = createEventLog(path.join(projectRoot, "activity.json"));
  const rooms = createRoomStore(events);
  const chat = createChatStore(events, {
    storagePath: path.join(projectRoot, "chat.json")
  });
  const workspaceListeners = new Set<(change: WorkspaceChange) => void>();
  let suppressedWorkspaceChanges: Array<{
    types: WorkspaceChange["type"][];
    path: string;
    descendants: boolean;
    expiresAt: number;
  }> = [];
  const fileSavedListeners = new Set<(path: string) => void>();
  const knowledgeChangedListeners = new Set<(change: { cardId: string; action: string }) => void>();
  const knowledgeNotificationListeners = new Set<(memberId: string, message: ServerMessage) => void>();
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
  const knowledge = options.knowledgeMode && options.knowledgeMode !== "off"
    ? createKnowledgeService({
      projectId: project.id,
      roomId: room.id,
      workspaceRoot: project.workspacePath,
      metadataRoot: projectRoot,
      documents,
      events,
      onChanged(change) {
        for (const listener of knowledgeChangedListeners) listener(change);
      }
    })
    : undefined;
  const capture = knowledge ? createCaptureService({
    projectId: project.id, roomId: room.id, workspaceRoot: project.workspacePath, metadataRoot: projectRoot,
    knowledge, documents, chat, events, recordEvents: options.knowledgeRecordEvents, config: options.captureConfig, llm: options.llm,
    memberName(memberId) { return rooms.getMember(room.id, memberId)?.displayName ?? memberId; },
    onNotify(memberId, message) { for (const listener of knowledgeNotificationListeners) listener(memberId, message); }
  }) : undefined;
  const terminalListeners = new Set<(data: string) => void>();
  const inputWindows = new Map<string, { count: number; timer: ReturnType<typeof setTimeout> }>();
  function flushInput(memberId: string) {
    const window = inputWindows.get(memberId);
    if (!window) return;
    clearTimeout(window.timer);
    inputWindows.delete(memberId);
    events.append({ type: "terminal_input", roomId: room.id, memberId, payload: {
      count: window.count,
      name: room.members.find((member) => member.id === memberId)?.displayName ?? memberId
    } });
  }
  const removeTerminalInputListener = terminal.onInput((memberId) => {
    const window = inputWindows.get(memberId);
    if (window) window.count += 1;
    else inputWindows.set(memberId, { count: 1, timer: setTimeout(() => flushInput(memberId), 1_000) });
  });
  const removeTerminalListener = terminal.onData((data) => {
    for (const listener of terminalListeners) listener(data);
  });
  const watcher = watchWorkspace(project.workspacePath, async (change) => {
    await capture?.external(change);
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
    rooms,
    chat,
    documents,
    terminal,
    knowledge,
    capture,
    room,
    onWorkspaceChanged(listener: (change: WorkspaceChange) => void) {
      workspaceListeners.add(listener);
      return () => workspaceListeners.delete(listener);
    },
    onChatMessage(listener: (message: ChatMessage) => void) {
      return chat.onMessage(listener);
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
    onKnowledgeChanged(listener: (change: { cardId: string; action: string }) => void) {
      knowledgeChangedListeners.add(listener);
      return () => knowledgeChangedListeners.delete(listener);
    },
    onKnowledgeNotification(listener: (memberId: string, message: ServerMessage) => void) {
      knowledgeNotificationListeners.add(listener);
      return () => knowledgeNotificationListeners.delete(listener);
    },
    onTerminalData(listener: (data: string) => void) {
      terminalListeners.add(listener);
      return () => terminalListeners.delete(listener);
    },
    async dispose() {
      workspaceListeners.clear();
      suppressedWorkspaceChanges = [];
      fileSavedListeners.clear();
      knowledgeChangedListeners.clear();
      knowledgeNotificationListeners.clear();
      terminalListeners.clear();
      removeTerminalListener();
      removeTerminalInputListener();
      for (const memberId of inputWindows.keys()) flushInput(memberId);
      await documents.awaitIdle();
      await capture?.dispose();
      await knowledge?.awaitIdle();
      await chat.awaitIdle();
      await events.awaitIdle();
      terminal.dispose();
      await watcher.close();
    }
  };
}

export type ProjectRuntime = ReturnType<typeof createProjectRuntime>;
