import diff from "fast-diff";
import type * as Y from "yjs";

export const FILESYSTEM_ORIGIN = Symbol("filesystem");

export function applyTextDelta(
  text: Y.Text,
  previousContent: string,
  nextContent: string
) {
  let index = 0;

  for (const [operation, value] of diff(previousContent, nextContent)) {
    if (operation === diff.EQUAL) {
      index += value.length;
      continue;
    }
    if (operation === diff.DELETE) {
      text.delete(index, value.length);
      continue;
    }
    text.insert(index, value);
    index += value.length;
  }
}
