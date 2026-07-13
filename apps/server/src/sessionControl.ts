import { randomBytes } from "node:crypto";
import { nanoid } from "nanoid";
import type { SessionSettings } from "./types.js";

export function createHostAccessToken() {
  return randomBytes(24).toString("base64url");
}

export function createSessionControl({
  hostAccessToken,
  initialSettings
}: {
  hostAccessToken: string;
  initialSettings: SessionSettings;
}) {
  const hostSessions = new Set<string>();
  const listeners = new Set<(settings: SessionSettings) => void>();
  let settings = validateSettings(initialSettings);

  function claimHost(accessToken: string) {
    if (accessToken !== hostAccessToken) {
      throw new Error("Invalid host access token");
    }
    const sessionToken = nanoid(32);
    hostSessions.add(sessionToken);
    return sessionToken;
  }

  function isHostSession(sessionToken: string | undefined) {
    return Boolean(sessionToken && hostSessions.has(sessionToken));
  }

  function updateSettings(
    sessionToken: string | undefined,
    patch: Partial<SessionSettings>
  ) {
    if (!isHostSession(sessionToken)) {
      throw new Error("Host authorization required");
    }
    settings = validateSettings({ ...settings, ...patch });
    for (const listener of listeners) listener(getSettings());
    return getSettings();
  }

  function getSettings() {
    return { ...settings, commands: [...settings.commands] };
  }

  function onSettingsChanged(listener: (settings: SessionSettings) => void) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  return {
    claimHost,
    isHostSession,
    updateSettings,
    getSettings,
    onSettingsChanged
  };
}

export type SessionControl = ReturnType<typeof createSessionControl>;

function validateSettings(settings: SessionSettings): SessionSettings {
  if (
    !Number.isInteger(settings.commandTimeoutMs) ||
    settings.commandTimeoutMs < 1_000 ||
    settings.commandTimeoutMs > 300_000
  ) {
    throw new Error("Command timeout must be between 1000 and 300000 ms");
  }
  if (
    settings.commandMode !== "restricted" &&
    settings.commandMode !== "unrestricted"
  ) {
    throw new Error("Invalid command mode");
  }
  return {
    terminalEnabled: Boolean(settings.terminalEnabled),
    commandMode: settings.commandMode,
    commands: settings.commands.map((command) => command.trim()).filter(Boolean),
    commandTimeoutMs: settings.commandTimeoutMs,
    guestCanEditFiles: Boolean(settings.guestCanEditFiles),
    guestCanManageFiles: Boolean(settings.guestCanManageFiles),
    guestCanRunCommands: Boolean(settings.guestCanRunCommands)
  };
}
