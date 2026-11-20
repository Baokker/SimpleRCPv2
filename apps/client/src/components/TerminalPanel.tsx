import { RotateCcw } from "lucide-react";
import { useRef, useState } from "react";
import type { ThemeMode } from "../theme";
import { useI18n } from "../i18n";
import { connectionText } from "../format";
import type { ConnectionState } from "../socket";
import {
  SharedTerminal,
  type SharedTerminalHandle
} from "./SharedTerminal";

export function TerminalPanel({
  projectId,
  theme,
  canRun,
  memberId
}: {
  projectId: string;
  theme: ThemeMode;
  canRun: boolean;
  memberId: string;
}) {
  const { t } = useI18n();
  const terminalRef = useRef<SharedTerminalHandle>(null);
  const [connectionState, setConnectionState] = useState<ConnectionState>("Connecting");

  return (
    <div className="panel terminal-panel">
      <div className="panel-header terminal-header">
        <span>{t("sharedTerminal")}</span>
        <div className="terminal-controls">
          <span className="terminal-state" data-testid="terminal-state">
            {t("sharedTerminalState", { state: connectionText(t, connectionState) })}
          </span>
          {connectionState === "Offline" ? (
            <button
              className="terminal-reconnect"
              type="button"
              onClick={() => terminalRef.current?.reconnect()}
            >
              {t("reconnect")}
            </button>
          ) : null}
          <button
            className="terminal-restart"
            onClick={() => terminalRef.current?.restart()}
            title={t("restartTerminal")}
            aria-label={t("restartTerminal")}
            data-testid="terminal-restart"
          >
            <RotateCcw size={14} />
          </button>
        </div>
      </div>
      <div className="shared-terminal">
        <SharedTerminal
          ref={terminalRef}
          projectId={projectId}
          memberId={memberId}
          canInput={canRun}
          theme={theme}
          onConnectionState={setConnectionState}
        />
      </div>
    </div>
  );
}
