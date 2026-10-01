import { ArrowLeft, LogIn } from "lucide-react";
import { type FormEvent, useState } from "react";
import type { ProjectParticipant } from "../types";

export interface ProjectIdentity {
  participantId?: string;
  memberId?: string;
  displayName: string;
  role: string;
}

export function JoinProject({
  projectName,
  projectId,
  participants,
  onJoin
}: {
  projectName: string;
  projectId: string;
  participants: ProjectParticipant[];
  onJoin(identity: ProjectIdentity): void | Promise<void>;
}) {
  const storedParticipantId = readStoredParticipantId(projectId, participants);
  const storedParticipant = participants.find(
    (participant) => participant.id === storedParticipantId
  );
  const [participantId, setParticipantId] = useState(
    storedParticipant?.id ?? "new"
  );
  const [displayName, setDisplayName] = useState(
    storedParticipant?.displayName ??
      window.localStorage.getItem("simplercp.displayName") ??
      ""
  );

  function selectParticipant(nextParticipantId: string) {
    setParticipantId(nextParticipantId);
    const participant = participants.find(
      (candidate) => candidate.id === nextParticipantId
    );
    if (!participant) {
      setDisplayName("");
      return;
    }
    setDisplayName(participant.displayName);
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    const name = displayName.trim();
    if (!name) return;
    window.localStorage.setItem("simplercp.displayName", name);
    const selectedParticipantId = participantId === "new" ? undefined : participantId;
    if (selectedParticipantId) {
      rememberParticipant(projectId, selectedParticipantId);
    }
    void onJoin({
      participantId: selectedParticipantId,
      displayName: name,
      role: "member"
    });
  }

  return (
    <main className="join-project">
      <button
        type="button"
        className="join-back"
        onClick={() => window.location.assign("/")}
      >
        <ArrowLeft size={16} /> Projects
      </button>
      <form onSubmit={submit} data-testid="join-project-form">
        <h1>{projectName}</h1>
        {participants.length > 0 ? (
          <label>
            <span>Participant</span>
            <select
              value={participantId}
              onChange={(event) => selectParticipant(event.target.value)}
              data-testid="participant-select"
            >
              {participants.map((participant) => (
                <option key={participant.id} value={participant.id}>
                  {participant.displayName}
                  {participant.profileRole ? ` · ${participant.profileRole}` : ""}
                </option>
              ))}
              <option value="new">Create a new participant</option>
            </select>
          </label>
        ) : null}
        <label>
          <span>Display name</span>
          <input
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            required
            autoFocus
            data-testid="display-name"
          />
        </label>
        <button type="submit" data-testid="join-project">
          <LogIn size={16} /> Enter project
        </button>
      </form>
    </main>
  );
}

function readStoredParticipantId(
  projectId: string,
  participants: ProjectParticipant[]
) {
  const sessionKey = `simplercp.participantId.${projectId}`;
  const localKey = `simplercp.recentParticipantId.${projectId}`;
  const stored =
    window.sessionStorage.getItem(sessionKey) ??
    window.localStorage.getItem(localKey);
  return participants.some((participant) => participant.id === stored)
    ? stored ?? undefined
    : undefined;
}

export function rememberParticipant(projectId: string, participantId: string) {
  window.sessionStorage.setItem(
    `simplercp.participantId.${projectId}`,
    participantId
  );
  window.localStorage.setItem(
    `simplercp.recentParticipantId.${projectId}`,
    participantId
  );
}
