import crypto from "node:crypto";
import fs from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import diff from "fast-diff";
import type * as Y from "yjs";
import {
  LatestSchemaVersion,
  buildKnowledgeGuideItems,
  buildKnowledgeTimelineItems,
  confirmCard,
  createDemoKnowledgeCards,
  isKnowledgeCard,
  normalizeWorkspaceRelativePath,
  offsetsFromRange,
  resolveKnowledgeAnchorInText,
  searchKnowledgeCards,
  type KnowledgeAnchor,
  type KnowledgeCard,
  type KnowledgeCardStatus,
  type KnowledgeCardType,
  type KnowledgeEvolutionEntry,
  type KnowledgeScope,
  type RelativeTextPosition,
  type KnowledgeProvenance,
  type TextRange
} from "@simplercp/knowledge";
import type { Identity } from "../auth/identity.js";
import type { CollaborativeDocumentStore } from "../collaborativeDocuments.js";
import type { EventLog } from "../eventLog.js";
import type { ServerMessage } from "../types.js";

const require = createRequire(import.meta.url);
const YRuntime = require("yjs") as typeof Y;
import { readJsonFile, writeJsonFileAtomically } from "../jsonFile.js";
import { pathExists, readWorkspaceFile, resolveWorkspacePath } from "../workspace.js";

export interface KnowledgeListFilter {
  file?: string;
  type?: KnowledgeCardType;
  status?: KnowledgeCardStatus;
  scope?: KnowledgeScope;
}

export interface KnowledgeAnchorResolution {
  cardId: string;
  anchorIndex: number;
  range?: { startLine: number; startColumn: number; endLine: number; endColumn: number };
  status: "ok" | "moved" | "needsReview";
  strategy?: "yjs" | "range" | "snapshot" | "fingerprint";
  confidence: number;
}

export interface KnowledgeAnchorSelection {
  startLineNumber: number;
  startColumn: number;
  endLineNumber: number;
  endColumn: number;
}

export interface KnowledgeActor {
  memberId: string;
  displayName: string;
  role?: string;
}

interface KnowledgeServiceOptions {
  projectId: string;
  roomId: string;
  workspaceRoot: string;
  metadataRoot: string;
  documents: CollaborativeDocumentStore;
  events: EventLog;
  onChanged?(change: { cardId: string; action: string }): void;
  onNotify?(memberId: string, message: ServerMessage): void;
  onCardConfirmed?(card: KnowledgeCard): Promise<void> | void;
  orphanedAfterMs?: number;
  requireSecondConfirmForTeam?: boolean;
}

interface StoredCard {
  card: KnowledgeCard;
  filePath: string;
}

interface RelativePositionJson {
  tname?: string;
  item?: { client: number; clock: number };
  assoc?: number;
}

const ANCHOR_SIMILARITY_THRESHOLD = 0.65;

class KnowledgeCardNotFoundError extends Error {
  readonly statusCode = 404;
}

export function createKnowledgeService(options: KnowledgeServiceOptions) {
  const cardsDirectory = path.join(options.metadataRoot, "knowledge", "cards");
  const inboxDirectory = path.join(options.metadataRoot, "knowledge", "inbox");
  let operations = Promise.resolve();

  function enqueue<T>(operation: () => Promise<T>) {
    const result = operations.then(operation);
    operations = result.then(() => undefined, () => undefined);
    return result;
  }

  async function ensureDirectories() {
    await fs.mkdir(cardsDirectory, { recursive: true, mode: 0o700 });
    await fs.mkdir(inboxDirectory, { recursive: true, mode: 0o700 });
  }

  async function readCards(): Promise<StoredCard[]> {
    await ensureDirectories();
    const entries = await fs.readdir(cardsDirectory, { withFileTypes: true });
    const stored: StoredCard[] = [];
    for (const entry of entries.filter((candidate) => candidate.isFile() && candidate.name.endsWith(".json"))) {
      const filePath = path.join(cardsDirectory, entry.name);
      const value = await readJsonFile<unknown>(filePath);
      if (!isKnowledgeCard(value)) throw new Error(`Invalid knowledge card: ${entry.name}`);
      stored.push({ card: value, filePath });
    }
    stored.sort((left, right) => right.card.updatedAt - left.card.updatedAt);
    return stored;
  }

  async function readCard(id: string) {
    const filePath = cardFilePath(id);
    const value = await readJsonFile<unknown>(filePath);
    if (value === undefined) return undefined;
    if (!isKnowledgeCard(value)) throw new Error(`Invalid knowledge card: ${id}`);
    return { card: value, filePath } satisfies StoredCard;
  }

  async function saveCard(card: KnowledgeCard) {
    if (!isKnowledgeCard(card)) throw new Error("Knowledge card is invalid");
    await ensureDirectories();
    await writeJsonFileAtomically(cardFilePath(card.id), card);
  }

  function cardFilePath(id: string) {
    if (!/^[A-Za-z0-9_-]+$/.test(id)) throw new Error("Knowledge card id is invalid");
    return path.join(cardsDirectory, `${id}.json`);
  }

  function visible(card: KnowledgeCard, viewer: Identity | KnowledgeActor) {
    if (card.scope === "personal" || card.scope === "proposedTeam") {
      return card.ownerMemberId === viewer.memberId;
    }
    return true;
  }

  function canEdit(card: KnowledgeCard, actor: KnowledgeActor) {
    return card.ownerMemberId === actor.memberId || (card.review?.confirmedBy ?? []).includes(actor.memberId);
  }

  function event(cardId: string, type: string, actor: KnowledgeActor) {
    options.events.append({
      type,
      roomId: options.roomId,
      memberId: actor.memberId,
      payload: { cardId }
    });
    options.onChanged?.({ cardId, action: type.replace("knowledge_card_", "") });
  }

  async function currentDocument(file: string, allowMissing = false) {
    const normalized = normalizeWorkspaceRelativePath(file);
    const name = `${options.projectId}|${options.roomId}:${normalized}`;
    const document = await options.documents.getPreparedDocument(name);
    if (document) {
      return { text: document.getText("content").toString(), document, epoch: options.documents.getDocumentEpoch(document) };
    }
    const absolutePath = resolveWorkspacePath(options.workspaceRoot, normalized);
    if (allowMissing && !(await pathExists(absolutePath))) return { text: "", document: undefined, epoch: undefined };
    const loaded = await readWorkspaceFile(options.workspaceRoot, normalized, true);
    if (loaded.status !== "text") throw new Error("Knowledge anchors require a text file");
    return { text: loaded.content, document: undefined, epoch: undefined };
  }

  function toTextRange(selection: KnowledgeAnchorSelection | { start: { line: number; character: number }; end: { line: number; character: number } }): TextRange {
    if ("start" in selection && "end" in selection) {
      if (![selection.start.line, selection.start.character, selection.end.line, selection.end.character].every(Number.isInteger) || selection.start.line < 0 || selection.start.character < 0 || selection.end.line < selection.start.line || selection.end.character < 0) {
        throw new Error("Anchor selection is invalid");
      }
      return selection;
    }
    if (![selection.startLineNumber, selection.startColumn, selection.endLineNumber, selection.endColumn].every(Number.isInteger)) {
      throw new Error("Anchor selection is invalid");
    }
    if (selection.startLineNumber < 1 || selection.endLineNumber < selection.startLineNumber || selection.startColumn < 1 || selection.endColumn < 1) {
      throw new Error("Anchor selection is invalid");
    }
    return {
      start: { line: selection.startLineNumber - 1, character: selection.startColumn - 1 },
      end: { line: selection.endLineNumber - 1, character: selection.endColumn - 1 }
    };
  }

  function encodeRelative(position: Y.RelativePosition): RelativeTextPosition {
    const json = YRuntime.relativePositionToJSON(position) as RelativePositionJson;
    const item = json.item ? `${json.item.client}:${json.item.clock}` : undefined;
    return { type: json.tname ?? "content", item, assoc: json.assoc };
  }

  function decodeRelative(position: RelativeTextPosition) {
    const [clientText, clockText] = position.item?.split(":") ?? [];
    const client = clientText === undefined ? undefined : Number(clientText);
    const clock = clockText === undefined ? undefined : Number(clockText);
    const json: RelativePositionJson = {
      tname: position.type,
      assoc: position.assoc
    };
    if (position.item !== undefined) {
      if (!/^\d+:\d+$/.test(position.item) || !Number.isSafeInteger(client) || !Number.isSafeInteger(clock)) throw new Error("Knowledge relative position is invalid");
      json.item = new YRuntime.ID(client as number, clock as number) as unknown as { client: number; clock: number };
    }
    return YRuntime.createRelativePositionFromJSON(json);
  }

  function createAnchor(file: string, text: string, range: TextRange, document?: Y.Doc, epoch?: string): KnowledgeAnchor {
    const offsets = offsetsFromRange(text, range);
    if (!offsets || offsets.endOffset <= offsets.startOffset) throw new Error("Anchor selection is empty or outside the file");
    const snapshotText = text.slice(offsets.startOffset, offsets.endOffset);
    const prefix = text.slice(Math.max(0, offsets.startOffset - 120), offsets.startOffset);
    const suffix = text.slice(offsets.endOffset, Math.min(text.length, offsets.endOffset + 120));
    const landmarkLines = snapshotText.split(/\r?\n/g).map((line) => line.trim()).filter(Boolean).slice(0, 5);
    const anchor: KnowledgeAnchor = {
      anchorId: crypto.randomUUID(),
      file: { workspaceRelativePath: normalizeWorkspaceRelativePath(file) },
      associationLevel: offsets.startOffset === 0 && offsets.endOffset === text.length ? "file" : "block",
      rangeAtCapture: range,
      snapshot: { text: snapshotText, sha256: crypto.createHash("sha256").update(snapshotText).digest("hex") },
      fingerprint: { prefix, suffix, landmarkLines }
    };
    if (document && epoch) {
      const ytext = document.getText("content");
      anchor.yjsRelative = {
        start: encodeRelative(YRuntime.createRelativePositionFromTypeIndex(ytext, offsets.startOffset)),
        end: encodeRelative(YRuntime.createRelativePositionFromTypeIndex(ytext, offsets.endOffset)),
        docEpoch: epoch
      };
    }
    return anchor;
  }

  async function anchorFromInput(input: { file: string; selection?: KnowledgeAnchorSelection; startLine?: number; endLine?: number }) {
    const current = await currentDocument(input.file);
    if (input.selection) return createAnchor(input.file, current.text, toTextRange(input.selection), current.document, current.epoch);
    if (!Number.isInteger(input.startLine) || !Number.isInteger(input.endLine) || input.startLine! < 1 || input.endLine! < input.startLine!) throw new Error("Suggested anchor range is invalid");
    const lines = current.text.split("\n");
    if (input.startLine! > lines.length) throw new Error("Suggested anchor needs reselection");
    const endLine = Math.min(input.endLine!, lines.length) - 1;
    return createAnchor(input.file, current.text, { start: { line: input.startLine! - 1, character: 0 }, end: { line: endLine, character: lines[endLine]!.replace(/\r$/, "").length } }, current.document, current.epoch);
  }

  function anchorInputs(value: unknown) {
    if (value === undefined) return [] as Array<{ file: string; selection?: KnowledgeAnchorSelection; startLine?: number; endLine?: number }>;
    if (!Array.isArray(value)) throw new Error("Card anchors must be an array");
    return value.map((input, index) => {
      if (!input || typeof input !== "object" || typeof (input as { file?: unknown }).file !== "string") {
        throw new Error(`Card anchor ${index} is invalid`);
      }
      return {
        file: (input as { file: string }).file,
        selection: (input as { selection?: KnowledgeAnchorSelection }).selection,
        startLine: (input as { startLine?: number }).startLine,
        endLine: (input as { endLine?: number }).endLine
      };
    });
  }

  function lineColumnAt(text: string, offset: number) {
    const safeOffset = Math.max(0, Math.min(offset, text.length));
    let line = 1;
    let lineStart = 0;
    for (let index = 0; index < safeOffset; index += 1) {
      if (text[index] === "\n") {
        line += 1;
        lineStart = index + 1;
      }
    }
    return { line, column: safeOffset - lineStart + 1 };
  }

  function toEditorRange(text: string, startOffset: number, endOffset: number) {
    const start = lineColumnAt(text, startOffset);
    const end = lineColumnAt(text, endOffset);
    return { startLine: start.line, startColumn: start.column, endLine: end.line, endColumn: end.column };
  }

  function similarity(left: string, right: string) {
    if (left === right) return 1;
    if (!left || !right) return 0;
    const unchanged = diff(left, right).reduce((length, [operation, value]) => length + (operation === diff.EQUAL ? value.length : 0), 0);
    return unchanged / Math.max(left.length, right.length);
  }

  function resolveOne(card: KnowledgeCard, anchorIndex: number, anchor: KnowledgeAnchor, text: string, document?: Y.Doc, epoch?: string): KnowledgeAnchorResolution {
    if (document && epoch && anchor.yjsRelative?.docEpoch === epoch) {
      try {
        const start = YRuntime.createAbsolutePositionFromRelativePosition(decodeRelative(anchor.yjsRelative.start), document);
        const end = YRuntime.createAbsolutePositionFromRelativePosition(decodeRelative(anchor.yjsRelative.end), document);
        if (start && end && start.type === end.type && start.type === document.getText("content")) {
          const startOffset = start.index;
          const endOffset = end.index;
          const slice = text.slice(startOffset, endOffset);
          const confidence = similarity(anchor.snapshot.text, slice);
          if (confidence >= ANCHOR_SIMILARITY_THRESHOLD && changedLineRatio(anchor.snapshot.text, slice) <= 0.5) {
            return { cardId: card.id, anchorIndex, range: toEditorRange(text, startOffset, endOffset), status: "ok", strategy: "yjs", confidence };
          }
        }
      } catch (error) {
        if (!(error instanceof Error)) throw error;
      }
    }

    const resolved = resolveKnowledgeAnchorInText(text, anchor);
    if (!resolved || resolved.confidence < ANCHOR_SIMILARITY_THRESHOLD) {
      const lines = text.split("\n");
      const line = Math.min(anchor.rangeAtCapture?.start.line ?? 0, lines.length - 1);
      const column = Math.min(anchor.rangeAtCapture?.start.character ?? 0, lines[line]!.replace(/\r$/, "").length);
      return {
        cardId: card.id,
        anchorIndex,
        range: { startLine: line + 1, startColumn: column + 1, endLine: line + 1, endColumn: column + 1 },
        status: "needsReview",
        confidence: resolved?.confidence ?? 0
      };
    }
    const captured = anchor.rangeAtCapture ? offsetsFromRange(text, anchor.rangeAtCapture) : undefined;
    if (changedLineRatio(anchor.snapshot.text, text.slice(resolved.startOffset, resolved.endOffset)) > 0.5) {
      return {
        cardId: card.id,
        anchorIndex,
        range: toEditorRange(text, resolved.startOffset, resolved.endOffset),
        status: "needsReview",
        confidence: resolved.confidence
      };
    }
    const strategy = captured && captured.startOffset === resolved.startOffset && captured.endOffset === resolved.endOffset
      ? "range"
      : text.indexOf(anchor.snapshot.text) === resolved.startOffset && text.indexOf(anchor.snapshot.text, resolved.startOffset + 1) === -1
        ? "snapshot"
        : "fingerprint";
    if (document && epoch) {
      const refreshed = createAnchor(anchor.file.workspaceRelativePath, text, {
        start: offsetToTextPosition(text, resolved.startOffset),
        end: offsetToTextPosition(text, resolved.endOffset)
      }, document, epoch);
      anchor.yjsRelative = refreshed.yjsRelative;
    }
    return {
      cardId: card.id,
      anchorIndex,
      range: toEditorRange(text, resolved.startOffset, resolved.endOffset),
      status: strategy === "range" ? "ok" : "moved",
      strategy,
      confidence: resolved.confidence
    };
  }

  function offsetToTextPosition(text: string, offset: number) {
    const point = lineColumnAt(text, offset);
    return { line: point.line - 1, character: point.column - 1 };
  }

  function changedLineRatio(before: string, after: string) {
    const beforeLines = before.split(/\r?\n/);
    const afterLines = after.split(/\r?\n/);
    const total = Math.max(beforeLines.length, afterLines.length);
    if (!total) return 0;
    if (beforeLines.length === afterLines.length) {
      if (total > 1) {
        const changedLines = beforeLines.reduce((count, line, index) => count + (line === afterLines[index] ? 0 : 1), 0);
        return changedLines / total;
      }
      const unchangedCharacters = diff(before, after).reduce((count, [operation, value]) => count + (operation === diff.EQUAL ? value.length : 0), 0);
      return 1 - unchangedCharacters / Math.max(1, Math.max(before.length, after.length));
    }
    let changed = 0;
    for (let index = 0; index < total; index += 1) if (beforeLines[index] !== afterLines[index]) changed += 1;
    return changed / total;
  }

  async function resolveCardAnchors(cards: KnowledgeCard[], normalized: string) {
    const current = await currentDocument(normalized, true);
    const resolutions: KnowledgeAnchorResolution[] = [];
    const refreshedCards: KnowledgeCard[] = [];
    for (const card of cards) {
      let changed = false;
      for (let index = 0; index < card.anchors.length; index += 1) {
        const anchor = card.anchors[index]!;
        if (normalizeWorkspaceRelativePath(anchor.file.workspaceRelativePath) !== normalized) continue;
        const before = JSON.stringify(anchor.yjsRelative);
        const result = resolveOne(card, index, anchor, current.text, current.document, current.epoch);
        if (before !== JSON.stringify(anchor.yjsRelative)) changed = true;
        resolutions.push(result);
      }
      if (changed) refreshedCards.push(card);
    }
    for (const card of refreshedCards) await saveCard(card);
    return resolutions;
  }

  async function resolveCards(viewer: Identity | KnowledgeActor, file: string) {
    return enqueue(async () => {
      const normalized = normalizeWorkspaceRelativePath(file);
      const cards = await list(viewer, { file: normalized });
      return resolveCardAnchors(cards, normalized);
    });
  }

  async function list(viewer: Identity | KnowledgeActor, filter: KnowledgeListFilter = {}) {
    const normalizedFile = filter.file ? normalizeWorkspaceRelativePath(filter.file) : undefined;
    const cards = (await readCards()).map(({ card }) => card).filter((card) => visible(card, viewer));
    return cards.filter((card) => {
      if (filter.type && card.type !== filter.type) return false;
      if (filter.status && card.status !== filter.status) return false;
      if (filter.scope && card.scope !== filter.scope) return false;
      if (normalizedFile && !card.anchors.some((anchor) => normalizeWorkspaceRelativePath(anchor.file.workspaceRelativePath) === normalizedFile)) return false;
      return true;
    });
  }

  async function listPendingTeam(viewer: Identity | KnowledgeActor) {
    const cards = (await readCards()).map(({ card }) => card).filter((card) => card.scope === "proposedTeam" && card.status === "reviewed" && card.ownerMemberId !== viewer.memberId);
    return cards;
  }

  async function get(viewer: Identity | KnowledgeActor, id: string) {
    const stored = await readCard(id);
    if (!stored || !visible(stored.card, viewer)) return undefined;
    return stored.card;
  }

  async function relationCandidates(viewer: Identity | KnowledgeActor, id: string) {
    const source = await get(viewer, id);
    if (!source || source.scope !== "team" || source.status !== "reviewed") return [];
    const cards = (await list(viewer, { scope: "team", status: "reviewed" })).filter((card) => card.id !== id);
    const results = await searchKnowledgeCards({
      cards,
      workspaceId: options.projectId,
      indexDir: path.join(options.metadataRoot, "knowledge", "index"),
      query: `${source.title}\n${source.summary}\n${source.content}`,
      filters: { statuses: ["reviewed"] },
      topK: 5
    });
    const byId = new Map(cards.map((card) => [card.id, card]));
    return results.flatMap((result) => {
      const card = byId.get(result.cardId);
      return card ? [{ card, score: result.score }] : [];
    });
  }

  async function create(actor: KnowledgeActor, draft: Record<string, unknown>) {
    const created = await enqueue(async () => {
      const type = draft.type as KnowledgeCardType;
      if (!["decision", "constraint", "risk", "context", "negative", "tutorial"].includes(type)) throw new Error("Card type is invalid");
      if (typeof draft.title !== "string" || typeof draft.summary !== "string" || (draft.content !== undefined && typeof draft.content !== "string")) throw new Error("Card title, summary and content must be text");
      if (draft.tags !== undefined && (!Array.isArray(draft.tags) || draft.tags.some((tag) => typeof tag !== "string"))) throw new Error("Card tags are invalid");
      const title = draft.title.trim();
      const summary = draft.summary.trim();
      const content = draft.content ?? "";
      if (!title || !summary) throw new Error("Card title and summary are required");
      const scope = draft.scope === "personal" ? "personal" : draft.scope === "team" ? "team" : undefined;
      if (!scope) throw new Error("Card scope must be personal or team");
      const anchors: KnowledgeAnchor[] = [];
      for (const input of anchorInputs(draft.anchors)) anchors.push(await anchorFromInput(input));
      const now = Date.now();
      const appliesTo = normalizeAppliesTo(draft.appliesTo);
      const check = normalizeCheck(draft.check, type);
      const card: KnowledgeCard = {
        schemaVersion: LatestSchemaVersion,
        id: crypto.randomUUID(),
        type,
        title,
        summary,
        content,
        source: "manual",
        status: "reviewed",
        tags: draft.tags as string[] | undefined ?? [],
        createdAt: now,
        updatedAt: now,
        metadata: { createdBy: { peerId: actor.memberId, name: actor.displayName }, roomId: options.roomId },
        provenance: { origin: "manual", author: { kind: "human", memberId: actor.memberId, displayName: actor.displayName }, evidenceRefs: {} },
        review: { confirmedBy: [actor.memberId], confirmedAt: now, editedBeforeConfirm: false },
        scope,
        ownerMemberId: actor.memberId,
        ...(appliesTo ? { appliesTo } : {}),
        ...(check ? { check } : {}),
        anchors,
        evolution: [
          { at: now, action: "created", by: { peerId: actor.memberId, name: actor.displayName } },
          { at: now, action: "confirmed", by: { peerId: actor.memberId, name: actor.displayName } }
        ]
      };
      await saveCard(card);
      event(card.id, "knowledge_card_created", actor);
      return card;
    });
    await options.onCardConfirmed?.(created);
    return created;
  }

  async function applyPatch(cardBeforeUpdate: KnowledgeCard, patch: Record<string, unknown>, actor: KnowledgeActor) {
    const card = { ...cardBeforeUpdate };
    if (patch.type !== undefined) {
      if (!["decision", "constraint", "risk", "context", "negative", "tutorial"].includes(String(patch.type))) throw new Error("Card type is invalid");
      card.type = patch.type as KnowledgeCardType;
    }
    for (const key of ["title", "summary", "content"] as const) {
      if (patch[key] !== undefined) {
        if (typeof patch[key] !== "string" || (key !== "content" && !patch[key].trim())) throw new Error(`Card ${key} is invalid`);
        card[key] = key === "content" ? patch[key] : patch[key].trim();
      }
    }
    if (patch.tags !== undefined) {
      if (!Array.isArray(patch.tags) || patch.tags.some((tag) => typeof tag !== "string")) throw new Error("Card tags are invalid");
      card.tags = patch.tags;
    }
    if (patch.scope !== undefined) {
      if (patch.scope !== "personal" && patch.scope !== "team" && patch.scope !== "proposedTeam") throw new Error("Card scope must be personal, proposedTeam or team");
      if (patch.scope === "proposedTeam" && cardBeforeUpdate.scope !== "proposedTeam") throw new Error("Cards must use the team scope request endpoint");
      if (patch.scope === "team" && cardBeforeUpdate.scope !== "team") throw new Error("Cards must use the team scope confirmation endpoint");
      card.scope = patch.scope;
    }
    if (card.scope !== "personal" && card.scope !== "team" && card.scope !== "proposedTeam") throw new Error("Card scope must be personal, proposedTeam or team");
    if (patch.anchors !== undefined) {
      card.anchors = [];
      for (const input of anchorInputs(patch.anchors)) card.anchors.push(await anchorFromInput(input));
    }
    if (patch.appliesTo !== undefined) card.appliesTo = normalizeAppliesTo(patch.appliesTo);
    if (patch.check !== undefined) card.check = normalizeCheck(patch.check, card.type);
    if (patch.authorMemberId !== undefined) {
      if (card.status !== "draft" || typeof patch.authorMemberId !== "string" || !patch.authorMemberId) throw new Error("Only draft authors can be changed");
      card.provenance = { ...card.provenance!, author: { kind: "human", memberId: patch.authorMemberId, displayName: typeof patch.authorName === "string" ? patch.authorName : patch.authorMemberId } };
    }
    const now = Date.now();
    const evolution: KnowledgeEvolutionEntry = { at: now, action: "updated", by: { peerId: actor.memberId, name: actor.displayName }, note: typeof patch.note === "string" ? patch.note : undefined };
    return { ...card, updatedAt: now, evolution: [...card.evolution, evolution] };
  }

  function normalizeAppliesTo(value: unknown) {
    if (value === undefined) return undefined;
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Card appliesTo is invalid");
    const input = value as { kind?: unknown; patterns?: unknown };
    if (input.kind === "project") return { kind: "project" } as const;
    if (input.kind === "glob" && Array.isArray(input.patterns) && input.patterns.every((pattern) => typeof pattern === "string" && pattern.length > 0)) return { kind: "glob", patterns: input.patterns } as const;
    throw new Error("Card appliesTo is invalid");
  }

  function normalizeCheck(value: unknown, cardType: KnowledgeCardType) {
    if (value === undefined) return undefined;
    if (cardType !== "constraint" && cardType !== "negative") throw new Error("Checks require constraint or negative cards");
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Card check is invalid");
    const input = value as { kind?: unknown; pattern?: unknown; flags?: unknown; fileGlob?: unknown };
    if ((input.kind !== "regex-absent" && input.kind !== "regex-present") || typeof input.pattern !== "string" || typeof input.fileGlob !== "string" || (input.flags !== undefined && typeof input.flags !== "string")) throw new Error("Card check is invalid");
    new RegExp(input.pattern, input.flags as string | undefined);
    return { kind: input.kind, pattern: input.pattern, ...(input.flags === undefined ? {} : { flags: input.flags }), fileGlob: input.fileGlob } as const;
  }

  function hasRuleContent(content: string) {
    const match = content.match(/^##[\t ]*规则[\t ]*\r?\n([\s\S]*?)(?=^##[\t ]|$(?![\s\S]))/im);
    return Boolean(match?.[1]?.trim());
  }

  async function update(actor: KnowledgeActor, id: string, patch: Record<string, unknown>) {
    return enqueue(async () => {
      const stored = await readCard(id);
      if (!stored || !visible(stored.card, actor)) throw new KnowledgeCardNotFoundError("Knowledge card not found");
      if (!canEdit(stored.card, actor)) throw new Error("Knowledge card can only be edited by its owner or confirmer");
      const updated = await applyPatch(stored.card, patch, actor);
      await saveCard(updated);
      event(updated.id, "knowledge_card_updated", actor);
      return updated;
    });
  }

  async function confirm(actor: KnowledgeActor, id: string, input: { edited?: boolean; durationMs?: number; patch?: Record<string, unknown> }) {
    const confirmed = await enqueue(async () => {
      if (actor.memberId === "agent" || actor.memberId.startsWith("agent:")) throw new Error("Agent actors cannot confirm knowledge cards");
      const stored = await readCard(id);
      if (!stored || !visible(stored.card, actor)) throw new KnowledgeCardNotFoundError("Knowledge card not found");
      if (stored.card.status !== "draft") throw new Error("Only draft knowledge cards can be confirmed");
      const card = input.patch === undefined ? stored.card : await applyPatch(stored.card, input.patch, actor);
      if (card.fallback && !hasRuleContent(card.content)) throw new Error("Fallback knowledge drafts require a rule before confirmation");
      if (stored.card.provenance?.origin === "human-agent" && card.scope === "team" && stored.card.scope !== "team") throw new Error("Agent-origin cards must use team scope confirmation");
      const edited = input.edited === true
        || (["type", "title", "summary", "content", "tags", "scope", "anchors"] as const).some(key => JSON.stringify(stored.card[key]) !== JSON.stringify(card[key]))
        || JSON.stringify(stored.card.provenance?.author) !== JSON.stringify(card.provenance?.author);
      const confirmed = confirmCard(card, { memberId: actor.memberId, now: () => Date.now(), edited, memberKind: "human" });
      await saveCard(confirmed);
      if (input.patch !== undefined) event(confirmed.id, "knowledge_card_updated", actor);
      event(confirmed.id, "knowledge_card_confirmed", actor);
      options.events.append({ type: "knowledge_review_completed", roomId: options.roomId, memberId: actor.memberId, payload: { cardId: id, editedBeforeConfirm: edited, durationMs: input.durationMs } });
      return confirmed;
    });
    await options.onCardConfirmed?.(confirmed);
    return confirmed;
  }

  async function recordInjection(id: string, viewerMemberId: string, at = Date.now()) {
    return enqueue(async () => {
      const stored = await readCard(id);
      if (!stored) return undefined;
      const usage = { injectedCount: 0, toolHitCount: 0, recurrenceCount: 0, ...stored.card.usage };
      const updated: KnowledgeCard = {
        ...stored.card,
        usage: { ...usage, injectedCount: usage.injectedCount + 1, lastUsedAt: at },
        updatedAt: stored.card.updatedAt
      };
      await saveCard(updated);
      void viewerMemberId;
      return updated;
    });
  }

  async function archive(actor: KnowledgeActor, id: string, reason?: string) {
    return enqueue(async () => {
      const stored = await readCard(id);
      if (!stored || !visible(stored.card, actor)) throw new KnowledgeCardNotFoundError("Knowledge card not found");
      if (!canEdit(stored.card, actor)) throw new Error("Knowledge card can only be archived by its owner or confirmer");
      const now = Date.now();
      const archived: KnowledgeCard = { ...stored.card, status: "archived", updatedAt: now, evolution: [...stored.card.evolution, { at: now, action: "archived", by: { peerId: actor.memberId, name: actor.displayName }, note: reason }] };
      await saveCard(archived);
      event(archived.id, "knowledge_card_archived", actor);
      return archived;
    });
  }

  async function reanchor(actor: KnowledgeActor, id: string, anchorIndex: number, selection: KnowledgeAnchorSelection) {
    return enqueue(async () => {
      const stored = await readCard(id);
      if (!stored || !visible(stored.card, actor)) throw new KnowledgeCardNotFoundError("Knowledge card not found");
      if (!canEdit(stored.card, actor)) throw new Error("Knowledge anchor can only be changed by its owner or confirmer");
      const current = stored.card.anchors[anchorIndex];
      if (!current) throw new Error("Knowledge anchor not found");
      const anchor = await anchorFromInput({ file: current.file.workspaceRelativePath, selection });
      const now = Date.now();
      const updated: KnowledgeCard = { ...stored.card, status: stored.card.status === "needsReview" || stored.card.status === "orphaned" ? "reviewed" : stored.card.status, updatedAt: now, anchors: stored.card.anchors.map((candidate, index) => index === anchorIndex ? anchor : candidate), evolution: [...stored.card.evolution, { at: now, action: stored.card.status === "needsReview" || stored.card.status === "orphaned" ? "reviewed" : "updated", by: { peerId: actor.memberId, name: actor.displayName }, note: "reanchor" }] };
      await saveCard(updated);
      event(updated.id, "knowledge_card_updated", actor);
      return updated;
    });
  }

  async function refreshExpired(actor: KnowledgeActor, file: string, orphanedAfterMs = options.orphanedAfterMs ?? 7 * 24 * 60 * 60_000) {
    const normalizedFile = normalizeWorkspaceRelativePath(file);
    const resolutions = await enqueue(async () => {
      const cards = (await readCards()).map(({ card }) => card).filter((card) => card.anchors.some((anchor) => normalizeWorkspaceRelativePath(anchor.file.workspaceRelativePath) === normalizedFile));
      return resolveCardAnchors(cards, normalizedFile);
    });
    return enqueue(async () => {
      const now = Date.now();
      const changed: KnowledgeCard[] = [];
      for (const resolution of resolutions) {
        if (resolution.status !== "needsReview") continue;
        const stored = await readCard(resolution.cardId);
        if (!stored || (stored.card.status !== "reviewed" && stored.card.status !== "needsReview")) continue;
        const reviewStartedAt = stored.card.status === "needsReview"
          ? [...stored.card.evolution].reverse().find((entry) => entry.note === "anchor review" && entry.action === "updated")?.at ?? stored.card.updatedAt
          : now;
        const status: KnowledgeCardStatus = stored.card.status === "needsReview" && now - reviewStartedAt >= orphanedAfterMs ? "orphaned" : "needsReview";
        if (status === stored.card.status) continue;
        const updated: KnowledgeCard = { ...stored.card, status, updatedAt: now, evolution: [...stored.card.evolution, { at: now, action: status === "orphaned" ? "orphaned" : "updated", by: { peerId: actor.memberId, name: actor.displayName }, note: "anchor review" }] };
        await saveCard(updated); event(updated.id, "knowledge_card_updated", actor); changed.push(updated);
        for (const memberId of new Set([updated.ownerMemberId, ...(updated.review?.confirmedBy ?? [])])) {
          if (!memberId) continue;
          options.onNotify?.(memberId, { type: "knowledge_anchor_needs_review", cardId: updated.id, file: normalizedFile, status: status as "needsReview" | "orphaned" });
        }
      }
      return changed;
    });
  }

  async function requestTeam(actor: KnowledgeActor, id: string) {
    return enqueue(async () => {
      const stored = await readCard(id);
      if (!stored || !visible(stored.card, actor) || stored.card.ownerMemberId !== actor.memberId) throw new KnowledgeCardNotFoundError("Knowledge card not found");
      if (stored.card.scope !== "personal" || stored.card.status !== "reviewed") throw new Error("Only reviewed personal cards can request team scope");
      const now = Date.now();
      const updated: KnowledgeCard = { ...stored.card, scope: "proposedTeam", updatedAt: now, evolution: [...stored.card.evolution, { at: now, action: "scopeChanged", by: { peerId: actor.memberId, name: actor.displayName }, note: "proposedTeam" }] };
      await saveCard(updated); event(updated.id, "knowledge_card_updated", actor); return updated;
    });
  }

  async function confirmTeam(actor: KnowledgeActor, id: string, requireSecondConfirm = true) {
    return enqueue(async () => {
      if (actor.memberId === "agent" || actor.memberId.startsWith("agent:")) throw new Error("Agent actors cannot confirm team scope");
      const stored = await readCard(id);
      if (!stored || (stored.card.scope !== "proposedTeam" && !visible(stored.card, actor))) throw new KnowledgeCardNotFoundError("Knowledge card not found");
      if (stored.card.scope !== "proposedTeam") throw new Error("Knowledge card is not awaiting team confirmation");
      if (stored.card.status !== "reviewed") throw new Error("Only reviewed cards can request team scope");
      if (requireSecondConfirm && stored.card.ownerMemberId === actor.memberId) throw new Error("The card owner cannot provide the second team confirmation");
      if (!requireSecondConfirm && stored.card.ownerMemberId !== actor.memberId) throw new Error("Only the card owner can confirm team scope when a second confirmation is disabled");
      const existing = stored.card.review?.confirmedBy ?? [];
      const now = Date.now();
      const updated: KnowledgeCard = { ...stored.card, scope: "team", updatedAt: now, review: { ...(stored.card.review ?? { confirmedBy: [] }), confirmedBy: [...new Set([...existing, actor.memberId])], confirmedAt: now }, evolution: [...stored.card.evolution, { at: now, action: "scopeChanged", by: { peerId: actor.memberId, name: actor.displayName }, note: "team" }] };
      await saveCard(updated); event(updated.id, "knowledge_card_updated", actor); await options.onCardConfirmed?.(updated); return updated;
    });
  }

  async function relate(actor: KnowledgeActor, id: string, relation: { kind: "supersedes" | "contradicts" | "duplicates" | "refines"; cardId: string }) {
    return enqueue(async () => {
      const stored = await readCard(id); const target = await readCard(relation.cardId);
      if (!stored || !target || !visible(stored.card, actor) || !visible(target.card, actor)) throw new KnowledgeCardNotFoundError("Knowledge card not found");
      if (stored.card.id === target.card.id) throw new Error("A card cannot relate to itself");
      if (stored.card.scope !== "team" || target.card.scope !== "team" || stored.card.status !== "reviewed" || target.card.status !== "reviewed") throw new Error("Relations require reviewed team cards");
      const now = Date.now();
      const relations = [...(stored.card.relations ?? []).filter((item) => item.cardId !== relation.cardId), relation];
      const updated: KnowledgeCard = { ...stored.card, relations, updatedAt: now, evolution: [...stored.card.evolution, { at: now, action: relation.kind === "supersedes" ? "superseded" : "updated", by: { peerId: actor.memberId, name: actor.displayName }, note: `${relation.kind}:${relation.cardId}` }] };
      const targetUpdated: KnowledgeCard = relation.kind === "supersedes" ? { ...target.card, status: "superseded", updatedAt: now, evolution: [...target.card.evolution, { at: now, action: "superseded", by: { peerId: actor.memberId, name: actor.displayName }, note: id }] } : target.card;
      await saveCard(updated); if (targetUpdated !== target.card) await saveCard(targetUpdated); event(updated.id, "knowledge_card_updated", actor); if (targetUpdated !== target.card) event(targetUpdated.id, "knowledge_card_updated", actor); return updated;
    });
  }

  async function generateDemo(actor: KnowledgeActor) {
    const entries = await fs.readdir(options.workspaceRoot, { recursive: true, withFileTypes: true });
    const candidateFiles = entries
      .filter((entry) => entry.isFile() && /\.(js|ts|tsx|py|md)$/.test(entry.name))
      .map((entry) => normalizeWorkspaceRelativePath(path.relative(options.workspaceRoot, path.join(entry.parentPath, entry.name))));
    const file = ["src/projectStatus.js", "src/index.js"].find((candidate) => candidateFiles.includes(candidate)) ?? candidateFiles[0] ?? "README.md";
    const loaded = await readWorkspaceFile(options.workspaceRoot, file, true);
    const selectedText = loaded.status === "text" ? loaded.content.slice(0, 800) : "Demo workspace knowledge anchor";
    const cards = personalizeDemoCards(createDemoKnowledgeCards({ workspaceRelativePath: file, selectedText }), file);
    return enqueue(async () => {
      const persisted: KnowledgeCard[] = [];
      for (const source of cards) {
        const now = Date.now();
        const card: KnowledgeCard = { ...source, ownerMemberId: actor.memberId, metadata: { createdBy: { peerId: actor.memberId, name: actor.displayName }, roomId: options.roomId }, provenance: { ...source.provenance!, author: { kind: "human", memberId: actor.memberId, displayName: actor.displayName }, origin: "manual", evidenceRefs: {} }, review: { confirmedBy: [actor.memberId], confirmedAt: now }, evolution: source.evolution.map((entry) => ({ ...entry, by: { peerId: actor.memberId, name: actor.displayName } })) };
        await saveCard(card);
        event(card.id, "knowledge_card_created", actor);
        persisted.push(card);
      }
      return persisted;
    });
  }

  function personalizeDemoCards(cards: KnowledgeCard[], file: string) {
    if (file !== "src/projectStatus.js") return cards;
    const templates: Record<KnowledgeCardType, Pick<KnowledgeCard, "title" | "summary" | "content">> = {
      decision: { title: "集中计算任务状态", summary: "createProjectStatus 计算任务数量、完成数量与下一项任务。", content: "createProjectStatus 从 tasks 计算 taskCount、completedCount 和 nextTask。formatProjectStatus 使用这个结果生成终端输出，任务状态规则集中在 createProjectStatus 中。" },
      constraint: { title: "保持任务字段含义", summary: "tasks 的 completed 表示完成状态，title 用于下一项任务的显示。", content: "createProjectStatus 使用 completed 筛选已完成任务，再读取首个未完成任务的 title。调用方应提供含有 boolean completed 和文本 title 的任务对象，并保持这两个字段的含义。" },
      risk: { title: "注意下一项任务的顺序", summary: "nextTask 使用第一个未完成任务，任务顺序会影响显示结果。", content: "tasks.find 返回第一个未完成任务。当这个任务没有 title，或者全部任务已完成时，nextTask 显示 All tasks complete。修改任务顺序或字段时需要核对这个显示结果。" },
      context: { title: "任务状态模块的用途", summary: "projectStatus.js 将任务列表转换为状态对象和四行终端文本。", content: "Demo 工作区使用 createProjectStatus 生成任务数量、完成数量和下一项任务，再由 formatProjectStatus 输出工作区名称、Tasks、Completed 和 Next 四行文本。" },
      negative: { title: "保持状态计算与文本格式的职责", summary: "formatProjectStatus 接收状态对象，重复计算任务状态会增加维护成本。", content: "formatProjectStatus 已经通过 status.taskCount、status.completedCount 和 status.nextTask 格式化输出。维护这个接口可以让任务计算规则集中在 createProjectStatus 中，减少规则重复。" },
      tutorial: { title: "阅读任务状态代码", summary: "从 createProjectStatus 的返回字段开始，继续阅读 formatProjectStatus。", content: "阅读 tasks.length、filter 和 find 如何生成三个状态字段，再查看 formatProjectStatus 如何把它们写入数组并通过 join 生成四行文本。可以运行 Demo 工作区的测试核对任务完成和未完成时的结果。" }
    };
    return cards.map(card => ({ ...card, ...templates[card.type], tags: ["demo", card.type, "project-status"], evolution: card.evolution.map(entry => ({ ...entry, note: "Demo 工作区任务状态导览。" })) }));
  }

  return {
    list,
    listPendingTeam,
    get,
    relationCandidates,
    create,
    createDraft(actor: KnowledgeActor, draft: { type: KnowledgeCardType; title: string; summary: string; content: string; tags: string[]; confidence?: number; fallback?: boolean; provenance: KnowledgeProvenance; source: "ai" | "event"; scope?: KnowledgeScope; anchors?: Array<{ file: string; selection: KnowledgeAnchorSelection }>; appliesTo?: KnowledgeCard["appliesTo"]; check?: KnowledgeCard["check"] }) {
      return enqueue(async () => {
        const now = Date.now();
        const anchors: KnowledgeAnchor[] = [];
        for (const input of draft.anchors ?? []) anchors.push(await anchorFromInput(input));
        const appliesTo = normalizeAppliesTo(draft.appliesTo);
        const check = normalizeCheck(draft.check, draft.type);
        const card: KnowledgeCard = {
          ...draft, ...(appliesTo ? { appliesTo } : {}), ...(check ? { check } : {}), schemaVersion: LatestSchemaVersion, id: crypto.randomUUID(), status: "draft", createdAt: now, updatedAt: now,
          metadata: { createdBy: { peerId: actor.memberId, name: actor.displayName }, roomId: options.roomId, relatedChatMessageIds: draft.provenance.evidenceRefs.chatMessageIds },
          scope: draft.scope ?? "team", ownerMemberId: actor.memberId, review: { confirmedBy: [] }, anchors,
          evolution: [{ at: now, action: "created", by: { peerId: actor.memberId, name: actor.displayName } }]
        };
        await saveCard(card);
        event(card.id, "knowledge_card_created", actor);
        return card;
      });
    },
    recordRecurrence(actor: KnowledgeActor, id: string, suggestionId: string) {
      return enqueue(async () => {
        const card = await get(actor, id);
        if (!card || card.status !== "reviewed") throw new KnowledgeCardNotFoundError("Reviewed knowledge card not found");
        if (card.evolution.some(entry => entry.action === "recurrence" && entry.note === suggestionId)) return card;
        const now = Date.now();
        const updated: KnowledgeCard = { ...card, updatedAt: now, usage: { injectedCount: 0, toolHitCount: 0, ...card.usage, recurrenceCount: (card.usage?.recurrenceCount ?? 0) + 1 }, evolution: [...card.evolution, { at: now, action: "recurrence", by: { peerId: actor.memberId, name: actor.displayName }, note: suggestionId }] };
        await saveCard(updated);
        event(id, "knowledge_card_updated", actor);
        return updated;
      });
    },
    recordInjection,
    update,
    confirm,
    archive,
    reanchor,
    refreshExpired,
    requestTeam,
    confirmTeam,
    relate,
    generateDemo,
    resolveAnchors: resolveCards,
    guide: async (viewer: Identity | KnowledgeActor, file?: string) => buildKnowledgeGuideItems(await list(viewer), file),
    timeline: async (viewer: Identity | KnowledgeActor, file?: string) => buildKnowledgeTimelineItems(await list(viewer), file),
    async awaitIdle() { await operations; },
    async initialize() { await ensureDirectories(); }
  };
}

export type KnowledgeService = ReturnType<typeof createKnowledgeService>;
