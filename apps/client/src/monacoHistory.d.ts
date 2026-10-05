declare module "monaco-editor/esm/vs/editor/common/model/editStack.js" {
  export interface ModelHistoryData {
    beforeEOL: number;
    afterEOL: number;
    changes: Array<{ oldPosition: number; oldEnd: number; newPosition: number; newEnd: number }>;
  }

  export class SingleModelEditStackData {
    static deserialize(data: ArrayBuffer): ModelHistoryData;
  }
}
