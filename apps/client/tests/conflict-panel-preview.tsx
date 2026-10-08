import React from "react";
import { createRoot } from "react-dom/client";
import { ConflictGuardPanel } from "../src/components/ConflictGuardPanel";
import type { ConflictGuardState } from "../src/conflictGuardTypes";
import "../src/styles.css";

declare global {
  interface Window { __guardArchiveState: ConflictGuardState }
}

if (!window.__guardArchiveState) throw new Error("验收页面需要真实归档记录");
const container = document.getElementById("preview");
if (!container) throw new Error("缺少归档预览容器");
createRoot(container).render(<ConflictGuardPanel state={window.__guardArchiveState} projectId="archive-review" members={[]} onError={(error) => { throw error; }} onOpenSymbol={() => { throw new Error("归档预览仅用于检查记录"); }} onChat={() => { throw new Error("归档预览不提供聊天操作"); }} />);
