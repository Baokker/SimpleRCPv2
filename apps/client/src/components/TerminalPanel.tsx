import { RotateCcw } from "lucide-react";
import { useRef } from "react";
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
  commandText,
  running,
  onCommandTextChange,
  onRunCommand
}: {
  projectId: string;
  theme: ThemeMode;
  canRun: boolean;
  memberId: string;
  commandText: string;
  running: boolean;
  onCommandTextChange(command: string): void;
  onRunCommand(): void;
}) {
  const terminalRef = useRef<SharedTerminalHandle>(null);

  return (
    <div className="panel terminal-panel">
      <div className="panel-header terminal-header">
        <span>Terminal</span>
        <div className="terminal-controls">
          <input
            value={commandText}
            disabled={!canRun || running}
            onChange={(event) => onCommandTextChange(event.target.value)}
            placeholder={'node -e "console.log(\'ok\')"'}
            data-testid="command-input"
          />
          <button
            onClick={onRunCommand}
            disabled={running || !canRun || commandText.trim().length === 0}
            data-testid="run-command"
          >
            {running ? "Running" : "Run"}
          </button>
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
        />
      </div>
    </div>
  );
}
