import fs from "node:fs/promises";
import path from "node:path";
import type { ProjectRecord, ProjectSource } from "@simplercp/shared";
import { nanoid } from "nanoid";
import { extractZipArchive } from "./archiveImport.js";
import { readJsonFile, writeJsonFileAtomically } from "./jsonFile.js";
import { isIgnoredPath } from "./workspacePolicy.js";

export type { ProjectRecord, ProjectSource } from "@simplercp/shared";

interface RegistryFile {
  version: 1;
  projects: ProjectRecord[];
}

export async function createProjectRegistry({
  dataDir,
  workspacesDir,
  importRoots,
  demoProjectRoot
}: {
  dataDir: string;
  workspacesDir?: string;
  importRoots?: string[];
  demoProjectRoot: string;
}) {
  const projectsDir = path.join(dataDir, "projects");
  const workspacesRoot = workspacesDir ?? path.join(dataDir, "workspaces");
  const registryPath = path.join(dataDir, "registry.json");
  await fs.mkdir(projectsDir, { recursive: true, mode: 0o700 });
  await fs.mkdir(workspacesRoot, { recursive: true, mode: 0o700 });

  let registry = await loadRegistry(registryPath);
  registry = await migrateLegacyProjects(registry, { projectsDir, workspacesDir: workspacesRoot, dataDir, registryPath });
  if (!registry.projects.some((project) => project.id === "demo")) {
    const project = await createDemoProject({ projectsDir, workspacesDir: workspacesRoot, demoProjectRoot });
    registry = { ...registry, projects: [...registry.projects, project] };
    await saveRegistry(registryPath, registry);
  }

  return {
    listProjectsSync() {
      return [...registry.projects];
    },
    async listProjects() {
      const missingProjectIds = new Set<string>();
      let recreatedDemo: ProjectRecord | undefined;
      for (const project of registry.projects) {
        if (await pathExists(project.workspacePath)) continue;
        if (project.id === "demo") {
          recreatedDemo = await createDemoProject({ projectsDir, workspacesDir: workspacesRoot, demoProjectRoot });
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
      const workspacePath = path.join(workspacesRoot, id);
      await fs.mkdir(workspacePath, { recursive: true, mode: 0o700 });
      const timestamp = new Date().toISOString();
      const project: ProjectRecord = {
        id,
        name: normalizedName,
        source: "blank",
        workspacePath,
        metadataPath: projectDir,
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
      const realSource = await fs.realpath(sourcePath);
      if (importRoots) {
        const allowed = (await Promise.all(importRoots.map((root) => fs.realpath(root)))).some((root) => realSource === root || realSource.startsWith(`${root}${path.sep}`));
        if (!allowed) throw new Error("Directory import path is outside SIMPLERCP_IMPORT_ROOTS");
      }
      const sourceStat = await fs.stat(realSource);
      if (!sourceStat.isDirectory()) {
        throw new Error("Existing project path must be a directory");
      }

      const id = nanoid(12);
      const projectDir = path.join(projectsDir, id);
      const workspacePath = path.join(workspacesRoot, id);
      await fs.mkdir(projectDir, { recursive: true, mode: 0o700 });
      try {
        await fs.cp(realSource, workspacePath, {
          recursive: true,
          filter(candidatePath) {
            const relativePath = path.relative(realSource, candidatePath);
            return !relativePath || !isIgnoredPath(relativePath);
          }
        });
        const timestamp = new Date().toISOString();
        const project: ProjectRecord = {
          id,
          name: normalizedName,
          source: "directory",
          workspacePath,
          metadataPath: projectDir,
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
      const workspacePath = path.join(workspacesRoot, id);
      await fs.mkdir(projectDir, { recursive: true, mode: 0o700 });
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
          metadataPath: projectDir,
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
      await fs.rm(project.workspacePath, { recursive: true, force: true });
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
  const parsed = await readJsonFile<RegistryFile>(registryPath);
  if (parsed === undefined) return { version: 1, projects: [] };
  if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.projects)) {
    throw new Error("Invalid project registry");
  }
  return parsed;
}

async function createDemoProject({
  projectsDir,
  workspacesDir,
  demoProjectRoot
}: {
  projectsDir: string;
  workspacesDir: string;
  demoProjectRoot: string;
}): Promise<ProjectRecord> {
  const projectDir = path.join(projectsDir, "demo");
  const workspacePath = path.join(workspacesDir, "demo");
  if (!(await pathExists(workspacePath))) {
    await fs.mkdir(projectDir, { recursive: true, mode: 0o700 });
    await fs.cp(demoProjectRoot, workspacePath, { recursive: true });
  }
  const timestamp = new Date().toISOString();
  const project: ProjectRecord = {
    id: "demo",
    name: "Demo",
    source: "demo",
    workspacePath,
    metadataPath: projectDir,
    createdAt: timestamp,
    lastOpenedAt: timestamp
  };
  await writeProjectMetadata(projectDir, project);
  return project;
}

async function migrateLegacyProjects(registry: RegistryFile, options: { projectsDir: string; workspacesDir: string; dataDir: string; registryPath: string }) {
  const markerDir = path.join(options.dataDir, "instance");
  await fs.mkdir(markerDir, { recursive: true, mode: 0o700 });
  const migrated: ProjectRecord[] = [];
  const completed: string[] = [];
  for (const project of registry.projects) {
    if (project.metadataPath) {
      if (await pathExists(path.join(markerDir, `migration-${project.id}.started`)) && await pathExists(project.workspacePath)) completed.push(project.id);
      migrated.push(project);
      continue;
    }
    const metadataPath = project.metadataPath ?? path.dirname(project.workspacePath);
    const legacyWorkspace = path.join(metadataPath, "workspace");
    const nextWorkspace = path.join(options.workspacesDir, project.id);
    const copiedMarker = path.join(markerDir, `migration-${project.id}.copied.json`);
    await fs.writeFile(path.join(markerDir, `migration-${project.id}.started`), new Date().toISOString());
    const sourceExists = await pathExists(legacyWorkspace);
    const destinationExists = await pathExists(nextWorkspace);
    if (sourceExists && destinationExists) {
      const copied = await readJsonFile<{ source: string; destination: string }>(copiedMarker);
      if (copied?.source !== legacyWorkspace || copied.destination !== nextWorkspace) throw new Error("Migration destination already exists");
      await fs.rm(legacyWorkspace, { recursive: true });
    } else if (sourceExists) {
      try {
        await fs.rename(legacyWorkspace, nextWorkspace);
      } catch (error) {
        if (!(error instanceof Error && "code" in error && error.code === "EXDEV")) throw error;
        const stagingPath = `${nextWorkspace}.migration`;
        await fs.rm(stagingPath, { recursive: true, force: true });
        await fs.cp(legacyWorkspace, stagingPath, { recursive: true, preserveTimestamps: true });
        await writeJsonFileAtomically(copiedMarker, { source: legacyWorkspace, destination: nextWorkspace });
        await fs.rename(stagingPath, nextWorkspace);
        await fs.rm(legacyWorkspace, { recursive: true });
      }
    }
    const updated = { ...project, metadataPath, workspacePath: nextWorkspace };
    await writeProjectMetadata(metadataPath, updated);
    migrated.push(updated);
    completed.push(project.id);
  }
  const next = { ...registry, projects: migrated };
  if (JSON.stringify(next) !== JSON.stringify(registry)) await saveRegistry(options.registryPath, next);
  for (const projectId of completed) {
    await fs.writeFile(path.join(markerDir, `migration-${projectId}.complete`), new Date().toISOString());
  }
  return next;
}

export function getProjectMetadataPath(project: ProjectRecord) {
  if (!project.metadataPath) throw new Error("Project metadata path is required");
  return project.metadataPath;
}

async function writeProjectMetadata(
  projectDir: string,
  project: ProjectRecord
) {
  await writeJsonFileAtomically(path.join(projectDir, "project.json"), project);
}

async function saveRegistry(registryPath: string, registry: RegistryFile) {
  await writeJsonFileAtomically(registryPath, registry);
}

function validateProjectName(name: string, projects: ProjectRecord[]) {
  const normalized = name.trim();
  if (!normalized) throw new Error("Project name is required");
  if (normalized.length > 100) {
    throw new Error("Project name must be at most 100 characters");
  }
  if (
    projects.some(
      (project) => project.name.toLowerCase() === normalized.toLowerCase()
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
