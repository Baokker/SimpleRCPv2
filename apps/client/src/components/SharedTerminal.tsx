import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import type { ThemeMode } from "../theme";
import type { TerminalClientMessage, TerminalServerMessage } from "../types";

export interface SharedTerminalHandle {
  restart(): void;
  reconnect(): void;
}

export const SharedTerminal = forwardRef<
  SharedTerminalHandle,
  {
    projectId: string;
    memberId: string;
    canInput: boolean;
    theme: ThemeMode;
    onConnectionState(state: "Connecting" | "Connected" | "Reconnecting" | "Offline"): void;
  }
>(function SharedTerminal(
  { projectId, memberId, canInput, theme, onConnectionState },
  ref
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const socketRef = useRef<WebSocket>();
  const terminalRef = useRef<Terminal>();
  const canInputRef = useRef(canInput);
  const reconnectRef = useRef<() => void>();

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
      onConnectionState(reconnectAttempt === 0 ? "Connecting" : "Reconnecting");
      const socket = new WebSocket(endpoint);
      socketRef.current = socket;
      socket.addEventListener("open", () => {
        reconnectAttempt = 0;
        onConnectionState("Connected");
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
        } else {
          terminal.write(`\r\n\x1b[31m${message.message}\x1b[0m\r\n`);
        }
      });
      socket.addEventListener("close", (event) => {
        if (socketRef.current === socket) socketRef.current = undefined;
        if (disposed) return;
        if (event.code === 1001 && event.reason === "Project deleted") {
          onConnectionState("Offline");
          terminal.write("\r\n[project deleted]\r\n");
          return;
        }
        reconnectAttempt += 1;
        if (reconnectAttempt >= 5) {
          onConnectionState("Offline");
          return;
        }
        onConnectionState("Reconnecting");
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
  }, [memberId, onConnectionState, projectId]);

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
