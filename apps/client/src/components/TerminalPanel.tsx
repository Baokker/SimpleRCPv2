import type { RuntimeConfig } from "../types";

export function TerminalPanel({
  lines,
  runtimeConfig,
  selectedCommand,
  commandText,
  running,
  onSelectedCommandChange,
  onCommandTextChange,
  onRunCommand
}: {
  lines: string[];
  runtimeConfig: RuntimeConfig;
  selectedCommand: string;
  commandText: string;
  running: boolean;
  onSelectedCommandChange(command: string): void;
  onCommandTextChange(command: string): void;
  onRunCommand(): void;
}) {
  const isUnrestricted = runtimeConfig.commandMode === "unrestricted";

  return (
    <div className="panel terminal-panel">
      <div className="panel-header terminal-header">
        <span>Terminal</span>
        <div className="terminal-controls">
          <span className="command-mode" data-testid="command-mode">
            {runtimeConfig.commandMode}
          </span>
          {isUnrestricted ? (
            <input
              value={commandText}
              onChange={(event) => onCommandTextChange(event.target.value)}
              placeholder={'node -e "console.log(\'ok\')"'}
              data-testid="command-input"
            />
          ) : (
            <select
              value={selectedCommand}
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
              (isUnrestricted ? commandText.trim().length === 0 : runtimeConfig.commands.length === 0)
            }
            data-testid="run-command"
          >
            {running ? "Running" : "Run"}
          </button>
        </div>
      </div>
      <pre data-testid="terminal-output">
        {lines.length > 0 ? lines.join("\n") : "No command output yet."}
      </pre>
    </div>
  );
}
