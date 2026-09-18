import type * as Y from "yjs";
import type { EditRange, FileEditChange } from "./types";

export function summarizeTextChange(
  previousText: string,
  nextText: string,
  delta: Y.YTextEvent["delta"]
): FileEditChange {
  const ranges: EditRange[] = [];
  let previousOffset = 0;
  let nextOffset = 0;
  let addedLines = 0;
  let removedLines = 0;

  for (const operation of delta) {
    if (operation.retain !== undefined) {
      previousOffset += operation.retain;
      nextOffset += operation.retain;
    }
    if (operation.delete !== undefined) {
      const deletedText = previousText.slice(
        previousOffset,
        previousOffset + operation.delete
      );
      ranges.push({
        startLine: lineNumberAt(previousText, previousOffset),
        endLine: lineNumberAt(
          previousText,
          previousOffset + operation.delete
        )
      });
      removedLines += countLineBreaks(deletedText);
      previousOffset += operation.delete;
    }
    if (operation.insert !== undefined) {
      if (typeof operation.insert !== "string") {
        throw new Error("Collaborative editor received non-text content");
      }
      ranges.push({
        startLine: lineNumberAt(nextText, nextOffset),
        endLine: lineNumberAt(nextText, nextOffset + operation.insert.length)
      });
      addedLines += countLineBreaks(operation.insert);
      nextOffset += operation.insert.length;
    }
  }

  return {
    ranges: mergeEditRanges(ranges),
    addedLines,
    removedLines
  };
}

export function mergeFileEditChanges(
  current: FileEditChange,
  next: FileEditChange
): FileEditChange {
  return {
    ranges: mergeEditRanges([...current.ranges, ...next.ranges]),
    addedLines: current.addedLines + next.addedLines,
    removedLines: current.removedLines + next.removedLines
  };
}

function lineNumberAt(text: string, offset: number) {
  let line = 1;
  const end = Math.min(offset, text.length);
  for (let index = 0; index < end; index += 1) {
    if (text[index] === "\n") line += 1;
  }
  return line;
}

function countLineBreaks(text: string) {
  let count = 0;
  for (const character of text) {
    if (character === "\n") count += 1;
  }
  return count;
}

function mergeEditRanges(ranges: EditRange[]) {
  const sorted = [...ranges].sort(
    (left, right) => left.startLine - right.startLine
  );
  const merged: EditRange[] = [];
  for (const range of sorted) {
    const previous = merged.at(-1);
    if (previous && range.startLine <= previous.endLine + 1) {
      previous.endLine = Math.max(previous.endLine, range.endLine);
    } else {
      merged.push({ ...range });
    }
  }
  return merged;
}
