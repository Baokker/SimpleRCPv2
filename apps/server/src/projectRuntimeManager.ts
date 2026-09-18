import { createProjectRuntime, type ProjectRuntime } from "./projectRuntime.js";
import type { ProjectRegistry } from "./projects.js";

export function createProjectRuntimeManager(registry: ProjectRegistry) {
  const runtimes = new Map<string, ProjectRuntime>();
  const projectDisposingListeners = new Set<(projectId: string) => void>();

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
    onProjectDisposing(listener: (projectId: string) => void) {
      projectDisposingListeners.add(listener);
      return () => projectDisposingListeners.delete(listener);
    },
    async disposeProject(projectId: string) {
      const runtime = runtimes.get(projectId);
      if (!runtime) return;
      for (const listener of projectDisposingListeners) listener(projectId);
      await runtime.dispose();
      runtimes.delete(projectId);
    },
    async dispose() {
      await Promise.all([...runtimes.values()].map((runtime) => runtime.dispose()));
      runtimes.clear();
      projectDisposingListeners.clear();
    }
  };
}

export type ProjectRuntimeManager = ReturnType<
  typeof createProjectRuntimeManager
>;
