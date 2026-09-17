import { RotateCcw } from "lucide-react";
import { useRef } from "react";
import type { ThemeMode } from "../theme";
import type { RuntimeConfig } from "../types";
import {
  SharedTerminal,
  type SharedTerminalHandle
} from "./SharedTerminal";

export function TerminalPanel({
  runtimeConfig,
  theme,
  canRun,
  memberId,
  isHost,
  selectedCommand,
  commandText,
  running,
  onSelectedCommandChange,
  onCommandTextChange,
  onRunCommand
}: {
  runtimeConfig: RuntimeConfig;
  theme: ThemeMode;
  canRun: boolean;
  memberId: string;
  isHost: boolean;
  selectedCommand: string;
  commandText: string;
  running: boolean;
  onSelectedCommandChange(command: string): void;
  onCommandTextChange(command: string): void;
  onRunCommand(): void;
}) {
  const isUnrestricted = runtimeConfig.commandMode === "unrestricted";
  const terminalRef = useRef<SharedTerminalHandle>(null);

  return (
    <div className="panel terminal-panel">
      <div className="panel-header terminal-header">
        <span>Terminal</span>
        <div className="terminal-controls">
          <span className="command-mode" data-testid="command-mode">
            {runtimeConfig.terminalEnabled
              ? runtimeConfig.commandMode
              : "disabled"}
          </span>
          {isUnrestricted ? (
            <input
              value={commandText}
              disabled={!canRun || running}
              onChange={(event) => onCommandTextChange(event.target.value)}
              placeholder={'node -e "console.log(\'ok\')"'}
              data-testid="command-input"
            />
          ) : (
            <select
              value={selectedCommand}
              disabled={!canRun || running}
              onChange={(event) => onSelectedCommandChange(event.target.value)}
              data-testid="command-select"
            >
              {runtimeConfig.commands.map((command) => (
                <option key={command} value={command}>
                  {command}
                </option>
              ))}
            </select>
          )}
          <button
            onClick={onRunCommand}
            disabled={
              running ||
              !canRun ||
              (isUnrestricted ? commandText.trim().length === 0 : runtimeConfig.commands.length === 0)
            }
            data-testid="run-command"
          >
            {running ? "Running" : "Run"}
          </button>
          {isHost ? (
            <button
              className="terminal-restart"
              onClick={() => terminalRef.current?.restart()}
              disabled={!runtimeConfig.terminalEnabled}
              title="Restart shared terminal"
              aria-label="Restart shared terminal"
              data-testid="terminal-restart"
            >
              <RotateCcw size={14} />
            </button>
          ) : null}
        </div>
      </div>
      <div className="shared-terminal">
        <SharedTerminal
          ref={terminalRef}
          memberId={memberId}
          canInput={
            runtimeConfig.terminalEnabled && isUnrestricted && canRun
          }
          theme={theme}
        />
      </div>
    </div>
  );
}
