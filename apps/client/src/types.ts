import type {
  CursorPosition,
  EditorSelection
} from "@simplercp/shared";
import type { KnowledgeEvolutionEntry, KnowledgeProvenance } from "@simplercp/knowledge/schema";

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
  ProjectParticipant,
  ProjectSource,
  RoomConnection,
  RoomMember,
  RoomState,
  ServerMessage,
  TerminalClientMessage,
  TerminalServerMessage,
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

export type KnowledgeCardType = "decision" | "constraint" | "risk" | "context" | "negative" | "tutorial";
export type KnowledgeCardStatus = "draft" | "reviewed" | "needsReview" | "archived" | "orphaned" | "superseded";
export type KnowledgeScope = "personal" | "proposedTeam" | "team";

export interface KnowledgeAnchor {
  anchorId: string;
  file: { workspaceRelativePath: string };
  associationLevel: "block" | "symbol" | "file";
  snapshot: { text: string; sha256?: string };
  rangeAtCapture?: { start: { line: number; character: number }; end: { line: number; character: number } };
}

export interface KnowledgeCard {
  schemaVersion: number;
  id: string;
  type: KnowledgeCardType;
  title: string;
  summary: string;
  content: string;
  fallback?: boolean;
  status: KnowledgeCardStatus;
  tags: string[];
  createdAt: number;
  updatedAt: number;
  scope?: KnowledgeScope;
  ownerMemberId?: string;
  metadata?: { createdBy?: { peerId: string; name?: string } };
  provenance?: KnowledgeProvenance;
  review?: { confirmedBy: string[]; confirmedAt?: number };
  relations?: Array<{ kind: "supersedes" | "contradicts" | "duplicates" | "refines"; cardId: string }>;
  appliesTo?: { kind: "project" } | { kind: "glob"; patterns: string[] };
  check?: { kind: "regex-absent" | "regex-present"; pattern: string; flags?: string; fileGlob: string };
  anchors: KnowledgeAnchor[];
  evolution: KnowledgeEvolutionEntry[];
  usage?: { injectedCount: number; toolHitCount: number; recurrenceCount: number; lastUsedAt?: number };
}

export interface KnowledgeAnchorResolution {
  cardId: string;
  anchorIndex: number;
  range?: { startLine: number; startColumn: number; endLine: number; endColumn: number };
  status: "ok" | "moved" | "needsReview";
  strategy?: "yjs" | "range" | "snapshot" | "fingerprint";
  confidence: number;
  reason?: "missing" | "changed";
}

export interface KnowledgeGuideItem {
  card: KnowledgeCard;
  isCurrentFile: boolean;
}

export interface KnowledgeTimelineItem {
  card: KnowledgeCard;
  kind: "created" | "updated" | "evolution";
  at: number;
  label: string;
  evolution?: KnowledgeEvolutionEntry;
}

export interface SuggestedKnowledgeAnchor { file: string; startLine: number; endLine: number; score: number; reasons: string[]; }
export interface KnowledgeRiskWarning { id: string; cardId: string; file: string; createdAt: number; seen: boolean; }
export interface KnowledgeSuggestion {
  origin?: string; suggestedTitle?: string;
  id: string; triggerType: string; createdAt: number; state?: string;
  actors: { memberIds: string[]; runIds: string[] }; evidence: Record<string, unknown>;
  suggestedSummary?: string; suggestedAnchors?: SuggestedKnowledgeAnchor[];
  dedupe?: { cardId: string; score: number };
  seenBy?: string[];
  ai?: { provider?: string; model?: string; fallback: boolean };
}
export interface KnowledgeCardInput {
  type: KnowledgeCardType; title: string; summary: string; content: string; tags: string[]; scope: "personal" | "proposedTeam" | "team";
  anchors?: Array<{ file: string; associationLevel?: "block" | "file"; selection?: { startLineNumber: number; startColumn: number; endLineNumber: number; endColumn: number }; startLine?: number; endLine?: number }>; retainAnchorIds?: string[]; authorMemberId?: string; authorName?: string;
  appliesTo?: { kind: "project" } | { kind: "glob"; patterns: string[] } | null;
  aiAssisted?: boolean;
  check?: { kind: "regex-absent" | "regex-present"; pattern: string; flags?: string; fileGlob: string };
}

export interface KnowledgeActivityItem {
  id: string; at: number; category: "capture" | "confirmation" | "application" | "evolution";
  memberId?: string; memberName?: string; text: string; cardId?: string; suggestionId?: string; runId?: string; triggerType?: string; participantIds?: string[];
}
