import { useEffect, useRef, useState } from "react";
import { useI18n } from "../i18n";
import { captureError, errorText, messageError, type Translate } from "../i18n/messages";

const WORKSPACE_NOTICE_DURATION_MS = 4_000;
const projectDeletedError = messageError("projectDeleted");

export function useWorkspaceNotifications() {
  const { t } = useI18n();
  const [workspaceNotice, setWorkspaceNotice] = useState<(t: Translate) => string>();
  const [workspaceError, setWorkspaceError] = useState<Error>();
  const projectDeletedRef = useRef(false);

  useEffect(() => {
    if (!workspaceNotice) return;
    const timer = window.setTimeout(
      () => setWorkspaceNotice(undefined),
      WORKSPACE_NOTICE_DURATION_MS
    );
    return () => window.clearTimeout(timer);
  }, [workspaceNotice]);

  return {
    workspaceNotice: workspaceNotice?.(t),
    workspaceError: errorText(t, workspaceError, ""),
    showWorkspaceNotice(notice: (translate: Translate) => string) {
      setWorkspaceNotice(() => notice);
    },
    clearWorkspaceNotice() {
      setWorkspaceNotice(undefined);
    },
    showWorkspaceError(error: unknown) {
      if (projectDeletedRef.current) return;
      setWorkspaceError(captureError(error, messageError("workspaceRequestFailed")));
    },
    clearWorkspaceError() {
      if (!projectDeletedRef.current) setWorkspaceError(undefined);
    },
    dismissWorkspaceError() {
      setWorkspaceError(undefined);
    },
    showProjectDeleted() {
      projectDeletedRef.current = true;
      setWorkspaceError(projectDeletedError);
    },
    projectDeleted: projectDeletedRef.current
  };
}
