import * as pty from "node-pty";

const MAX_SCROLLBACK_CHARS = 100_000;

export function createSharedTerminal({
  workspaceRoot,
  shell = process.env.SIMPLERCP_SHELL || process.env.SHELL || "/bin/sh"
}: {
  workspaceRoot: string;
  shell?: string;
}) {
  const listeners = new Set<(data: string) => void>();
  let scrollback = "";
  let terminal = spawnTerminal();

  function spawnTerminal() {
    let expectedExit = false;
    const next = pty.spawn(shell, [], {
      name: "xterm-256color",
      cols: 100,
      rows: 24,
      cwd: workspaceRoot,
      env: terminalEnvironment()
    });
    next.onData(appendData);
    next.onExit(({ exitCode }) => {
      if (expectedExit) return;
      appendData(`\r\n[terminal exited with code ${exitCode}]\r\n`);
    });
    return {
      write: (data: string) => next.write(data),
      resize: (cols: number, rows: number) => next.resize(cols, rows),
      killExpected() {
        expectedExit = true;
        next.kill();
      }
    };
  }

  function appendData(data: string) {
    scrollback = `${scrollback}${data}`.slice(-MAX_SCROLLBACK_CHARS);
    for (const listener of listeners) listener(data);
  }

  function onData(listener: (data: string) => void) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  function write(data: string) {
    terminal.write(data);
  }

  function writeSystem(data: string) {
    appendData(data);
  }

  function resize(cols: number, rows: number) {
    terminal.resize(
      Math.max(20, Math.min(400, Math.floor(cols))),
      Math.max(5, Math.min(200, Math.floor(rows)))
    );
  }

  function restart() {
    terminal.killExpected();
    appendData("\r\n[terminal restarted]\r\n");
    terminal = spawnTerminal();
  }

  function dispose() {
    listeners.clear();
    terminal.killExpected();
  }

  return {
    onData,
    write,
    writeSystem,
    resize,
    restart,
    dispose,
    getScrollback: () => scrollback
  };
}

export type SharedTerminal = ReturnType<typeof createSharedTerminal>;

function terminalEnvironment() {
  return Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string"
    )
  );
}
