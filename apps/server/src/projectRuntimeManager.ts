import { createProjectRuntime, type ProjectRuntime } from "./projectRuntime.js";
import type { ProjectRegistry } from "./projects.js";

export function createProjectRuntimeManager(registry: ProjectRegistry) {
  const runtimes = new Map<string, ProjectRuntime>();

  return {
    get(projectId: string) {
      const existing = runtimes.get(projectId);
      if (existing) return existing;
      const project = registry.getProject(projectId);
      if (!project) throw new Error("Project not found");
      const runtime = createProjectRuntime(project);
      runtimes.set(projectId, runtime);
      return runtime;
    },
    find(projectId: string) {
      return runtimes.get(projectId);
    },
    listActive() {
      return [...runtimes.values()];
    },
    async dispose() {
      await Promise.all([...runtimes.values()].map((runtime) => runtime.dispose()));
      runtimes.clear();
    }
  };
}

export type ProjectRuntimeManager = ReturnType<
  typeof createProjectRuntimeManager
>;
