import { RotateCcw, ShieldCheck } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Send } from "lucide-react";
import { restoreGuardSnapshot } from "../api";
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
  isOwner?: boolean;
  rolesLoaded?: boolean;
  guardSettings?: GuardSettings;
  onLlmModeChange(mode: GuardLlmMode): Promise<void>;
  onError(error: unknown): void;
  onControlState?(holderMemberId: string | null, expiresAt?: string, mode?: "full" | "human-only" | "off"): void;
}) {
  const terminalRef = useRef<SharedTerminalHandle>(null);
  const [connectionState, setConnectionState] = useState("Connecting");
  const [command, setCommand] = useState("");
  const [controlHolder, setControlHolder] = useState<string | null>(null);
  const [controlExpiresAt, setControlExpiresAt] = useState<string>();
  const [status, setStatus] = useState("");
  const [guardMode, setGuardMode] = useState<"full" | "human-only" | "off">("full");
  const [savingReviewMode, setSavingReviewMode] = useState(false);
  const [snapshotId, setSnapshotId] = useState<string>();
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const controlled = controlHolder === memberId;

  useEffect(() => {
    setStatus("");
    setSnapshotId(undefined);
  }, [connectionState, controlled]);

  async function undoSnapshot() {
    if (!snapshotId) return;
    try {
      await restoreGuardSnapshot(projectId, snapshotId);
      setStatus("✓ Snapshot restored");
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
        <span>Terminal</span>
        <div className="terminal-controls">
          <span className="terminal-state" data-testid="terminal-state">
            Shared · {connectionState}
          </span>
          {connectionState === "Offline" ? (
            <button
              className="terminal-reconnect"
              type="button"
              onClick={() => terminalRef.current?.reconnect()}
            >
              Reconnect
            </button>
          ) : null}
          <button
            className="terminal-restart"
            onClick={() => terminalRef.current?.restart()}
            disabled={!isOwner && guardMode !== "off"}
            title="Restart shared terminal"
            aria-label="Restart shared terminal"
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
      {controlled ? <div className="terminal-control-state">Interactive control until {controlExpiresAt ? new Date(controlExpiresAt).toLocaleTimeString() : "soon"}</div> : null}
      {!controlled && guardMode !== "off" ? (
        <form className="terminal-command-box" onSubmit={(event) => { event.preventDefault(); const text = command.trim(); if (!text) return; setHistory((current) => [...current.filter((item) => item !== text), text].slice(-50)); setHistoryIndex(-1); setStatus(""); setSnapshotId(undefined); terminalRef.current?.submitCommand(text); setCommand(""); }}>
          <input aria-label="Terminal command" value={command} onChange={(event) => setCommand(event.target.value)} onKeyDown={(event) => { if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return; event.preventDefault(); const next = event.key === "ArrowUp" ? Math.min(history.length, historyIndex + 1) : Math.max(-1, historyIndex - 1); setHistoryIndex(next); setCommand(next < 0 ? "" : history[history.length - 1 - next] ?? ""); }} placeholder="Submit a terminal command" disabled={!canRun || connectionState !== "Connected"} />
          <button type="submit" disabled={!command.trim() || !canRun || connectionState !== "Connected"}><Send size={14} /> Send</button>
        </form>
      ) : null}
      {status ? <small className="terminal-guard-status" role="status" aria-live="polite">{status}{snapshotId ? <button type="button" onClick={() => void undoSnapshot()}>Undo</button> : null}</small> : null}
      <div className="terminal-review-bar" data-testid="terminal-review-bar">
        <label className="terminal-review-choice">
          <ShieldCheck size={14} aria-hidden="true" />
          <span>Request review</span>
          <select
            aria-label="Request review mode"
            data-testid="guard-llm-mode"
            value={guardSettings && !guardSettings.llmConfigured ? "off" : guardSettings?.llmMode ?? "suggest"}
            disabled={!guardSettings || !rolesLoaded || !isOwner || savingReviewMode || connectionState !== "Connected" || guardMode === "off"}
            onChange={(event) => void changeReviewMode(event.target.value as GuardLlmMode)}
          >
            <option value="off">{guardSettings && !guardSettings.llmConfigured ? "Manual (model unavailable)" : "Manual review"}</option>
            <option value="suggest" disabled={Boolean(guardSettings && !guardSettings.llmConfigured)}>Model suggestion</option>
            <option value="auto" disabled={Boolean(guardSettings && !guardSettings.llmConfigured)}>Model auto review</option>
          </select>
        </label>
        <span className="terminal-review-description" role="status">
          {!guardSettings ? "Loading review settings…"
            : guardMode === "off" ? "Guard is disabled"
            : savingReviewMode ? "Saving…"
            : guardSettings.llmMode !== "off" && !guardSettings.llmConfigured ? "Configure DEEPSEEK_API_KEY to enable model review; requests require human approval"
            : guardSettings.llmMode === "off" ? "Requests needing approval go directly to human review"
            : guardSettings.llmMode === "suggest" ? "The model advises; a person approves or rejects"
            : "Eligible requests are approved or rejected by the model; others need human review"}
          {guardSettings && !isOwner && guardMode !== "off" ? " · Only an owner can change this project setting" : ""}
        </span>
      </div>
    </div>
  );
}
