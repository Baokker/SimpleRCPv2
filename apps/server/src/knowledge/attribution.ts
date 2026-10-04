import { applyCaptureOps, type CaptureEditOp } from "@simplercp/knowledge";
import type * as Y from "yjs";
import type { CollaborativeDocumentStore } from "../collaborativeDocuments.js";
import { FILESYSTEM_ORIGIN } from "../textDelta.js";

export interface AttributedEdit { file: string; actor: string; ops: CaptureEditOp[]; textBefore: string; textAfter: string; revisionAfter: number; }
export function createEditAttribution(options: {
  documents: CollaborativeDocumentStore;
  onOpen(file: string, text: string): void;
  onEdit(edit: AttributedEdit): void;
  onRetired(file: string): void;
  onMirrorResync(file: string, text: string): void;
}) {
  const identities = new WeakMap<object, { projectId: string; memberId: string }>();
  const observers = new Map<string, () => void>();
  const removePrepared = options.documents.onPrepared((file, document) => {
    observers.get(file)?.();
    const text = document.getText("content");
    let mirror = text.toString();
    options.onOpen(file, mirror);
    const observe = (event: Y.YTextEvent, transaction: Y.Transaction) => {
      const before = mirror;
      const ops = deltaOperations(before, event.delta);
      mirror = applyCaptureOps(before, ops);
      const after = text.toString();
      if (mirror !== after) { mirror = after; options.onMirrorResync(file, after); return; }
      const actor = transaction.origin === FILESYSTEM_ORIGIN ? "filesystem" : transaction.origin && typeof transaction.origin === "object" ? identities.get(transaction.origin)?.memberId ?? "unknown" : "unknown";
      options.onEdit({ file, actor, ops, textBefore: before, textAfter: after, revisionAfter: options.documents.getRevision(file) + (actor === "filesystem" ? 0 : 1) });
    };
    text.observe(observe);
    const remove = () => { text.unobserve(observe); document.off("destroy", onDestroy); if (observers.get(file) === remove) observers.delete(file); };
    const onDestroy = () => { remove(); options.onRetired(file); };
    document.on("destroy", onDestroy);
    observers.set(file, remove);
  });
  const removeRetired = options.documents.onRetired(file => { observers.get(file)?.(); options.onRetired(file); });
  return {
    bind(connection: object, identity: { projectId: string; memberId: string }) { identities.set(connection, identity); },
    unbind(connection: object) { identities.delete(connection); },
    dispose() { removePrepared(); removeRetired(); for (const remove of observers.values()) remove(); }
  };
}

export function deltaOperations(before: string, delta: Array<{ retain?: number; insert?: string | object; delete?: number }>): CaptureEditOp[] {
  let offset = 0;
  const ops: CaptureEditOp[] = [];
  for (const item of delta) {
    if (item.retain) offset += item.retain;
    else if (item.delete) {
      const previous = ops.at(-1);
      if (previous && previous.start + previous.deleteCount === offset) { previous.deletedText = (previous.deletedText ?? "") + before.slice(offset, offset + item.delete); previous.deleteCount += item.delete; }
      else ops.push({ start: offset, deleteCount: item.delete, insertText: "", deletedText: before.slice(offset, offset + item.delete) });
      offset += item.delete;
    } else if (typeof item.insert === "string") {
      const previous = ops.at(-1);
      if (previous && previous.start + previous.deleteCount === offset) previous.insertText += item.insert;
      else ops.push({ start: offset, deleteCount: 0, insertText: item.insert });
    } else if (item.insert !== undefined) throw new Error("Collaborative content must contain text");
  }
  return ops;
}
