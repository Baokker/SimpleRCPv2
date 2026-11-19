import * as pty from "node-pty";
import { writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { terminalEnv } from "./processEnv.js";

const MAX_SCROLLBACK_CHARS = 100_000;
// bash reports each finished command's exit status through this private OSC sequence; it is stripped before output is shown.
const STATUS_OSC_PREFIX = "\x1b]6973;";
const STATUS_OSC = /\x1b\]6973;(\d+)\x07/;
const BASH_STATUS_RC = [
  'if [ -f "$HOME/.bashrc" ]; then . "$HOME/.bashrc"; fi',
  "__simplercp_status() { local status=$?; printf '\\033]6973;%s\\007' \"$status\"; return $status; }",
  'PROMPT_COMMAND="__simplercp_status${PROMPT_COMMAND:+; $PROMPT_COMMAND}"',
  ""
].join("\n");

function bashStatusRcFile() {
  const file = path.join(os.tmpdir(), `simplercp-terminal-rc-${process.pid}.sh`);
  writeFileSync(file, BASH_STATUS_RC, { mode: 0o600 });
  return file;
}

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
  const statusListeners = new Set<(exitCode: number) => void>();
  let scrollback = "";
  let pendingStatus = "";
  const reportsStatus = path.basename(shell) === "bash";
  const configuredShellName = path.basename(shell);
  let shellProcessName = configuredShellName;
  let terminal = enabled ? spawnTerminal() : undefined;

  function spawnTerminal() {
    let expectedExit = false;
    const next = pty.spawn(shell, reportsStatus ? ["--rcfile", bashStatusRcFile()] : [], {
      name: "xterm-256color",
      cols: 100,
      rows: 24,
      cwd: workspaceRoot,
      env: terminalEnv()
    });
    shellProcessName = path.basename(next.process);
    next.onData(handleShellData);
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

  // Output before a status marker is shown first, so a status listener's annotation lands right above the next prompt.
  function handleShellData(chunk: string) {
    let data = pendingStatus + chunk;
    pendingStatus = "";
    const partial = data.lastIndexOf(STATUS_OSC_PREFIX);
    if (partial !== -1 && data.indexOf("\x07", partial) === -1 && data.length - partial < 24) {
      pendingStatus = data.slice(partial);
      data = data.slice(0, partial);
    }
    let match = STATUS_OSC.exec(data);
    while (match) {
      if (match.index > 0) appendData(data.slice(0, match.index));
      const exitCode = Number(match[1]);
      for (const listener of [...statusListeners]) listener(exitCode);
      data = data.slice(match.index + match[0].length);
      match = STATUS_OSC.exec(data);
    }
    if (data) appendData(data);
  }

  function annotate(text: string) {
    appendData(`\r\n\x1b[2m${text}\x1b[0m\r\n`);
  }

  function nextCommandStatus(timeoutMs: number) {
    return new Promise<number | undefined>((resolve) => {
      const timer = setTimeout(() => { statusListeners.delete(listener); resolve(undefined); }, timeoutMs);
      const listener = (exitCode: number) => { clearTimeout(timer); statusListeners.delete(listener); resolve(exitCode); };
      statusListeners.add(listener);
    });
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
    statusListeners.clear();
    terminal?.killExpected();
  }

  return {
    onData,
    onInput,
    write,
    annotate,
    nextCommandStatus,
    reportsStatus,
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
