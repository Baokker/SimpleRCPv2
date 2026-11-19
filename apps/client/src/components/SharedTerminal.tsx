import { FitAddon } from "@xterm/addon-fit";
import { englishLocale, guardRecommendationText, guardRiskText, guardServerReasonText } from "../guardText";
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
    onControl(holderMemberId: string | null, expiresAt?: string, mode?: "full" | "human-only" | "native" | "off"): void;
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
    let pendingTimer: number | undefined;
    let reconnectAttempt = 0;
    let disposed = false;

    function clearPendingTimer() {
      if (pendingTimer !== undefined) window.clearInterval(pendingTimer);
      pendingTimer = undefined;
    }

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
          clearPendingTimer();
          callbacksRef.current.onControl(message.holderMemberId, message.expiresAt, message.mode);
          callbacksRef.current.onStatus("");
        } else if (message.type === "guard_pending") {
          clearPendingTimer();
          const updatePendingStatus = () => callbacksRef.current.onStatus(formatGuardPending(message, Date.now()));
          updatePendingStatus();
          if (message.expiresAt) pendingTimer = window.setInterval(updatePendingStatus, 1_000);
        } else if (message.type === "guard_decision") {
          clearPendingTimer();
          const command = message.command ? `: ${message.command}` : "";
          if (message.snapshotId) callbacksRef.current.onSnapshot(message.snapshotId);
          callbacksRef.current.onStatus(formatGuardDecision(message, command));
        } else {
          clearPendingTimer();
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
      clearPendingTimer();
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
  if (englishLocale) {
    if (message.outcome === "busy" && message.reason === "Another command from this member is waiting") return `A previous command is awaiting approval${command}`;
    if (message.outcome === "busy") return `Terminal is busy${command}`;
    if (message.outcome === "timeout") return `Approval timed out; command was not executed${command}`;
    if (message.outcome === "withdrawn") return `Request withdrawn${command}`;
    if (message.outcome === "rejected") return `${message.approverName ? `${message.approverName} rejected the command` : "Request rejected"}: ${guardServerReasonText(message.reason)}${command}`;
    if (message.outcome === "denied") return `Blocked: ${guardServerReasonText(message.reason, true)}${command}`;
    if (message.action === "allow_snapshot") return `Snapshot created; command executed${command}`;
    if (message.outcome === "approved") return message.reason.includes("approval.remembered")
      ? `Matching approval reused; command executed${command}`
      : `${message.approverName ? `${message.approverName} approved` : "Approved"}; executing${command}`;
    if (message.action === "allow") return `Executed${command}`;
    return `${guardServerReasonText(message.reason)}${command}`;
  }
  if (message.outcome === "busy" && message.reason === "Another command from this member is waiting") return `上一条命令还在 Team 里等待审批，处理后再发送新命令${command}`;
  if (message.outcome === "busy") return `终端正在运行其他程序，请等它结束${command}`;
  if (message.outcome === "timeout") return `⏱ 审批超时，命令没有执行${command}`;
  if (message.outcome === "withdrawn") return `↩ 已撤回${command}`;
  if (message.outcome === "rejected") return `✕ ${message.approverName ? `${message.approverName} 拒绝了这条命令` : "这条命令被拒绝"}：${guardServerReasonText(message.reason)}${command}`;
  if (message.outcome === "denied") {
    const reason = guardServerReasonText(message.reason, true);
    const controlHint = message.reason.startsWith("Interactive control is required")
      ? "。请在 Team → People 里选择 Take control 后重试"
      : "";
    return `✕ 已拦下：${reason}${controlHint}${command}`;
  }
  if (message.action === "allow_snapshot") return `✓ 已保存快照并执行${command}`;
  if (message.outcome === "approved") return message.reason.includes("approval.remembered")
    ? `✓ 同一类命令此前已批准，直接执行${command}`
    : `✓ ${message.approverName ? `${message.approverName} 已批准` : "已批准"}，正在执行${command}`;
  if (message.action === "allow") return `✓ 已执行${command}`;
  return `${guardServerReasonText(message.reason)}${command}`;
}

function formatGuardPending(message: Extract<TerminalServerMessage, { type: "guard_pending" }>, now = Date.now()) {
  if (englishLocale) {
    const waiting = message.noApprover ? "No eligible approver is online; waiting for one to join" : "Waiting for approval in the Team tab";
    if (message.llmUnavailable) return `Model review unavailable. ${waiting}`;
    const remaining = message.expiresAt ? Math.max(0, Math.ceil((Date.parse(message.expiresAt) - now) / 1000)) : undefined;
    const countdown = remaining === undefined ? "" : ` · ${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, "0")} remaining`;
    if (!message.llm) return `${waiting}${countdown}`;
    return `Model risk: ${guardRiskText(message.llm.risk)}; ${guardRecommendationText(message.llm.risk)} (${Math.round(message.llm.confidence * 100)}% confidence): ${message.llm.reason}. ${waiting}${countdown}`;
  }
  const waiting = message.noApprover ? "没有负责人在线，正在等待负责人加入" : "正在等待审批，请到 Team 标签页处理";
  if (message.llmUnavailable) return `模型暂时无法判断，${waiting}`;
  const remaining = message.expiresAt ? Math.max(0, Math.ceil((Date.parse(message.expiresAt) - now) / 1000)) : undefined;
  const countdown = remaining === undefined ? "" : ` · 剩余 ${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, "0")}`;
  if (!message.llm) return `${waiting}${countdown}`;
  return `模型判断风险${guardRiskText(message.llm.risk)}，${guardRecommendationText(message.llm.risk)}（置信度 ${Math.round(message.llm.confidence * 100)}%）：${message.llm.reason}。${waiting}${countdown}`;
}
