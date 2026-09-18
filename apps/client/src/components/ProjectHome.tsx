import {
  Archive,
  FolderInput,
  FolderOpen,
  Moon,
  Plus,
  Sun,
  Trash2,
  X
} from "lucide-react";
import { type FormEvent, useEffect, useRef, useState } from "react";
import {
  createProject,
  deleteProject,
  getProjects,
  importExistingProject,
  importZipProject
} from "../api";
import type { ThemeMode } from "../theme";
import type { ProjectRecord } from "../types";

type ProjectAction = "blank" | "directory" | "zip";

export function ProjectHome({
  theme,
  onToggleTheme
}: {
  theme: ThemeMode;
  onToggleTheme(): void;
}) {
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [action, setAction] = useState<ProjectAction>();
  const [name, setName] = useState("");
  const [directoryPath, setDirectoryPath] = useState("");
  const [archive, setArchive] = useState<File>();
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [deletingProjectId, setDeletingProjectId] = useState<string>();
  const [error, setError] = useState("");
  const [projectListError, setProjectListError] = useState("");
  const archiveInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void refreshProjects()
      .catch((nextError) => {
        setProjectListError(
          nextError instanceof Error
            ? nextError.message
            : "Project list loading failed"
        );
      })
      .finally(() => setLoading(false));
  }, []);

  async function refreshProjects() {
    setProjects(await getProjects());
  }

  function selectAction(nextAction: ProjectAction) {
    setAction(nextAction);
    setName("");
    setDirectoryPath("");
    setArchive(undefined);
    setError("");
    setProjectListError("");
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!action) return;
    setSubmitting(true);
    setError("");
    try {
      let project: ProjectRecord;
      if (action === "blank") {
        project = (await createProject(name)).project;
      } else if (action === "directory") {
        project = (await importExistingProject(name, directoryPath)).project;
      } else {
        if (!archive) throw new Error("Choose a ZIP archive");
        project = (await importZipProject(name, archive)).project;
      }
      window.location.assign(`/projects/${encodeURIComponent(project.id)}`);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Project creation failed");
    } finally {
      setSubmitting(false);
    }
  }

  async function removeProject(project: ProjectRecord) {
    const confirmed = window.confirm(
      `Delete "${project.name}" and all stored code? This action cannot be undone.`
    );
    if (!confirmed) return;
    setDeletingProjectId(project.id);
    setProjectListError("");
    try {
      await deleteProject(project.id);
      await refreshProjects();
    } catch (nextError) {
      setProjectListError(
        nextError instanceof Error ? nextError.message : "Project deletion failed"
      );
    } finally {
      setDeletingProjectId(undefined);
    }
  }

  return (
    <main className="project-home">
      <header className="project-home-header">
        <div>
          <h1>SimpleRCP</h1>
          <span>Projects</span>
        </div>
        <button
          className="home-theme-toggle"
          type="button"
          onClick={onToggleTheme}
          aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
          title={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
          data-testid="theme-toggle"
        >
          {theme === "dark" ? <Sun size={17} /> : <Moon size={17} />}
        </button>
      </header>

      <section className="project-toolbar" aria-label="Project actions">
        <button type="button" onClick={() => selectAction("blank")} data-testid="new-project">
          <Plus size={16} /> New project
        </button>
        <button type="button" onClick={() => selectAction("directory")} data-testid="import-directory">
          <FolderInput size={16} /> Add directory
        </button>
        <button type="button" onClick={() => selectAction("zip")} data-testid="import-zip">
          <Archive size={16} /> Import ZIP
        </button>
      </section>

      {action ? (
        <form className="project-create-form" onSubmit={submit} data-testid="project-form">
          <div className="project-form-heading">
            <h2>{actionTitle(action)}</h2>
            <button
              type="button"
              className="icon-button"
              onClick={() => setAction(undefined)}
              aria-label="Close project form"
              title="Close"
            >
              <X size={16} />
            </button>
          </div>
          <label>
            <span>Project name</span>
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              required
              maxLength={100}
              autoFocus
              data-testid="project-name"
            />
          </label>
          {action === "directory" ? (
            <label>
              <span>Absolute server path</span>
              <input
                value={directoryPath}
                onChange={(event) => setDirectoryPath(event.target.value)}
                required
                placeholder="/srv/projects/example"
                data-testid="project-directory"
              />
            </label>
          ) : null}
          {action === "zip" ? (
            <label>
              <span>ZIP archive</span>
              <input
                ref={archiveInputRef}
                type="file"
                accept=".zip,application/zip"
                required
                onChange={(event) => setArchive(event.target.files?.[0])}
                data-testid="project-archive"
              />
            </label>
          ) : null}
          <div className="project-form-actions">
            <button type="submit" disabled={submitting} data-testid="create-project-submit">
              {submitting ? "Working" : "Create"}
            </button>
          </div>
          {error ? <p className="project-form-error">{error}</p> : null}
        </form>
      ) : null}

      <section className="project-list-section">
        <div className="project-list-heading">
          <h2>Available projects</h2>
          <span>{projects.length}</span>
        </div>
        {projectListError ? (
          <p className="project-list-error">{projectListError}</p>
        ) : null}
        {loading ? <p className="project-list-empty">Loading projects</p> : null}
        {!loading && !projectListError && projects.length === 0 ? (
          <p className="project-list-empty">No projects</p>
        ) : null}
        <ul className="project-list" data-testid="project-list">
          {projects.map((project) => (
            <li key={project.id}>
              <div className="project-list-icon"><FolderOpen size={18} /></div>
              <div className="project-list-main">
                <strong>{project.name}</strong>
                <span title={project.workspacePath}>{project.workspacePath}</span>
              </div>
              <time dateTime={project.lastOpenedAt}>
                {formatDate(project.lastOpenedAt)}
              </time>
              <div className="project-list-actions">
                <button
                  className="project-open"
                  type="button"
                  onClick={() => window.location.assign(`/projects/${encodeURIComponent(project.id)}`)}
                  data-testid={`open-project-${project.id}`}
                >
                  Open
                </button>
                {project.source !== "demo" ? (
                  <button
                    className="project-delete"
                    type="button"
                    onClick={() => void removeProject(project)}
                    disabled={Boolean(deletingProjectId)}
                    aria-label={`Delete ${project.name}`}
                    title="Delete project"
                    data-testid={`delete-project-${project.id}`}
                  >
                    <Trash2 size={15} />
                  </button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}

function actionTitle(action: ProjectAction) {
  if (action === "blank") return "New empty project";
  if (action === "directory") return "Add existing directory";
  return "Import ZIP archive";
}

function formatDate(timestamp: string) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(timestamp));
}
