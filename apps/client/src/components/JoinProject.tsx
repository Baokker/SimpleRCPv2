import { ArrowLeft, LogIn } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
import type { ProjectParticipant } from "../types";
import { rememberMember, sessionMemberId } from "../memberIdentity";
import { getGuardRoles, type GuardScenarioRole } from "../api";

export interface ProjectIdentity {
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
  const storedId = sessionMemberId(projectId);
  const storedMember = participants.find((participant) => participant.id === storedId);
  const [memberId, setMemberId] = useState(storedMember?.id ?? "new");
  const [displayName, setDisplayName] = useState(
    storedMember?.displayName ??
      window.localStorage.getItem("simplercp.displayName") ??
      ""
  );
  const [role, setRole] = useState(storedMember?.profileRole ?? "");
  const [scenarioRoles, setScenarioRoles] = useState<GuardScenarioRole[]>([]);

  useEffect(() => {
    void getGuardRoles().then((result) => setScenarioRoles(result.scenarios));
  }, []);

  function selectMember(nextMemberId: string) {
    setMemberId(nextMemberId);
    const member = participants.find((candidate) => candidate.id === nextMemberId);
    if (!member) {
      setDisplayName("");
      setRole("");
      return;
    }
    setDisplayName(member.displayName);
    setRole(member.profileRole ?? "");
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    const name = displayName.trim();
    if (!name) return;
    window.localStorage.setItem("simplercp.displayName", name);
    const selectedMemberId = memberId === "new" ? undefined : memberId;
    if (selectedMemberId) rememberMember(projectId, selectedMemberId);
    void onJoin({
      memberId: selectedMemberId,
      displayName: name,
      role: role.trim()
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
              value={memberId}
              onChange={(event) => selectMember(event.target.value)}
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
        <label>
          <span>Role <small>Optional</small></span>
          <select
            value={role}
            onChange={(event) => setRole(event.target.value)}
            data-testid="member-role"
          >
            <option value="">Unassigned (collaborator)</option>
            {groupRoles(scenarioRoles).map(([scenario, entries]) => (
              <optgroup key={scenario} label={entries[0]?.scenarioDisplayName ?? scenario}>
                {entries.map((entry) => (
                  <option key={entry.role} value={entry.role}>{entry.displayName} — {entry.level}</option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>
        <button type="submit" data-testid="join-project">
          <LogIn size={16} /> Enter project
        </button>
      </form>
    </main>
  );
}

function groupRoles(entries: GuardScenarioRole[]) {
  const groups = new Map<string, GuardScenarioRole[]>();
  for (const entry of entries) groups.set(entry.scenario, [...(groups.get(entry.scenario) ?? []), entry]);
  return [...groups.entries()];
}
