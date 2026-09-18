import { RotateCcw } from "lucide-react";
import { useRef, useState } from "react";
import type { ThemeMode } from "../theme";
import {
  SharedTerminal,
  type SharedTerminalHandle
} from "./SharedTerminal";

export function TerminalPanel({
  projectId,
  theme,
  canRun,
  memberId
}: {
  projectId: string;
  theme: ThemeMode;
  canRun: boolean;
  memberId: string;
}) {
  const terminalRef = useRef<SharedTerminalHandle>(null);
  const [connectionState, setConnectionState] = useState("Connecting");

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
          canInput={canRun}
          theme={theme}
          onConnectionState={setConnectionState}
        />
      </div>
    </div>
  );
}
