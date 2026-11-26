import { X } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";

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
  const [path, setPath] = useState(initialValue(action));
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    setPath(initialValue(action));
    setError("");
  }, [action]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const nextPath = path.trim();
    if (action.type !== "delete" && !nextPath) return;
    setSubmitting(true);
    setError("");
    try {
      await onSubmit(nextPath);
      onClose();
    } catch (nextError) {
      setError(
        nextError instanceof Error ? nextError.message : "Workspace operation failed"
      );
    } finally {
      setSubmitting(false);
    }
  }

  const content = dialogContent(action);
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
            aria-label="Close dialog"
            title="Close"
          >
            <X size={16} />
          </button>
        </div>
        <p>{content.description}</p>
        {action.type === "delete" ? (
          <strong className="workspace-delete-path">{action.path}</strong>
        ) : (
          <label>
            <span>Path from project root</span>
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
        {error ? <p className="workspace-dialog-error">{error}</p> : null}
        <div className="workspace-dialog-actions">
          <button type="button" onClick={onClose} disabled={submitting}>
            Cancel
          </button>
          <button
            type="submit"
            className={action.type === "delete" ? "danger" : "primary"}
            disabled={submitting}
            data-testid="workspace-dialog-submit"
          >
            {submitting ? "Working" : content.submitLabel}
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

function dialogContent(action: WorkspaceDialogAction) {
  if (action.type === "create-file") {
    return {
      title: "Create file",
      description: "Enter a path including the file name and extension.",
      placeholder: "src/components/Button.tsx",
      submitLabel: "Create file"
    };
  }
  if (action.type === "create-folder") {
    return {
      title: "Create folder",
      description: "Enter the folder path from the project root.",
      placeholder: "src/components",
      submitLabel: "Create folder"
    };
  }
  if (action.type === "rename") {
    return {
      title: "Rename path",
      description: "Enter the new path from the project root.",
      placeholder: action.path,
      submitLabel: "Rename"
    };
  }
  return {
    title: "Delete path",
    description: "This removes the selected file or folder for every collaborator.",
    placeholder: "",
    submitLabel: "Delete"
  };
}
