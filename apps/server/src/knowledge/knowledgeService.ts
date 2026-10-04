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
  type KnowledgeAnchor,
  type KnowledgeCard,
  type KnowledgeCardStatus,
  type KnowledgeCardType,
  type KnowledgeEvolutionEntry,
  type KnowledgeScope,
  type RelativeTextPosition,
  type TextRange
} from "@simplercp/knowledge";
import type { Identity } from "../auth/identity.js";
import type { CollaborativeDocumentStore } from "../collaborativeDocuments.js";
import type { EventLog } from "../eventLog.js";

const require = createRequire(import.meta.url);
const YRuntime = require("yjs") as typeof Y;
import { readJsonFile, writeJsonFileAtomically } from "../jsonFile.js";
import { readWorkspaceFile } from "../workspace.js";

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

  async function currentDocument(file: string) {
    const normalized = normalizeWorkspaceRelativePath(file);
    const name = `${options.projectId}|${options.roomId}:${normalized}`;
    const document = await options.documents.getPreparedDocument(name);
    if (document) {
      return { text: document.getText("content").toString(), document, epoch: options.documents.getDocumentEpoch(document) };
    }
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

  async function anchorFromInput(input: { file: string; selection: KnowledgeAnchorSelection }) {
    const current = await currentDocument(input.file);
    return createAnchor(input.file, current.text, toTextRange(input.selection), current.document, current.epoch);
  }

  function anchorInputs(value: unknown) {
    if (value === undefined) return [] as Array<{ file: string; selection: KnowledgeAnchorSelection }>;
    if (!Array.isArray(value)) throw new Error("Card anchors must be an array");
    return value.map((input, index) => {
      if (!input || typeof input !== "object" || typeof (input as { file?: unknown }).file !== "string" || !(input as { selection?: unknown }).selection) {
        throw new Error(`Card anchor ${index} is invalid`);
      }
      return {
        file: (input as { file: string }).file,
        selection: (input as { selection: KnowledgeAnchorSelection }).selection
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
          if (confidence >= ANCHOR_SIMILARITY_THRESHOLD) {
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

  async function resolveCards(viewer: Identity | KnowledgeActor, file: string) {
    return enqueue(async () => {
      const normalized = normalizeWorkspaceRelativePath(file);
      const cards = await list(viewer, { file: normalized });
      const current = await currentDocument(normalized);
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

  async function get(viewer: Identity | KnowledgeActor, id: string) {
    const stored = await readCard(id);
    if (!stored || !visible(stored.card, viewer)) return undefined;
    return stored.card;
  }

  async function create(actor: KnowledgeActor, draft: Record<string, unknown>) {
    return enqueue(async () => {
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
  }

  async function update(actor: KnowledgeActor, id: string, patch: Record<string, unknown>) {
    return enqueue(async () => {
      const stored = await readCard(id);
      if (!stored || !visible(stored.card, actor)) throw new KnowledgeCardNotFoundError("Knowledge card not found");
      if (!canEdit(stored.card, actor)) throw new Error("Knowledge card can only be edited by its owner or confirmer");
      const card = { ...stored.card };
      if (patch.type !== undefined) {
        if (!['decision', 'constraint', 'risk', 'context', 'negative', 'tutorial'].includes(String(patch.type))) throw new Error("Card type is invalid");
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
        if (patch.scope !== "personal" && patch.scope !== "team") throw new Error("Card scope must be personal or team");
        card.scope = patch.scope;
      }
      if (card.scope !== "personal" && card.scope !== "team") throw new Error("Card scope must be personal or team");
      if (patch.anchors !== undefined) {
        card.anchors = [];
        for (const input of anchorInputs(patch.anchors)) card.anchors.push(await anchorFromInput(input));
      }
      const now = Date.now();
      const evolution: KnowledgeEvolutionEntry = { at: now, action: "updated", by: { peerId: actor.memberId, name: actor.displayName }, note: typeof patch.note === "string" ? patch.note : undefined };
      const updated: KnowledgeCard = { ...card, updatedAt: now, evolution: [...card.evolution, evolution] };
      await saveCard(updated);
      event(updated.id, "knowledge_card_updated", actor);
      return updated;
    });
  }

  async function confirm(actor: KnowledgeActor, id: string, input: { edited?: boolean }) {
    return enqueue(async () => {
      const stored = await readCard(id);
      if (!stored || !visible(stored.card, actor)) throw new KnowledgeCardNotFoundError("Knowledge card not found");
      const confirmed = confirmCard(stored.card, { memberId: actor.memberId, now: () => Date.now(), edited: input.edited, memberKind: "human" });
      await saveCard(confirmed);
      event(confirmed.id, "knowledge_card_confirmed", actor);
      return confirmed;
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
      const updated: KnowledgeCard = { ...stored.card, updatedAt: now, anchors: stored.card.anchors.map((candidate, index) => index === anchorIndex ? anchor : candidate), evolution: [...stored.card.evolution, { at: now, action: "updated", by: { peerId: actor.memberId, name: actor.displayName }, note: "reanchor" }] };
      await saveCard(updated);
      event(updated.id, "knowledge_card_updated", actor);
      return updated;
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
    const contentByType: Record<KnowledgeCardType, string> = {
      decision: "Keep createProjectStatus as the single place that derives taskCount, completedCount, and nextTask from the task list. formatProjectStatus should consume that result for terminal output.",
      constraint: "Tasks passed to createProjectStatus use a boolean completed field. Keep the task shape stable so the completed count and next task remain deterministic.",
      risk: "The nextTask expression intentionally uses the first incomplete task and falls back to All tasks complete. Changing that order changes the status shown to collaborators.",
      context: "This file is the demo workspace status model. It turns a small task list into a summary object before the command line formatter renders the result.",
      negative: "Do not calculate the formatted output directly from the task list. That would duplicate the status rules and make createProjectStatus and formatProjectStatus diverge.",
      tutorial: "Read createProjectStatus first to understand the derived fields, then read formatProjectStatus to see how those fields become the four line terminal report."
    };
    return cards.map((card) => ({ ...card, content: contentByType[card.type] ?? card.content }));
  }

  return {
    list,
    get,
    create,
    update,
    confirm,
    archive,
    reanchor,
    generateDemo,
    resolveAnchors: resolveCards,
    guide: async (viewer: Identity | KnowledgeActor, file?: string) => buildKnowledgeGuideItems(await list(viewer), file),
    timeline: async (viewer: Identity | KnowledgeActor, file?: string) => buildKnowledgeTimelineItems(await list(viewer), file),
    async awaitIdle() { await operations; },
    async initialize() { await ensureDirectories(); }
  };
}

export type KnowledgeService = ReturnType<typeof createKnowledgeService>;
