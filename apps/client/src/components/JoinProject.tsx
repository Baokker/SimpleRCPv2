import { ArrowLeft, LogIn } from "lucide-react";
import { type FormEvent, useState } from "react";
import type { ProjectParticipant } from "../types";
import { rememberMember, storedMemberId } from "../memberIdentity";

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
  const storedId = storedMemberId(projectId);
  const storedMember = participants.find((participant) => participant.id === storedId);
  const [memberId, setMemberId] = useState(storedMember?.id ?? "new");
  const [displayName, setDisplayName] = useState(
    storedMember?.displayName ??
      window.localStorage.getItem("simplercp.displayName") ??
      ""
  );
  const [role, setRole] = useState(storedMember?.profileRole ?? "");

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
        <ArrowLeft size={16} /> 项目列表
      </button>
      <form onSubmit={submit} data-testid="join-project-form">
        <h1>{projectName}</h1>
        {participants.length > 0 ? (
          <label>
            <span>参与者</span>
            <select
              value={memberId}
              onChange={(event) => selectMember(event.target.value)}
              data-testid="participant-select"
            >
              {participants.map((participant) => (
                <option key={participant.id} value={participant.id}>
                  {participant.displayName}
                  {participant.profileRole ? ` (${participant.profileRole})` : ""}
                </option>
              ))}
              <option value="new">新建参与者</option>
            </select>
          </label>
        ) : null}
        <label>
          <span>显示名称</span>
          <input
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            required
            autoFocus
            data-testid="display-name"
          />
        </label>
        <label>
          <span>角色 <small>可选</small></span>
          <input
            value={role}
            onChange={(event) => setRole(event.target.value)}
            placeholder="例如设计、开发、审阅"
            data-testid="member-role"
          />
        </label>
        <button type="submit" data-testid="join-project">
          <LogIn size={16} /> 进入项目
        </button>
      </form>
    </main>
  );
}
