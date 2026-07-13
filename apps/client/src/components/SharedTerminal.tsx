import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";

export interface SharedTerminalHandle {
  restart(): void;
}

export const SharedTerminal = forwardRef<
  SharedTerminalHandle,
  {
    memberId: string;
    canInput: boolean;
  }
>(function SharedTerminal({ memberId, canInput }, ref) {
  const containerRef = useRef<HTMLDivElement>(null);
  const socketRef = useRef<WebSocket>();
  const terminalRef = useRef<Terminal>();
  const canInputRef = useRef(canInput);

  useEffect(() => {
    canInputRef.current = canInput;
    if (terminalRef.current) {
      terminalRef.current.options.disableStdin = !canInput;
    }
  }, [canInput]);

  useImperativeHandle(ref, () => ({
    restart() {
      if (socketRef.current?.readyState === WebSocket.OPEN) {
        socketRef.current.send(JSON.stringify({ type: "restart" }));
      }
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
      theme: {
        background: "#0b0f15",
        foreground: "#c9d5e8",
        cursor: "#8fb2ff",
        selectionBackground: "#334a70"
      }
    });
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(container);
    terminalRef.current = terminal;

    const protocol = window.location.protocol === "https:" ? "wss" : "ws";
    const socket = new WebSocket(
      `${protocol}://${window.location.host}/terminal?memberId=${encodeURIComponent(memberId)}`
    );
    socketRef.current = socket;

    function sendResize() {
      if (socket.readyState !== WebSocket.OPEN) return;
      socket.send(
        JSON.stringify({
          type: "resize",
          cols: terminal.cols,
          rows: terminal.rows
        })
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

    socket.addEventListener("open", () => {
      fit();
      terminal.focus();
    });
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data)) as
        | { type: "terminal_snapshot"; data: string }
        | { type: "terminal_output"; data: string }
        | { type: "terminal_error"; message: string };
      if (message.type === "terminal_snapshot") {
        terminal.reset();
        terminal.write(message.data);
      } else if (message.type === "terminal_output") {
        terminal.write(message.data);
      } else {
        terminal.write(`\r\n\x1b[31m${message.message}\x1b[0m\r\n`);
      }
    });

    const dataSubscription = terminal.onData((data) => {
      if (!canInputRef.current || socket.readyState !== WebSocket.OPEN) return;
      socket.send(JSON.stringify({ type: "input", data }));
    });
    const resizeSubscription = terminal.onResize(sendResize);
    const resizeObserver = new ResizeObserver(fit);
    resizeObserver.observe(container);
    window.requestAnimationFrame(fit);

    return () => {
      resizeObserver.disconnect();
      dataSubscription.dispose();
      resizeSubscription.dispose();
      socket.close();
      terminal.dispose();
      socketRef.current = undefined;
      terminalRef.current = undefined;
    };
  }, [memberId]);

  return (
    <div
      ref={containerRef}
      className="terminal-surface"
      data-testid="terminal-output"
    />
  );
});
