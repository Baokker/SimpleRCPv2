import fs from "node:fs/promises";
import path from "node:path";
import { nanoid } from "nanoid";
import { extractZipArchive } from "./archiveImport.js";
import { isIgnoredPath } from "./workspacePolicy.js";

export type ProjectSource = "demo" | "blank" | "directory" | "zip";

export interface ProjectRecord {
  id: string;
  name: string;
  source: ProjectSource;
  workspacePath: string;
  createdAt: string;
  lastOpenedAt: string;
}

interface RegistryFile {
  version: 1;
  projects: ProjectRecord[];
}

export async function createProjectRegistry({
  dataDir,
  demoProjectRoot
}: {
  dataDir: string;
  demoProjectRoot: string;
}) {
  const projectsDir = path.join(dataDir, "projects");
  const registryPath = path.join(dataDir, "registry.json");
  await fs.mkdir(projectsDir, { recursive: true });

  let registry = await loadRegistry(registryPath);
  if (!registry.projects.some((project) => project.id === "demo")) {
    const project = await createDemoProject({ projectsDir, demoProjectRoot });
    registry = { ...registry, projects: [...registry.projects, project] };
    await saveRegistry(registryPath, registry);
  }

  return {
    async listProjects() {
      const missingProjectIds = new Set<string>();
      let recreatedDemo: ProjectRecord | undefined;
      for (const project of registry.projects) {
        if (await pathExists(project.workspacePath)) continue;
        if (project.id === "demo") {
          recreatedDemo = await createDemoProject({
            projectsDir,
            demoProjectRoot
          });
        } else {
          missingProjectIds.add(project.id);
        }
      }
      if (missingProjectIds.size > 0 || recreatedDemo) {
        registry = {
          ...registry,
          projects: registry.projects.flatMap((project) => {
            if (missingProjectIds.has(project.id)) return [];
            if (project.id === "demo" && recreatedDemo) return [recreatedDemo];
            return [project];
          })
        };
        await saveRegistry(registryPath, registry);
      }
      return [...registry.projects].sort((left, right) =>
        right.lastOpenedAt.localeCompare(left.lastOpenedAt)
      );
    },
    getProject(projectId: string) {
      return registry.projects.find((project) => project.id === projectId);
    },
    async createBlankProject(name: string) {
      const normalizedName = validateProjectName(name, registry.projects);
      const id = nanoid(12);
      const projectDir = path.join(projectsDir, id);
      const workspacePath = path.join(projectDir, "workspace");
      await fs.mkdir(workspacePath, { recursive: true });
      const timestamp = new Date().toISOString();
      const project: ProjectRecord = {
        id,
        name: normalizedName,
        source: "blank",
        workspacePath,
        createdAt: timestamp,
        lastOpenedAt: timestamp
      };
      await writeProjectMetadata(projectDir, project);
      registry = { ...registry, projects: [...registry.projects, project] };
      await saveRegistry(registryPath, registry);
      return project;
    },
    async importDirectory(name: string, sourcePath: string) {
      const normalizedName = validateProjectName(name, registry.projects);
      if (!path.isAbsolute(sourcePath)) {
        throw new Error("Existing project path must be absolute");
      }
      const sourceStat = await fs.stat(sourcePath);
      if (!sourceStat.isDirectory()) {
        throw new Error("Existing project path must be a directory");
      }

      const id = nanoid(12);
      const projectDir = path.join(projectsDir, id);
      const workspacePath = path.join(projectDir, "workspace");
      await fs.mkdir(projectDir, { recursive: true });
      try {
        await fs.cp(sourcePath, workspacePath, {
          recursive: true,
          filter(candidatePath) {
            const relativePath = path.relative(sourcePath, candidatePath);
            return !relativePath || !isIgnoredPath(relativePath);
          }
        });
        const timestamp = new Date().toISOString();
        const project: ProjectRecord = {
          id,
          name: normalizedName,
          source: "directory",
          workspacePath,
          createdAt: timestamp,
          lastOpenedAt: timestamp
        };
        await writeProjectMetadata(projectDir, project);
        registry = { ...registry, projects: [...registry.projects, project] };
        await saveRegistry(registryPath, registry);
        return project;
      } catch (error) {
        await fs.rm(projectDir, { recursive: true, force: true });
        throw error;
      }
    },
    async importZip(name: string, archive: Buffer) {
      const normalizedName = validateProjectName(name, registry.projects);
      const id = nanoid(12);
      const projectDir = path.join(projectsDir, id);
      const workspacePath = path.join(projectDir, "workspace");
      await fs.mkdir(projectDir, { recursive: true });
      try {
        const { filteredEntries } = await extractZipArchive({
          archive,
          destination: workspacePath
        });
        const timestamp = new Date().toISOString();
        const project: ProjectRecord = {
          id,
          name: normalizedName,
          source: "zip",
          workspacePath,
          createdAt: timestamp,
          lastOpenedAt: timestamp
        };
        await writeProjectMetadata(projectDir, project);
        registry = { ...registry, projects: [...registry.projects, project] };
        await saveRegistry(registryPath, registry);
        return { project, filteredEntries };
      } catch (error) {
        await fs.rm(projectDir, { recursive: true, force: true });
        throw error;
      }
    },
    async markOpened(projectId: string) {
      const project = registry.projects.find(
        (candidate) => candidate.id === projectId
      );
      if (!project) throw new Error("Project not found");
      if (!(await pathExists(project.workspacePath))) {
        registry = {
          ...registry,
          projects: registry.projects.filter(
            (candidate) => candidate.id !== projectId
          )
        };
        await saveRegistry(registryPath, registry);
        throw new Error("Project not found");
      }
      project.lastOpenedAt = new Date().toISOString();
      await saveRegistry(registryPath, registry);
      return project;
    },
    async deleteProject(projectId: string) {
      if (projectId === "demo") {
        throw new Error("Demo project cannot be deleted");
      }
      const project = registry.projects.find(
        (candidate) => candidate.id === projectId
      );
      if (!project) throw new Error("Project not found");
      const projectDir = resolveProjectDir(projectsDir, project.id);
      await fs.rm(projectDir, { recursive: true, force: true });
      registry = {
        ...registry,
        projects: registry.projects.filter(
          (candidate) => candidate.id !== projectId
        )
      };
      await saveRegistry(registryPath, registry);
      return project;
    }
  };
}

export type ProjectRegistry = Awaited<ReturnType<typeof createProjectRegistry>>;

async function loadRegistry(registryPath: string): Promise<RegistryFile> {
  if (!(await pathExists(registryPath))) {
    return { version: 1, projects: [] };
  }
  const parsed = JSON.parse(await fs.readFile(registryPath, "utf8")) as RegistryFile;
  if (parsed.version !== 1 || !Array.isArray(parsed.projects)) {
    throw new Error("Invalid project registry");
  }
  return parsed;
}

async function createDemoProject({
  projectsDir,
  demoProjectRoot
}: {
  projectsDir: string;
  demoProjectRoot: string;
}): Promise<ProjectRecord> {
  const projectDir = path.join(projectsDir, "demo");
  const workspacePath = path.join(projectDir, "workspace");
  if (!(await pathExists(workspacePath))) {
    await fs.mkdir(projectDir, { recursive: true });
    await fs.cp(demoProjectRoot, workspacePath, { recursive: true });
  }
  const timestamp = new Date().toISOString();
  const project: ProjectRecord = {
    id: "demo",
    name: "Demo",
    source: "demo",
    workspacePath,
    createdAt: timestamp,
    lastOpenedAt: timestamp
  };
  await writeProjectMetadata(projectDir, project);
  return project;
}

async function writeProjectMetadata(
  projectDir: string,
  project: ProjectRecord
) {
  await fs.writeFile(
    path.join(projectDir, "project.json"),
    `${JSON.stringify(project, null, 2)}\n`,
    "utf8"
  );
}

async function saveRegistry(registryPath: string, registry: RegistryFile) {
  const nextPath = `${registryPath}.${nanoid(8)}.next`;
  await fs.writeFile(nextPath, `${JSON.stringify(registry, null, 2)}\n`, "utf8");
  await fs.rename(nextPath, registryPath);
}

function validateProjectName(name: string, projects: ProjectRecord[]) {
  const normalized = name.trim();
  if (!normalized) throw new Error("Project name is required");
  if (normalized.length > 100) {
    throw new Error("Project name must be at most 100 characters");
  }
  if (
    projects.some(
      (project) => project.name.toLocaleLowerCase() === normalized.toLocaleLowerCase()
    )
  ) {
    throw new Error("A project with this name already exists");
  }
  return normalized;
}

function resolveProjectDir(projectsDir: string, projectId: string) {
  const root = path.resolve(projectsDir);
  const projectDir = path.resolve(root, projectId);
  if (path.dirname(projectDir) !== root) {
    throw new Error("Invalid project id");
  }
  return projectDir;
}

async function pathExists(targetPath: string) {
  try {
    await fs.access(targetPath);
    return true;
  } catch (error) {
    if (isMissingPath(error)) return false;
    throw error;
  }
}

function isMissingPath(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
