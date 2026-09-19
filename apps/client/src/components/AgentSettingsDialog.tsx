import { Bot, X } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
import {
  getAgentSettings,
  getAgentStatus,
  updateAgentSettings
} from "../api";
import type { AgentRuntimeStatus, AgentSettingsResponse } from "../types";

export function AgentSettingsDialog({ onClose }: { onClose(): void }) {
  const [settings, setSettings] = useState<AgentSettingsResponse>();
  const [runtime, setRuntime] = useState<AgentRuntimeStatus>();
  const [model, setModel] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    void Promise.all([getAgentSettings(), getAgentStatus()])
      .then(([nextSettings, nextRuntime]) => {
        if (!active) return;
        setSettings(nextSettings);
        setRuntime(nextRuntime);
        setModel(nextSettings.model);
        setEnabled(nextSettings.enabled);
      })
      .catch((nextError) => {
        if (!active) return;
        setError(
          nextError instanceof Error
            ? nextError.message
            : "Agent settings could not be loaded"
        );
      });
    return () => {
      active = false;
    };
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      await updateAgentSettings({
        provider: "deepseek",
        model,
        enabled
      });
      onClose();
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : "Agent settings could not be saved"
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="dialog-backdrop" role="presentation">
      <form
        className="workspace-dialog agent-settings-dialog"
        onSubmit={submit}
        data-testid="agent-settings-dialog"
      >
        <div className="workspace-dialog-heading">
          <div className="agent-settings-title">
            <Bot size={17} />
            <h2>Agent settings</h2>
          </div>
          <button
            type="button"
            className="icon-button"
            onClick={onClose}
            aria-label="Close Agent settings"
            title="Close"
          >
            <X size={16} />
          </button>
        </div>

        {runtime ? (
          <dl className="agent-settings-facts">
            <div>
              <dt>Runtime</dt>
              <dd>
                OpenCode {titleCase(runtime.state)}
                {runtime.version ? ` · v${runtime.version}` : ""}
              </dd>
            </div>
            <div><dt>Provider</dt><dd>DeepSeek</dd></div>
            <div>
              <dt>API Key</dt>
              <dd>{settings?.apiKeyConfigured ? "Configured" : "Missing"}</dd>
            </div>
          </dl>
        ) : (
          <p>Checking OpenCode</p>
        )}

        <label>
          <span>Model</span>
          <input
            value={model}
            onChange={(event) => setModel(event.target.value)}
            required
            disabled={!settings}
            data-testid="agent-settings-model"
          />
        </label>
        <label className="agent-enabled-setting">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(event) => setEnabled(event.target.checked)}
            disabled={!settings}
          />
          <span>Enable Agent</span>
        </label>

        {error ? <p className="workspace-dialog-error">{error}</p> : null}
        <div className="workspace-dialog-actions">
          <button type="button" onClick={onClose}>Cancel</button>
          <button
            className="primary"
            type="submit"
            disabled={!settings || saving || !model.trim()}
            data-testid="agent-settings-save"
          >
            {saving ? "Saving" : "Save"}
          </button>
        </div>
      </form>
    </div>
  );
}

function titleCase(value: string) {
  return `${value.slice(0, 1).toUpperCase()}${value.slice(1)}`;
}
