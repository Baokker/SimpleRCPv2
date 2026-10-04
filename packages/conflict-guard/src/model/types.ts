export type ActorRef =
  | { kind: "human"; memberId: string }
  | { kind: "agent"; runId: string; ownerId: string; teamAgent?: string }
  | { kind: "filesystem" }
  | { kind: "unknown" };

export interface TextEditOp {
  from: number;
  deleted: string;
  inserted: string;
}

export interface TextEdit {
  file: string;
  origin: ActorRef;
  at: number;
  ops: TextEditOp[];
  revisionAfter: number;
  textBefore: string;
  textAfter: string;
}

export interface TrackedRange {
  start: number;
  end: number;
}

export interface FileChange {
  file: string;
  baseText: string;
  ranges: TrackedRange[];
  firstTouchedAt: number;
  lastTouchedAt: number;
  symbols?: unknown;
}

export type BatchCloseReason = "idle" | "cursor-left" | "max-duration" | "file-retired" | "flush";

export interface EditBatch {
  id: string;
  actor: ActorRef;
  file: string;
  startedAt: number;
  endedAt: number;
  closeReason: BatchCloseReason;
  ranges: TrackedRange[];
  textBefore: string;
  textAfter: string;
}

export interface ActiveChangeSet {
  actor: ActorRef;
  files: Map<string, FileChange>;
  status: "editing" | "settled" | "closed";
}

export interface CursorChange {
  actor: Extract<ActorRef, { kind: "human" }>;
  file: string;
  lineNumber: number;
  column: number;
  selection?: {
    startLineNumber: number;
    startColumn: number;
    endLineNumber: number;
    endColumn: number;
  };
  at: number;
}

export type ConflictGuardEvent =
  | { type: "edit"; edit: TextEdit }
  | { type: "batch_opened"; batch: EditBatch }
  | { type: "batch_closed"; batch: EditBatch }
  | { type: "change_set_opened"; changeSet: ActiveChangeSet }
  | { type: "change_set_closed"; changeSet: ActiveChangeSet }
  | { type: "cursor"; cursor: CursorChange };
