import type {
  CursorPosition,
  EditorSelection
} from "@simplercp/shared";

export type {
  AgentFileChange,
  AgentPromptContext,
  AgentRun,
  AgentSession,
  AgentRunStatus,
  AgentRuntimeStatus,
  AgentSettings,
  AgentSettingsResponse,
  AgentTraceEvent,
  ChatMessage,
  ClientMessage,
  CursorPosition,
  EditRange,
  EditorSelection,
  EventRecord,
  FileEditActivity,
  FileEditChange,
  ProjectRecord,
  ProjectSource,
  RoomConnection,
  RoomMember,
  RoomState,
  ServerMessage,
  WorkspaceChange,
  WorkspaceDirectoryNode,
  WorkspaceFileLoadResult,
  WorkspaceFileNode,
  WorkspaceNode
} from "@simplercp/shared";

export interface RemoteCursor {
  memberId: string;
  displayName: string;
  path: string;
  position: CursorPosition;
  selection: EditorSelection;
}
