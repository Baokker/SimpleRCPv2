import {
  Archive,
  Bot,
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
import { AgentSettingsDialog } from "./AgentSettingsDialog";
import { LanguageSwitcher } from "./LanguageSwitcher";
import { formatDate } from "../format";
import { useI18n } from "../i18n";
import { errorText, messageError } from "../i18n/messages";

type ProjectAction = "blank" | "directory" | "zip";
const actionTitles = { blank: "newEmptyProject", directory: "addExistingDirectory", zip: "importZipArchive" } as const;

export function ProjectHome({
  theme,
  onToggleTheme
}: {
  theme: ThemeMode;
  onToggleTheme(): void;
}) {
  const { locale, t } = useI18n();
  const themeLabel = t(theme === "dark" ? "lightMode" : "darkMode");
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [action, setAction] = useState<ProjectAction>();
  const [name, setName] = useState("");
  const [directoryPath, setDirectoryPath] = useState("");
  const [archive, setArchive] = useState<File>();
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [deletingProjectId, setDeletingProjectId] = useState<string>();
  const [error, setError] = useState<unknown>();
  const [projectListError, setProjectListError] = useState<unknown>();
  const [agentSettingsOpen, setAgentSettingsOpen] = useState(false);
  const archiveInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void refreshProjects()
      .catch((nextError) => {
        setProjectListError(nextError ?? messageError("projectListLoadFailed"));
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
        if (!archive) throw messageError("chooseZip");
        project = (await importZipProject(name, archive)).project;
      }
      window.location.assign(`/projects/${encodeURIComponent(project.id)}`);
    } catch (nextError) {
      setError(nextError ?? messageError("projectCreateFailed"));
    } finally {
      setSubmitting(false);
    }
  }

  async function removeProject(project: ProjectRecord) {
    const confirmed = window.confirm(
      t("confirmDeleteProject", { name: project.name })
    );
    if (!confirmed) return;
    setDeletingProjectId(project.id);
    setProjectListError("");
    try {
      await deleteProject(project.id);
      await refreshProjects();
    } catch (nextError) {
      setProjectListError(nextError ?? messageError("projectDeleteFailed"));
    } finally {
      setDeletingProjectId(undefined);
    }
  }

  return (
    <main className="project-home">
      <header className="project-home-header">
        <div>
          <h1>SimpleRCP</h1>
          <span>{t("projects")}</span>
        </div>
        <div className="project-home-actions">
          <LanguageSwitcher />
          <button
            className="home-theme-toggle"
            type="button"
            onClick={() => setAgentSettingsOpen(true)}
            aria-label={t("openAgentSettings")}
            title={t("agentSettings")}
            data-testid="agent-settings-open"
          >
            <Bot size={17} />
          </button>
          <button
            className="home-theme-toggle"
            type="button"
            onClick={onToggleTheme}
            aria-label={themeLabel}
            title={themeLabel}
            data-testid="theme-toggle"
          >
            {theme === "dark" ? <Sun size={17} /> : <Moon size={17} />}
          </button>
        </div>
      </header>

      <section className="project-toolbar" aria-label={t("projectActions")}>
        <button type="button" onClick={() => selectAction("blank")} data-testid="new-project">
          <Plus size={16} /> {t("newProject")}
        </button>
        <button type="button" onClick={() => selectAction("directory")} data-testid="import-directory">
          <FolderInput size={16} /> {t("addDirectory")}
        </button>
        <button type="button" onClick={() => selectAction("zip")} data-testid="import-zip">
          <Archive size={16} /> {t("importZip")}
        </button>
      </section>

      {action ? (
        <form className="project-create-form" onSubmit={submit} data-testid="project-form">
          <div className="project-form-heading">
            <h2>{t(actionTitles[action])}</h2>
            <button
              type="button"
              className="icon-button"
              onClick={() => setAction(undefined)}
              aria-label={t("closeProjectForm")}
              title={t("close")}
            >
              <X size={16} />
            </button>
          </div>
          <label>
            <span>{t("projectName")}</span>
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
              <span>{t("serverPath")}</span>
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
              <span>{t("zipArchive")}</span>
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
              {t(submitting ? "working" : "create")}
            </button>
          </div>
          {error ? <p className="project-form-error">{errorText(t, error, t("projectCreateFailed"))}</p> : null}
        </form>
      ) : null}

      <section className="project-list-section">
        <div className="project-list-heading">
          <h2>{t("availableProjects")}</h2>
          <span>{projects.length}</span>
        </div>
        {projectListError ? (
          <p className="project-list-error">{errorText(t, projectListError, t("projectListLoadFailed"))}</p>
        ) : null}
        {loading ? <p className="project-list-empty">{t("loadingProjects")}</p> : null}
        {!loading && !projectListError && projects.length === 0 ? (
          <p className="project-list-empty">{t("noProjects")}</p>
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
                {formatDate(locale, project.lastOpenedAt)}
              </time>
              <div className="project-list-actions">
                <button
                  className="project-open"
                  type="button"
                  onClick={() => window.location.assign(`/projects/${encodeURIComponent(project.id)}`)}
                  data-testid={`open-project-${project.id}`}
                >
                  {t("open")}
                </button>
                {project.source !== "demo" ? (
                  <button
                    className="project-delete"
                    type="button"
                    onClick={() => void removeProject(project)}
                    disabled={Boolean(deletingProjectId)}
                    aria-label={t("deleteNamed", { name: project.name })}
                    title={t("deleteProject")}
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
      {agentSettingsOpen ? (
        <AgentSettingsDialog onClose={() => setAgentSettingsOpen(false)} />
      ) : null}
    </main>
  );
}
