import { Bot, X } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
import {
  getAgentSettings,
  getAgentStatus,
  updateAgentSettings
} from "../api";
import type { AgentRuntimeStatus, AgentSettingsResponse } from "../types";
import { runtimeText } from "../format";
import { useI18n } from "../i18n";
import { errorText, messageError } from "../i18n/messages";

export function AgentSettingsDialog({ onClose }: { onClose(): void }) {
  const { t } = useI18n();
  const [settings, setSettings] = useState<AgentSettingsResponse>();
  const [runtime, setRuntime] = useState<AgentRuntimeStatus>();
  const [model, setModel] = useState("");
  const [provider, setProvider] = useState<"deepseek" | "minimax">("deepseek");
  const [enabled, setEnabled] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<unknown>();

  useEffect(() => {
    let active = true;
    void Promise.all([getAgentSettings(), getAgentStatus()])
      .then(([nextSettings, nextRuntime]) => {
        if (!active) return;
        setSettings(nextSettings);
        setRuntime(nextRuntime);
        setModel(nextSettings.model);
        setProvider(nextSettings.provider);
        setEnabled(nextSettings.enabled);
      })
      .catch((nextError) => {
        if (!active) return;
        setError(nextError instanceof Error ? nextError : messageError("agentSettingsLoadFailed"));
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
        provider,
        model,
        enabled
      });
      onClose();
    } catch (nextError) {
      setError(nextError ?? messageError("agentSettingsSaveFailed"));
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
            <h2>{t("agentSettings")}</h2>
          </div>
          <button
            type="button"
            className="icon-button"
            onClick={onClose}
            aria-label={t("closeAgentSettings")}
            title={t("close")}
          >
            <X size={16} />
          </button>
        </div>

        {runtime ? (
          <dl className="agent-settings-facts">
            <div>
              <dt>{t("runtime")}</dt>
              <dd>
                {runtimeText(t, runtime.state)}
                {runtime.version ? t("runtimeVersion", { version: runtime.version }) : ""}
              </dd>
            </div>
            {runtime.modelChangePending ? (
              <div><dt>{t("model")}</dt><dd>{t("modelChangePending")}</dd></div>
            ) : null}
            <div><dt>{t("provider")}</dt><dd>{provider === "minimax" ? "MiniMax" : "DeepSeek"}</dd></div>
            <div>
              <dt>API Key</dt>
              <dd>{t(settings?.apiKeyConfigured ? "configured" : "missing")}</dd>
            </div>
          </dl>
        ) : (
          <p>{t("checkingOpenCode")}</p>
        )}

        <label>
          <span>{t("model")}</span>
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
          <span>{t("enableAgent")}</span>
        </label>

        {error ? <p className="workspace-dialog-error">{errorText(t, error, t("agentSettingsSaveFailed"))}</p> : null}
        <div className="workspace-dialog-actions">
          <button type="button" onClick={onClose}>{t("cancel")}</button>
          <button
            className="primary"
            type="submit"
            disabled={!settings || saving || !model.trim()}
            data-testid="agent-settings-save"
          >
            {t(saving ? "saving" : "save")}
          </button>
        </div>
      </form>
    </div>
  );
}
