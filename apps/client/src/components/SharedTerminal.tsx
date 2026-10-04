import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import type { ThemeMode } from "../theme";
import type { TerminalClientMessage, TerminalServerMessage } from "../types";

export interface SharedTerminalHandle {
  restart(): void;
  reconnect(): void;
  submitCommand(text: string): boolean;
}

export const SharedTerminal = forwardRef<
  SharedTerminalHandle,
  {
    projectId: string;
    memberId: string;
    canInput: boolean;
    theme: ThemeMode;
    onControl(holderMemberId: string | null, expiresAt?: string, mode?: "full" | "human-only" | "off"): void;
    onStatus(message: string): void;
    onSnapshot(snapshotId: string): void;
    onConnectionState(state: "Connecting" | "Connected" | "Reconnecting" | "Offline"): void;
  }
>(function SharedTerminal(
  { projectId, memberId, canInput, theme, onConnectionState, onControl, onStatus, onSnapshot },
  ref
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const socketRef = useRef<WebSocket>();
  const terminalRef = useRef<Terminal>();
  const canInputRef = useRef(canInput);
  const reconnectRef = useRef<() => void>();
  const callbacksRef = useRef({ onConnectionState, onControl, onStatus, onSnapshot });
  callbacksRef.current = { onConnectionState, onControl, onStatus, onSnapshot };

  useEffect(() => {
    canInputRef.current = canInput;
    if (terminalRef.current) {
      terminalRef.current.options.disableStdin = !canInput;
    }
  }, [canInput]);

  useEffect(() => {
    if (terminalRef.current) {
      terminalRef.current.options.theme = terminalTheme(theme);
    }
  }, [theme]);

  useImperativeHandle(ref, () => ({
    restart() {
      if (socketRef.current?.readyState === WebSocket.OPEN) {
        socketRef.current.send(JSON.stringify({ type: "restart" } satisfies TerminalClientMessage));
      }
    },
    reconnect() {
      reconnectRef.current?.();
    }
    ,submitCommand(text: string) {
      if (socketRef.current?.readyState === WebSocket.OPEN) {
        socketRef.current.send(JSON.stringify({ type: "command", text } satisfies TerminalClientMessage));
        return true;
      }
      callbacksRef.current.onStatus("Not connected");
      return false;
    }
  }));

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !memberId) return;

    const terminal = new Terminal({
      convertEol: true,
      cursorBlink: true,
      disableStdin: !canInputRef.current,
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
      fontSize: 12,
      lineHeight: 1.15,
      screenReaderMode: true,
      scrollback: 5_000,
      theme: terminalTheme(theme)
    });
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(container);
    terminalRef.current = terminal;

    const protocol = window.location.protocol === "https:" ? "wss" : "ws";
    const endpoint = `${protocol}://${window.location.host}/terminal?projectId=${encodeURIComponent(projectId)}&memberId=${encodeURIComponent(memberId)}`;
    let reconnectTimer: number | undefined;
    let reconnectAttempt = 0;
    let disposed = false;

    function sendResize() {
      const activeSocket = socketRef.current;
      if (activeSocket?.readyState !== WebSocket.OPEN) return;
      activeSocket.send(
        JSON.stringify({
          type: "resize",
          cols: terminal.cols,
          rows: terminal.rows
        } satisfies TerminalClientMessage)
      );
    }

    function fit() {
      try {
        fitAddon.fit();
        sendResize();
      } catch {
        // The panel can briefly have no dimensions while the layout settles.
      }
    }

    function connect() {
      if (disposed) return;
      callbacksRef.current.onConnectionState(reconnectAttempt === 0 ? "Connecting" : "Reconnecting");
      const socket = new WebSocket(endpoint);
      socketRef.current = socket;
      socket.addEventListener("open", () => {
        reconnectAttempt = 0;
        callbacksRef.current.onConnectionState("Connected");
        fit();
        terminal.focus();
      });
      socket.addEventListener("message", (event) => {
        const message = JSON.parse(String(event.data)) as TerminalServerMessage;
        if (message.type === "terminal_snapshot") {
          terminal.reset();
          terminal.write(message.data);
        } else if (message.type === "terminal_output") {
          terminal.write(message.data);
        } else if (message.type === "control") {
          callbacksRef.current.onControl(message.holderMemberId, message.expiresAt, message.mode);
          callbacksRef.current.onStatus("");
        } else if (message.type === "guard_pending") {
          callbacksRef.current.onStatus(formatGuardPending(message));
        } else if (message.type === "guard_decision") {
          const command = message.command ? `: ${message.command}` : "";
          if (message.snapshotId) callbacksRef.current.onSnapshot(message.snapshotId);
          callbacksRef.current.onStatus(formatGuardDecision(message, command));
        } else {
          terminal.write(`\r\n\x1b[31m${message.message}\x1b[0m\r\n`);
          callbacksRef.current.onStatus(message.message);
        }
      });
      socket.addEventListener("close", (event) => {
        if (socketRef.current === socket) socketRef.current = undefined;
        if (disposed) return;
        if (event.code === 1001 && event.reason === "Project deleted") {
          callbacksRef.current.onConnectionState("Offline");
          terminal.write("\r\n[project deleted]\r\n");
          return;
        }
        reconnectAttempt += 1;
        if (reconnectAttempt >= 5) {
          callbacksRef.current.onConnectionState("Offline");
          return;
        }
        callbacksRef.current.onConnectionState("Reconnecting");
        reconnectTimer = window.setTimeout(
          connect,
          Math.min(5_000, 500 * 2 ** Math.min(reconnectAttempt, 4))
        );
      });
      socket.addEventListener("error", () => {
        if (socket.readyState !== WebSocket.CLOSED) socket.close();
      });
    }

    reconnectRef.current = () => {
      if (socketRef.current) return;
      reconnectAttempt = 0;
      connect();
    };
    connect();

    const dataSubscription = terminal.onData((data) => {
      const socket = socketRef.current;
      if (!canInputRef.current || socket?.readyState !== WebSocket.OPEN) return;
      socket.send(JSON.stringify({ type: "input", data } satisfies TerminalClientMessage));
    });
    const resizeSubscription = terminal.onResize(sendResize);
    const resizeObserver = new ResizeObserver(fit);
    resizeObserver.observe(container);
    window.requestAnimationFrame(fit);

    return () => {
      disposed = true;
      if (reconnectTimer) window.clearTimeout(reconnectTimer);
      resizeObserver.disconnect();
      dataSubscription.dispose();
      resizeSubscription.dispose();
      socketRef.current?.close();
      terminal.dispose();
      socketRef.current = undefined;
      terminalRef.current = undefined;
      reconnectRef.current = undefined;
    };
  }, [memberId, projectId]);

  return (
    <div
      ref={containerRef}
      className="terminal-surface"
      data-testid="terminal-output"
    />
  );
});

function terminalTheme(theme: ThemeMode) {
  return theme === "dark"
    ? {
        background: "#0b0f15",
        foreground: "#c9d5e8",
        cursor: "#8fb2ff",
        selectionBackground: "#334a70"
      }
    : {
        background: "#f8fafc",
        foreground: "#1e293b",
        cursor: "#2563eb",
        selectionBackground: "#bfdbfe"
      };
}

function formatGuardDecision(message: Extract<TerminalServerMessage, { type: "guard_decision" }>, command: string) {
  if (message.outcome === "busy" && message.reason === "Another command from this member is waiting") return `Previous command is waiting for approval in Team — approve or reject it before sending another command${command}`;
  if (message.outcome === "busy") return `Terminal busy — wait for the running program to finish${command}`;
  if (message.outcome === "timeout") return `⏱ No response before the approval deadline — not run${command}`;
  if (message.outcome === "rejected") return `✕ Rejected${message.approverName ? ` by ${message.approverName}` : ""}: ${friendlyGuardReason(message.reason)}${command}`;
  if (message.outcome === "denied") {
    const reason = friendlyGuardReason(message.reason);
    const controlHint = message.reason.startsWith("Interactive control is required")
      ? ". Open Team → People and choose Take control before retrying"
      : "";
    return `✕ Blocked: ${reason}${controlHint}${command}`;
  }
  if (message.action === "allow_snapshot") return `✓ Ran with snapshot${command}`;
  if (message.outcome === "approved") return `✓ Approved${message.approverName ? ` by ${message.approverName}` : ""} — running${command}`;
  if (message.action === "allow") return `✓ Ran${command}`;
  return `${message.reason}${command}`;
}

function formatGuardPending(message: Extract<TerminalServerMessage, { type: "guard_pending" }>) {
  const waiting = message.noApprover ? "No owner online — waiting for an owner to join" : "Waiting for human approval";
  if (message.llmUnavailable) return `Model judgment unavailable — ${waiting}`;
  if (!message.llm) return waiting;
  return `Model suggestion: ${message.llm.risk} (${Math.round(message.llm.confidence * 100)}% confidence) — ${message.llm.reason}. ${waiting}`;
}

function friendlyGuardReason(reason: string) {
  const labels: Record<string, string> = { "hard.control-character": "command contains control characters", "hard.cwd": "changing the terminal directory is blocked", "hard.metadata": "project metadata is protected", "hard.outside": "the path is outside this workspace", "hard.protected": "the path is protected", "hard.dynamic": "dynamic shell syntax needs review" };
  return reason.split(", ").map((rule) => labels[rule] ?? rule).join(", ");
}
