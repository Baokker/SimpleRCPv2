import { useEffect, useRef, useState } from "react";

const WORKSPACE_NOTICE_DURATION_MS = 4_000;
const PROJECT_DELETED_MESSAGE = "This project was deleted.";

export function useWorkspaceNotifications() {
  const [workspaceNotice, setWorkspaceNotice] = useState("");
  const [workspaceError, setWorkspaceError] = useState("");
  const projectDeletedRef = useRef(false);

  useEffect(() => {
    if (!workspaceNotice) return;
    const timer = window.setTimeout(
      () => setWorkspaceNotice(""),
      WORKSPACE_NOTICE_DURATION_MS
    );
    return () => window.clearTimeout(timer);
  }, [workspaceNotice]);

  return {
    workspaceNotice,
    workspaceError,
    showWorkspaceNotice: setWorkspaceNotice,
    clearWorkspaceNotice() {
      setWorkspaceNotice("");
    },
    showWorkspaceError(error: unknown) {
      if (projectDeletedRef.current) return;
      setWorkspaceError(
        error instanceof Error ? error.message : "Workspace request failed"
      );
    },
    clearWorkspaceError() {
      setWorkspaceError("");
    },
    showProjectDeleted() {
      projectDeletedRef.current = true;
      setWorkspaceError(PROJECT_DELETED_MESSAGE);
    },
    projectDeleted: workspaceError === PROJECT_DELETED_MESSAGE
  };
}
