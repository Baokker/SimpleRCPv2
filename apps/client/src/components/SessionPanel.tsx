import { Save } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
import type { RoomMember, SessionSettings } from "../types";

export function SessionPanel({
  member,
  settings,
  workspaceRoot,
  roomId,
  onSettingsChange
}: {
  member: RoomMember | null;
  settings: SessionSettings;
  workspaceRoot: string;
  roomId: string;
  onSettingsChange(settings: SessionSettings): Promise<void>;
}) {
  const [draft, setDraft] = useState(settings);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const isHost = member?.role === "host";

  useEffect(() => setDraft(settings), [settings]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!isHost) return;
    if (
      settings.commandMode !== "unrestricted" &&
      draft.commandMode === "unrestricted" &&
      !window.confirm(
        "Unrestricted mode allows shell commands in the workspace. Continue?"
      )
    ) {
      return;
    }
    setSaving(true);
    setError("");
    try {
      await onSettingsChange(draft);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="session-section" onSubmit={submit} data-testid="session-panel">
      <div className="session-group">
        <h2>Session</h2>
        <dl className="session-facts">
          <div>
            <dt>Role</dt>
            <dd>{isHost ? "Host" : "Guest"}</dd>
          </div>
          <div>
            <dt>Room</dt>
            <dd>{roomId || "-"}</dd>
          </div>
          <div>
            <dt>Workspace</dt>
            <dd title={workspaceRoot}>{workspaceRoot || "-"}</dd>
          </div>
        </dl>
      </div>

      <fieldset className="session-group" disabled={!isHost || saving}>
        <legend>Terminal</legend>
        <ToggleRow
          label="Enabled"
          checked={draft.terminalEnabled}
          onChange={(terminalEnabled) =>
            setDraft((value) => ({ ...value, terminalEnabled }))
          }
          testId="setting-terminal-enabled"
        />
        <label className="session-field">
          <span>Mode</span>
          <select
            value={draft.commandMode}
            onChange={(event) =>
              setDraft((value) => ({
                ...value,
                commandMode: event.target.value as SessionSettings["commandMode"]
              }))
            }
            data-testid="setting-command-mode"
          >
            <option value="restricted">Restricted</option>
            <option value="unrestricted">Unrestricted</option>
          </select>
        </label>
        <label className="session-field">
          <span>Allowed commands</span>
          <textarea
            value={draft.commands.join("\n")}
            onChange={(event) =>
              setDraft((value) => ({
                ...value,
                commands: event.target.value.split("\n")
              }))
            }
            data-testid="setting-commands"
          />
        </label>
        <label className="session-field compact">
          <span>Timeout (seconds)</span>
          <input
            type="number"
            min={1}
            max={300}
            value={draft.commandTimeoutMs / 1000}
            onChange={(event) =>
              setDraft((value) => ({
                ...value,
                commandTimeoutMs: Number(event.target.value) * 1000
              }))
            }
            data-testid="setting-command-timeout"
          />
        </label>
      </fieldset>

      <fieldset className="session-group" disabled={!isHost || saving}>
        <legend>Guest permissions</legend>
        <ToggleRow
          label="Edit files"
          checked={draft.guestCanEditFiles}
          onChange={(guestCanEditFiles) =>
            setDraft((value) => ({ ...value, guestCanEditFiles }))
          }
          testId="setting-guest-edit"
        />
        <ToggleRow
          label="Create, rename, and delete"
          checked={draft.guestCanManageFiles}
          onChange={(guestCanManageFiles) =>
            setDraft((value) => ({ ...value, guestCanManageFiles }))
          }
          testId="setting-guest-manage"
        />
        <ToggleRow
          label="Run commands"
          checked={draft.guestCanRunCommands}
          onChange={(guestCanRunCommands) =>
            setDraft((value) => ({ ...value, guestCanRunCommands }))
          }
          testId="setting-guest-run"
        />
      </fieldset>

      {isHost ? (
        <button className="session-save" type="submit" disabled={saving} data-testid="save-session-settings">
          <Save size={14} />
          {saving ? "Saving" : "Save"}
        </button>
      ) : null}
      {error ? <p className="session-error">{error}</p> : null}
    </form>
  );
}

function ToggleRow({
  label,
  checked,
  onChange,
  testId
}: {
  label: string;
  checked: boolean;
  onChange(value: boolean): void;
  testId: string;
}) {
  return (
    <label className="session-toggle">
      <span>{label}</span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        data-testid={testId}
      />
    </label>
  );
}
