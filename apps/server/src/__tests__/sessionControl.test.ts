import { describe, expect, it, vi } from "vitest";
import { createSessionControl } from "../sessionControl.js";

describe("session control", () => {
  it("exchanges the startup secret for a host session", () => {
    const control = createSessionControl({
      hostAccessToken: "host-secret",
      initialSettings: {
        terminalEnabled: true,
        commandMode: "restricted",
        commands: ["npm test"],
        commandTimeoutMs: 30_000,
        guestCanEditFiles: true,
        guestCanManageFiles: true,
        guestCanRunCommands: true
      }
    });

    expect(() => control.claimHost("wrong-secret")).toThrow(
      "Invalid host access token"
    );
    const sessionToken = control.claimHost("host-secret");
    expect(control.isHostSession(sessionToken)).toBe(true);
    expect(control.isHostSession("unknown-session")).toBe(false);
  });

  it("validates and publishes runtime setting changes", () => {
    const control = createSessionControl({
      hostAccessToken: "host-secret",
      initialSettings: {
        terminalEnabled: true,
        commandMode: "restricted",
        commands: ["npm test"],
        commandTimeoutMs: 30_000,
        guestCanEditFiles: true,
        guestCanManageFiles: true,
        guestCanRunCommands: true
      }
    });
    const sessionToken = control.claimHost("host-secret");
    const listener = vi.fn();
    control.onSettingsChanged(listener);

    const settings = control.updateSettings(sessionToken, {
      terminalEnabled: false,
      commandMode: "unrestricted",
      commands: [" npm test ", ""],
      commandTimeoutMs: 45_000,
      guestCanEditFiles: false,
      guestCanManageFiles: false,
      guestCanRunCommands: false
    });

    expect(settings).toEqual({
      terminalEnabled: false,
      commandMode: "unrestricted",
      commands: ["npm test"],
      commandTimeoutMs: 45_000,
      guestCanEditFiles: false,
      guestCanManageFiles: false,
      guestCanRunCommands: false
    });
    expect(listener).toHaveBeenCalledWith(settings);
    expect(() =>
      control.updateSettings("guest", { commandTimeoutMs: 500 })
    ).toThrow("Host authorization required");
  });
});
