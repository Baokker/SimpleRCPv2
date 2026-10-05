import type * as Monaco from "monaco-editor";
// Monaco 0.49 导出该内部模块用于读取实际历史编辑范围。
// @ts-expect-error Monaco 没有为内部模块发布声明。
import { SingleModelEditStackData, type ModelHistoryData } from "monaco-editor/esm/vs/editor/common/model/editStack.js";

interface HistoryElement {
  resource?: Monaco.Uri;
  _data?: ArrayBuffer | ModelHistoryData;
  split?(): HistoryElement[];
}

interface ModelHistoryService {
  getElements(resource: Monaco.Uri): { past: HistoryElement[]; future: HistoryElement[] };
}

// Monaco 0.49 的历史适配集中在此处，序列化内容由 Monaco 自身读取。
export function historyEditRanges(model: Monaco.editor.ITextModel, action: "undo" | "redo"): Monaco.IRange[] {
  const service = (model as Monaco.editor.ITextModel & { _undoRedoService: ModelHistoryService })._undoRedoService;
  const history = service.getElements(model.uri);
  const element = (action === "undo" ? history.past : history.future).at(-1);
  if (!element) return [];
  const elements = element.split?.().filter((item) => item.resource?.toString() === model.uri.toString()) ?? [element];
  return elements.flatMap((item) => {
    const actual = (item as HistoryElement & { actual?: HistoryElement }).actual ?? item;
    if (!actual._data) throw new Error("Monaco history element does not provide text edit data");
    const data = actual._data instanceof ArrayBuffer ? SingleModelEditStackData.deserialize(actual._data) : actual._data;
    if (data.beforeEOL !== data.afterEOL) return [model.getFullModelRange()];
    return data.changes.map((change: { oldPosition: number; oldEnd: number; newPosition: number; newEnd: number }) => {
      const start = model.getPositionAt(action === "undo" ? change.newPosition : change.oldPosition);
      const end = model.getPositionAt(action === "undo" ? change.newEnd : change.oldEnd);
      return { startLineNumber: start.lineNumber, startColumn: start.column, endLineNumber: end.lineNumber, endColumn: end.column };
    });
  });
}
