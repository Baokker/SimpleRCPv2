export function TerminalPanel({ lines }: { lines: string[] }) {
  return (
    <div className="panel terminal-panel">
      <div className="panel-header">Terminal / Tests</div>
      <pre data-testid="terminal-output">
        {lines.length > 0 ? lines.join("\n") : "No command output yet."}
      </pre>
    </div>
  );
}
