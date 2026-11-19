import { RotateCcw } from "lucide-react";
import { useRef, useState } from "react";
import type { ThemeMode } from "../theme";
import {
  SharedTerminal,
  type SharedTerminalHandle
} from "./SharedTerminal";


const CONNECTION_TEXT: Record<string, string> = { Connecting: "连接中", Connected: "已连接", Reconnecting: "重新连接中", Offline: "已断开" };

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
        <span>共享终端</span>
        <div className="terminal-controls">
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
          canInput={canRun}
          theme={theme}
          onConnectionState={setConnectionState}
        />
      </div>
    </div>
  );
}
