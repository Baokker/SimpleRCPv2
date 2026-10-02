import * as pty from "node-pty";
import { terminalEnv } from "./processEnv.js";

const MAX_SCROLLBACK_CHARS = 100_000;

export function createSharedTerminal({
  workspaceRoot,
  shell = process.env.SIMPLERCP_SHELL || process.env.SHELL || "/bin/sh",
  enabled = true
}: {
  workspaceRoot: string;
  shell?: string;
  enabled?: boolean;
}) {
  const listeners = new Set<(data: string) => void>();
  const inputListeners = new Set<(memberId: string, data: string) => void>();
  let scrollback = "";
  let terminal = enabled ? spawnTerminal() : undefined;

  function spawnTerminal() {
    let expectedExit = false;
    const next = pty.spawn(shell, [], {
      name: "xterm-256color",
      cols: 100,
      rows: 24,
      cwd: workspaceRoot,
      env: terminalEnv()
    });
    next.onData(appendData);
    next.onExit(({ exitCode }) => {
      if (expectedExit) return;
      appendData(`\r\n[terminal exited with code ${exitCode}]\r\n`);
    });
    return {
      get process() { return next.process; },
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

  function write(data: string, memberId: string, auditInput = true) {
    if (auditInput) for (const listener of inputListeners) listener(memberId, data);
    terminal?.write(data);
  }

  function onInput(listener: (memberId: string, data: string) => void) {
    inputListeners.add(listener);
    return () => inputListeners.delete(listener);
  }

  function resize(cols: number, rows: number) {
    terminal?.resize(
      Math.max(20, Math.min(400, Math.floor(cols))),
      Math.max(5, Math.min(200, Math.floor(rows)))
    );
  }

  function restart() {
    if (!enabled || !terminal) return;
    terminal.killExpected();
    appendData("\r\n[terminal restarted]\r\n");
    terminal = spawnTerminal();
  }

  function dispose() {
    listeners.clear();
    inputListeners.clear();
    terminal?.killExpected();
  }

  return {
    onData,
    onInput,
    write,
    resize,
    restart,
    dispose,
    enabled,
    foregroundProcess() { return terminal?.process; },
    shellName: shell.split(/[\\/]/).at(-1) ?? shell,
    getScrollback: () => scrollback
  };
}

export type SharedTerminal = ReturnType<typeof createSharedTerminal>;
