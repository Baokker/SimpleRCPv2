import { X } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
import { useI18n } from "../i18n";
import { captureError, errorText, messageError, type Translate } from "../i18n/messages";

export type WorkspaceDialogAction =
  | { type: "create-file"; initialPath: string }
  | { type: "create-folder"; initialPath: string }
  | { type: "rename"; path: string }
  | { type: "delete"; path: string };

export function WorkspaceDialog({
  action,
  onClose,
  onSubmit
}: {
  action: WorkspaceDialogAction;
  onClose(): void;
  onSubmit(path: string): Promise<void>;
}) {
  const { t } = useI18n();
  const [path, setPath] = useState(initialValue(action));
  const [error, setError] = useState<Error>();
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    setPath(initialValue(action));
    setError(undefined);
  }, [action]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const nextPath = path.trim();
    if (action.type !== "delete" && !nextPath) return;
    setSubmitting(true);
    setError(undefined);
    try {
      await onSubmit(nextPath);
      onClose();
    } catch (nextError) {
      setError(captureError(nextError, messageError("workspaceOperationFailed")));
    } finally {
      setSubmitting(false);
    }
  }

  const content = dialogContent(t, action);
  return (
    <div className="dialog-backdrop" role="presentation">
      <form
        className="workspace-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="workspace-dialog-title"
        onSubmit={submit}
        data-testid="workspace-dialog"
      >
        <div className="workspace-dialog-heading">
          <h2 id="workspace-dialog-title">{content.title}</h2>
          <button
            type="button"
            className="icon-button"
            onClick={onClose}
            disabled={submitting}
            aria-label={t("closeDialog")}
            title={t("close")}
          >
            <X size={16} />
          </button>
        </div>
        <p>{content.description}</p>
        {action.type === "delete" ? (
          <strong className="workspace-delete-path">{action.path}</strong>
        ) : (
          <label>
            <span>{t("pathFromRoot")}</span>
            <input
              value={path}
              onChange={(event) => setPath(event.target.value)}
              placeholder={content.placeholder}
              autoFocus
              required
              data-testid="workspace-path-input"
            />
          </label>
        )}
        {error ? <p className="workspace-dialog-error">{errorText(t, error, t("workspaceOperationFailed"))}</p> : null}
        <div className="workspace-dialog-actions">
          <button type="button" onClick={onClose} disabled={submitting}>
            {t("cancel")}
          </button>
          <button
            type="submit"
            className={action.type === "delete" ? "danger" : "primary"}
            disabled={submitting}
            data-testid="workspace-dialog-submit"
          >
            {submitting ? t("working") : content.submitLabel}
          </button>
        </div>
      </form>
    </div>
  );
}

function initialValue(action: WorkspaceDialogAction) {
  if (action.type === "rename") return action.path;
  if (action.type === "delete") return action.path;
  return action.initialPath;
}

function dialogContent(t: Translate, action: WorkspaceDialogAction) {
  if (action.type === "create-file") {
    return {
      title: t("createFile"),
      description: t("createFileDescription"),
      placeholder: "src/components/Button.tsx",
      submitLabel: t("createFile")
    };
  }
  if (action.type === "create-folder") {
    return {
      title: t("createFolder"),
      description: t("createFolderDescription"),
      placeholder: "src/components",
      submitLabel: t("createFolder")
    };
  }
  if (action.type === "rename") {
    return {
      title: t("rename"),
      description: t("renameDescription"),
      placeholder: action.path,
      submitLabel: t("rename")
    };
  }
  return {
    title: t("delete"),
    description: t("deleteDescription"),
    placeholder: "",
    submitLabel: t("delete")
  };
}
