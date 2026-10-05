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
