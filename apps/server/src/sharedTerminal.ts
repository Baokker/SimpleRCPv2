import * as pty from "node-pty";
import path from "node:path";
import { terminalEnv } from "./processEnv.js";

const MAX_SCROLLBACK_CHARS = 100_000;

const INTERACTIVE_COMMANDS = new Set([
  "vim",
  "vi",
  "nvim",
  "vimdiff",
  "nano",
  "emacs",
  "less",
  "more",
  "top",
  "htop",
  "watch",
  "node",
  "python",
  "python3",
  "ipython",
  "ruby",
  "irb",
  "php",
  "deno",
  "lua",
  "mysql",
  "psql"
]);

export function interactiveCommandName(command: string) {
  const tokens = command.trim().match(/"[^"\\]*(?:\\.[^"\\]*)*"|'[^'\\]*(?:\\.[^'\\]*)*'|\S+/g) ?? [];
  let index = 0;
  while (index < tokens.length && /^[A-Za-z_][A-Za-z0-9_]*=.*$/.test(tokens[index]!)) index += 1;
  if (tokens[index] === "env") {
    index += 1;
    while (index < tokens.length && (tokens[index]!.startsWith("-") || /^[A-Za-z_][A-Za-z0-9_]*=.*$/.test(tokens[index]!))) index += 1;
  }
  const token = tokens[index];
  if (!token) return undefined;
  const name = token.replace(/^['"]|['"]$/g, "").replace(/^.*[\\/]/, "").toLowerCase();
  return INTERACTIVE_COMMANDS.has(name) ? name : undefined;
}

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
  const configuredShellName = path.basename(shell);
  let shellProcessName = configuredShellName;
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
    shellProcessName = path.basename(next.process);
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
    isShellProcess(processName: string) {
      const name = path.basename(processName);
      return name === configuredShellName || name === shellProcessName || configuredShellName === "sh" && name === "bash";
    },
    shellName: shell.split(/[\\/]/).at(-1) ?? shell,
    getScrollback: () => scrollback
  };
}

export type SharedTerminal = ReturnType<typeof createSharedTerminal>;
