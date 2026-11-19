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
        nextError instanceof Error ? nextError.message : "工作区操作失败"
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
            aria-label="关闭对话框"
            title="关闭"
          >
            <X size={16} />
          </button>
        </div>
        <p>{content.description}</p>
        {action.type === "delete" ? (
          <strong className="workspace-delete-path">{action.path}</strong>
        ) : (
          <label>
            <span>从项目根目录开始的路径</span>
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
            取消
          </button>
          <button
            type="submit"
            className={action.type === "delete" ? "danger" : "primary"}
            disabled={submitting}
            data-testid="workspace-dialog-submit"
          >
            {submitting ? "处理中" : content.submitLabel}
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
      title: "新建文件",
      description: "输入包含文件名和扩展名的路径。",
      placeholder: "src/components/Button.tsx",
      submitLabel: "新建文件"
    };
  }
  if (action.type === "create-folder") {
    return {
      title: "新建文件夹",
      description: "输入从项目根目录开始的文件夹路径。",
      placeholder: "src/components",
      submitLabel: "新建文件夹"
    };
  }
  if (action.type === "rename") {
    return {
      title: "重命名",
      description: "输入从项目根目录开始的新路径。",
      placeholder: action.path,
      submitLabel: "重命名"
    };
  }
  return {
    title: "删除",
    description: "选中的文件或文件夹会对所有协作者删除。",
    placeholder: "",
    submitLabel: "删除"
  };
}
