import type { Locale, Translate } from "./i18n/messages";
import type { ConnectionState } from "./socket";
import type { AgentRun, AgentRuntimeStatus } from "./types";

const connectionKeys = {
  Connecting: "connecting", Connected: "connected", Reconnecting: "reconnecting", Offline: "offline"
} as const;
const runtimeKeys = {
  ready: "runtimeReady", disabled: "runtimeDisabled", unavailable: "runtimeUnavailable"
} as const;

export function connectionText(t: Translate, state: ConnectionState) {
  return t(connectionKeys[state]);
}

export function runtimeText(t: Translate, state: AgentRuntimeStatus["state"]) {
  return t("openCodeState", { state: t(runtimeKeys[state]) });
}

export function runStatusText(t: Translate, status: AgentRun["status"]) {
  return t(status);
}

export type SaveState = "Saved" | "Saving" | "Sync failed";
const saveKeys = { Saved: "saved", Saving: "saving", "Sync failed": "syncFailed" } as const;

export function saveStateText(t: Translate, state: SaveState) {
  return t(saveKeys[state]);
}

export function formatDate(locale: Locale, timestamp: string) {
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(timestamp));
}

export function formatTime(locale: Locale, timestamp: string, includeSeconds = false): string {
  return new Intl.DateTimeFormat(locale, {
    hour: "2-digit",
    minute: "2-digit",
    ...(includeSeconds ? { second: "2-digit" } : {})
  }).format(new Date(timestamp));
}
