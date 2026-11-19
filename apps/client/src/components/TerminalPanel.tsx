import { RotateCcw, ShieldCheck } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Send } from "lucide-react";
import { undoGuardSnapshot } from "../api";
import type { ThemeMode } from "../theme";
import type { GuardLlmMode, GuardSettings } from "../types";
import {
  SharedTerminal,
  type SharedTerminalHandle
} from "./SharedTerminal";

export function TerminalPanel({
  projectId,
  theme,
  canRun,
  memberId,
  controlHolderName,
  isOwner,
  rolesLoaded,
  guardSettings,
  onLlmModeChange,
  onError,
  onControlState
}: {
  projectId: string;
  theme: ThemeMode;
  canRun: boolean;
  memberId: string;
  controlHolderName?: string;
  isOwner?: boolean;
  rolesLoaded?: boolean;
  guardSettings?: GuardSettings;
  onLlmModeChange(mode: GuardLlmMode): Promise<void>;
  onError(error: unknown): void;
  onControlState?(holderMemberId: string | null, expiresAt?: string, mode?: "full" | "human-only" | "native" | "off"): void;
}) {
  const terminalRef = useRef<SharedTerminalHandle>(null);
  const commandInputRef = useRef<HTMLInputElement>(null);
  const [connectionState, setConnectionState] = useState("Connecting");
  const [command, setCommand] = useState("");
  const [controlHolder, setControlHolder] = useState<string | null>(null);
  const [controlExpiresAt, setControlExpiresAt] = useState<string>();
  const [status, setStatus] = useState("");
  const [guardMode, setGuardMode] = useState<"full" | "human-only" | "native" | "off">("full");
  const [savingReviewMode, setSavingReviewMode] = useState(false);
  const [snapshotId, setSnapshotId] = useState<string>();
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [controlClock, setControlClock] = useState(() => Date.now());
  const controlled = controlHolder === memberId;

  useEffect(() => {
    if (!controlHolder) return;
    const timer = window.setInterval(() => setControlClock(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [controlHolder]);

  useEffect(() => {
    setStatus("");
    setSnapshotId(undefined);
  }, [connectionState, controlled]);

  useEffect(() => {
    if (!controlled && guardMode !== "off" && canRun && connectionState === "Connected") commandInputRef.current?.focus();
  }, [canRun, connectionState, controlled, guardMode]);

  async function undoSnapshot() {
    if (!snapshotId) return;
    try {
      if (!await undoGuardSnapshot(projectId, snapshotId)) {
        setStatus("已取消撤销：命令之后这些文件又被改过");
        return;
      }
      setStatus("✓ 已撤销到快照前");
      setSnapshotId(undefined);
    } catch (error) {
      onError(error);
    }
  }

  async function changeReviewMode(mode: GuardLlmMode) {
    setSavingReviewMode(true);
    try {
      await onLlmModeChange(mode);
    } catch (error) {
      onError(error);
    } finally {
      setSavingReviewMode(false);
    }
  }

  return (
    <div className="panel terminal-panel">
      <div className="panel-header terminal-header">
        <span>共享终端</span>
        <div className="terminal-controls">
          {controlHolder ? <span className="terminal-control-badge">{controlHolderName ?? (controlled ? "你" : "协作者")} 持有控制权 · {formatControlRemaining(controlExpiresAt, controlClock)}</span> : null}
          <span className="terminal-state" data-testid="terminal-state">
            共享 · {CONNECTION_TEXT[connectionState] ?? connectionState}
          </span>
          {connectionState === "Offline" ? (
            <button
              className="terminal-reconnect"
              type="button"
              onClick={() => terminalRef.current?.reconnect()}
            >
              重新连接
            </button>
          ) : null}
          <button
            className="terminal-restart"
            onClick={() => terminalRef.current?.restart()}
            disabled={!isOwner && guardMode !== "off"}
            title="重启共享终端"
            aria-label="重启共享终端"
            data-testid="terminal-restart"
          >
            <RotateCcw size={14} />
          </button>
        </div>
      </div>
      <div className="shared-terminal">
        <SharedTerminal
          ref={terminalRef}
          projectId={projectId}
          memberId={memberId}
          canInput={canRun && (controlled || guardMode === "off")}
          theme={theme}
          onConnectionState={setConnectionState}
          onControl={(holder, expiresAt, mode) => { setControlHolder(holder); setControlExpiresAt(expiresAt); if (mode) setGuardMode(mode); onControlState?.(holder, expiresAt, mode); }}
          onStatus={setStatus}
          onSnapshot={setSnapshotId}
        />
      </div>
      {controlled ? <div className="terminal-control-state">交互控制权有效至 {controlExpiresAt ? new Date(controlExpiresAt).toLocaleTimeString() : "稍后"}</div> : null}
      {!controlled && guardMode !== "off" ? (
        <form className="terminal-command-box" onSubmit={(event) => { event.preventDefault(); const text = command.trim(); if (!text) return; setHistory((current) => [...current.filter((item) => item !== text), text].slice(-50)); setHistoryIndex(-1); setStatus(""); setSnapshotId(undefined); terminalRef.current?.submitCommand(text); setCommand(""); }}>
          <input ref={commandInputRef} aria-label="终端命令" value={command} onChange={(event) => setCommand(event.target.value)} onKeyDown={(event) => { if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return; event.preventDefault(); const next = event.key === "ArrowUp" ? Math.min(history.length, historyIndex + 1) : Math.max(-1, historyIndex - 1); setHistoryIndex(next); setCommand(next < 0 ? "" : history[history.length - 1 - next] ?? ""); }} placeholder="输入要在共享终端执行的命令" disabled={!canRun || connectionState !== "Connected"} />
          <button type="submit" disabled={!command.trim() || !canRun || connectionState !== "Connected"}><Send size={14} /> 发送</button>
        </form>
      ) : null}
      {status ? <small className="terminal-guard-status" role="status" aria-live="polite">{status}{snapshotId ? <button type="button" onClick={() => void undoSnapshot()}>撤销</button> : null}</small> : null}
      <div className="terminal-review-bar" data-testid="terminal-review-bar">
        <label className="terminal-review-choice">
          <ShieldCheck size={14} aria-hidden="true" />
          <span>审批方式</span>
          <select
            aria-label="审批方式"
            data-testid="guard-llm-mode"
            value={guardSettings && !guardSettings.llmConfigured ? "off" : guardSettings?.llmMode ?? "suggest"}
            disabled={!guardSettings || !rolesLoaded || !isOwner || savingReviewMode || connectionState !== "Connected" || guardMode === "off"}
            onChange={(event) => void changeReviewMode(event.target.value as GuardLlmMode)}
          >
            <option value="off">{guardSettings && !guardSettings.llmConfigured ? "人工审批（模型不可用）" : "人工审批"}</option>
            <option value="suggest" disabled={Boolean(guardSettings && !guardSettings.llmConfigured)}>模型建议，人决定</option>
            <option value="auto" disabled={Boolean(guardSettings && !guardSettings.llmConfigured)}>模型自动审批</option>
          </select>
        </label>
        <span className="terminal-review-description" role="status">
          {!guardSettings ? "正在读取审批设置…"
            : guardMode === "off" ? "权限管控未开启"
            : savingReviewMode ? "正在保存…"
            : guardSettings.llmMode !== "off" && !guardSettings.llmConfigured ? "模型未配置，需要审批的请求都由人审批"
            : guardSettings.llmMode === "off" ? "需要审批的请求直接交给人审批"
            : guardSettings.llmMode === "suggest" ? "模型给出建议，由人批准或拒绝"
            : "符合条件的请求由模型自动批准或拒绝，其余由人审批"}
          {guardSettings && !isOwner && guardMode !== "off" ? " · 只有负责人可以修改这项设置" : ""}
        </span>
      </div>
    </div>
  );
}

const CONNECTION_TEXT: Record<string, string> = { Connecting: "连接中", Connected: "已连接", Reconnecting: "重新连接中", Offline: "已断开" };

function formatControlRemaining(expiresAt: string | undefined, now: number) {
  if (!expiresAt) return "稍后";
  const seconds = Math.max(0, Math.ceil((Date.parse(expiresAt) - now) / 1_000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}
