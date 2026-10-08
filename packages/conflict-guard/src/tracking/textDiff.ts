import diff from "fast-diff";
import type { TextEditOp } from "../model/types.js";

export function textDiffOps(before: string, after: string): TextEditOp[] {
  const ops: TextEditOp[] = [];
  let from = 0;
  for (const [operation, value] of diff(before, after)) {
    if (operation === diff.EQUAL) from += value.length;
    else if (operation === diff.DELETE) { ops.push({ from, deleted: value, inserted: "" }); from += value.length; }
    else ops.push({ from, deleted: "", inserted: value });
  }
  return ops;
}

export function normalizeEditOps(ops: TextEditOp[]): TextEditOp[] {
  const replacements: TextEditOp[] = [];
  for (const op of ops) {
    const previous = replacements.at(-1);
    if (previous && op.from === previous.from + previous.deleted.length) {
      previous.deleted += op.deleted;
      previous.inserted += op.inserted;
    } else replacements.push({ ...op });
  }
  return replacements.flatMap((op) => op.deleted.length && op.inserted.length ? textDiffOps(op.deleted, op.inserted).map((part) => ({ ...part, from: op.from + part.from })) : [op]);
}
