export function TerminalPanel({
  lines,
  commands,
  selectedCommand,
  running,
  onSelectedCommandChange,
  onRunCommand
}: {
  lines: string[];
  commands: string[];
  selectedCommand: string;
  running: boolean;
  onSelectedCommandChange(command: string): void;
  onRunCommand(): void;
}) {
  return (
    <div className="panel terminal-panel">
      <div className="panel-header terminal-header">
        <span>Terminal</span>
        <div className="terminal-controls">
          <select
            value={selectedCommand}
            onChange={(event) => onSelectedCommandChange(event.target.value)}
            data-testid="command-select"
          >
            {commands.map((command) => (
              <option key={command} value={command}>
                {command}
              </option>
            ))}
          </select>
          <button
            onClick={onRunCommand}
            disabled={running || commands.length === 0}
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
