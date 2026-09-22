import { useEffect, useState } from "react";
import { getParticipants, getProject, getServerInfo } from "../api";
import type { ProjectIdentity } from "../components/JoinProject";
import type { ProjectParticipant, ProjectRecord } from "../types";

interface ProjectRouteState {
  project?: ProjectRecord;
  roomId: string;
  participants: ProjectParticipant[];
  terminalEnabled: boolean;
  identity?: ProjectIdentity;
  loading: boolean;
  error: string;
}

export function useProjectRoute(projectId: string) {
  const [state, setState] = useState<ProjectRouteState>({
    roomId: "",
    participants: [],
    terminalEnabled: true,
    loading: true,
    error: ""
  });
  const [loadAttempt, setLoadAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    const params = new URLSearchParams(window.location.search);
    const queryName = params.get("name")?.trim();

    setState((current) => ({ ...current, loading: true, error: "" }));
    void Promise.all([
      getProject(projectId),
      getParticipants(projectId),
      getServerInfo()
    ])
      .then(([result, participants, serverInfo]) => {
        if (!active) return;
        setState({
          project: result.project,
          roomId: result.roomId,
          participants,
          terminalEnabled: serverInfo.features.terminal,
          identity: queryName
            ? {
                participantId: participants.find(
                  (participant) => participant.displayName === queryName
                )?.id,
                displayName: queryName,
                role: params.get("role")?.trim() ?? ""
              }
            : undefined,
          loading: false,
          error: ""
        });
      })
      .catch((error) => {
        if (!active) return;
        setState((current) => ({
          ...current,
          loading: false,
          error: error instanceof Error ? error.message : "Project loading failed"
        }));
      });

    return () => {
      active = false;
    };
  }, [loadAttempt, projectId]);

  return {
    ...state,
    setIdentity(identity: ProjectIdentity) {
      setState((current) => ({ ...current, identity }));
    },
    retry() {
      setLoadAttempt((attempt) => attempt + 1);
    }
  };
}
