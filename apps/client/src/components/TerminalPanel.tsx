import { RotateCcw } from "lucide-react";
import { useRef, useState } from "react";
import { Send } from "lucide-react";
import type { ThemeMode } from "../theme";
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
    onControlState
}: {
  projectId: string;
  theme: ThemeMode;
  canRun: boolean;
  memberId: string;
  isOwner?: boolean;
  onControlState?(holderMemberId: string | null, expiresAt?: string, mode?: "full" | "human-only" | "off"): void;
}) {
  const terminalRef = useRef<SharedTerminalHandle>(null);
  const [connectionState, setConnectionState] = useState("Connecting");
  const [command, setCommand] = useState("");
  const [controlHolder, setControlHolder] = useState<string | null>(null);
  const [controlExpiresAt, setControlExpiresAt] = useState<string>();
  const [status, setStatus] = useState("");
  const [guardMode, setGuardMode] = useState<"full" | "human-only" | "off">("full");
  const controlled = controlHolder === memberId;

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
        />
      </div>
      {controlled ? <div className="terminal-control-state">Interactive control until {controlExpiresAt ? new Date(controlExpiresAt).toLocaleTimeString() : "soon"}</div> : null}
      {!controlled && guardMode !== "off" ? (
        <form className="terminal-command-box" onSubmit={(event) => { event.preventDefault(); const text = command.trim(); if (!text) return; terminalRef.current?.submitCommand(text); setCommand(""); }}>
          <input value={command} onChange={(event) => setCommand(event.target.value)} placeholder="Submit a terminal command" disabled={!canRun || connectionState !== "Connected"} />
          <button type="submit" disabled={!command.trim() || !canRun || connectionState !== "Connected"}><Send size={14} /> Send</button>
        </form>
      ) : null}
      {status ? <small className="terminal-guard-status">{status}</small> : null}
    </div>
  );
}
