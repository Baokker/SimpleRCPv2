import { ArrowLeft, LogIn } from "lucide-react";
import { type FormEvent, useState } from "react";

export interface ProjectIdentity {
  displayName: string;
  role: string;
}

export function JoinProject({
  projectName,
  onJoin
}: {
  projectName: string;
  onJoin(identity: ProjectIdentity): void;
}) {
  const [displayName, setDisplayName] = useState(
    window.localStorage.getItem("simplercp.displayName") ?? ""
  );
  const [role, setRole] = useState("");

  function submit(event: FormEvent) {
    event.preventDefault();
    const name = displayName.trim();
    if (!name) return;
    window.localStorage.setItem("simplercp.displayName", name);
    onJoin({ displayName: name, role: role.trim() });
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
          <input
            value={role}
            onChange={(event) => setRole(event.target.value)}
            placeholder="Designer, developer, reviewer"
            data-testid="member-role"
          />
        </label>
        <button type="submit" data-testid="join-project">
          <LogIn size={16} /> Enter project
        </button>
      </form>
    </main>
  );
}
