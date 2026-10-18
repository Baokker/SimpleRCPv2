export interface AgentSchedulerQueue {
  runIds: string[];
  processing: boolean;
  completion?: Promise<void>;
  activeRunIds: Set<string>;
  activeSessionIds: Set<string>;
  runningPromises: Set<Promise<void>>;
  workspacePreparing: boolean;
  workspacePreparationRunId?: string;
  rescanRequested: boolean;
  closing: boolean;
}

export interface RunnableAgentRun {
  runId: string;
  sessionId: string;
  requiresWorkspacePreparation: boolean;
}

export function getCompletedOverlapGroup(runId: string, overlaps: Map<string, Set<string>>, activeRunIds: Set<string>) {
  const connectedRunIds = new Set([runId]);
  for (const connectedRunId of connectedRunIds) {
    for (const otherRunId of overlaps.get(connectedRunId) ?? []) connectedRunIds.add(otherRunId);
  }
  return [...connectedRunIds].some((id) => activeRunIds.has(id)) ? [] : [...connectedRunIds];
}

interface AgentSchedulerOptions {
  maxConcurrentRuns: number;
  isClosing(): boolean;
  getQueue(projectId: string): AgentSchedulerQueue;
  findRunnableRun(projectId: string, queue: AgentSchedulerQueue): Promise<RunnableAgentRun | undefined>;
  onRunStart(context: {
    projectId: string;
    runId: string;
    sessionId: string;
    overlappingRunIds: Set<string>;
    requiresWorkspacePreparation: boolean;
  }): () => void;
  executeRun(projectId: string, runId: string): Promise<void>;
  onSchedulerError?(projectId: string, error: unknown, runId?: string): Promise<void> | void;
}

export function createAgentScheduler(options: AgentSchedulerOptions) {
  async function reportSchedulerError(projectId: string, error: unknown, runId?: string) {
    try {
      await options.onSchedulerError?.(projectId, error, runId);
    } catch (reportError) {
      console.error("Agent scheduler error reporting failed", reportError);
    }
  }
  async function processQueue(projectId: string): Promise<void> {
    const queue = options.getQueue(projectId);
    if (queue.processing) {
      queue.rescanRequested = true;
      return queue.completion;
    }
    queue.processing = true;
    queue.completion = (async () => {
      while (!options.isClosing() && !queue.closing && queue.activeRunIds.size < options.maxConcurrentRuns) {
        let candidate: RunnableAgentRun | undefined;
        try {
          candidate = await options.findRunnableRun(projectId, queue);
        } catch (error) {
          const runId = queue.runIds[0];
          if (runId) queue.runIds = queue.runIds.filter((queuedRunId) => queuedRunId !== runId);
          await reportSchedulerError(projectId, error, runId);
          continue;
        }
        if (!candidate) break;
        const { runId, sessionId, requiresWorkspacePreparation } = candidate;
        queue.runIds = queue.runIds.filter((queuedRunId) => queuedRunId !== runId);
        const overlappingRunIds = new Set(queue.activeRunIds);
        queue.activeRunIds.add(runId);
        queue.activeSessionIds.add(sessionId);
        if (requiresWorkspacePreparation) {
          queue.workspacePreparing = true;
          queue.workspacePreparationRunId = runId;
        }
        let finishRun: () => void;
        try {
          finishRun = options.onRunStart({
            projectId,
            runId,
            sessionId,
            overlappingRunIds,
            requiresWorkspacePreparation
          });
        } catch (error) {
          queue.activeRunIds.delete(runId);
          queue.activeSessionIds.delete(sessionId);
          if (queue.workspacePreparationRunId === runId) {
            queue.workspacePreparing = false;
            queue.workspacePreparationRunId = undefined;
          }
          await reportSchedulerError(projectId, error, runId);
          continue;
        }
        let runningPromise: Promise<void>;
        runningPromise = Promise.resolve().then(() => options.executeRun(projectId, runId)).catch(async (error) => {
          await reportSchedulerError(projectId, error, runId);
        }).finally(() => {
          queue.activeRunIds.delete(runId);
          queue.activeSessionIds.delete(sessionId);
          if (queue.workspacePreparationRunId === runId) {
            queue.workspacePreparing = false;
            queue.workspacePreparationRunId = undefined;
          }
          try {
            finishRun();
          } catch (error) {
            void reportSchedulerError(projectId, error, runId);
          }
          queue.runningPromises.delete(runningPromise);
          if (!queue.closing && !options.isClosing()) void processQueue(projectId);
        });
        queue.runningPromises.add(runningPromise);
      }
    })().finally(() => {
      queue.processing = false;
      if (queue.rescanRequested && !queue.closing && !options.isClosing()) {
        queue.rescanRequested = false;
        void processQueue(projectId);
      }
    });
    return queue.completion;
  }

  return {
    processQueue,
    workspacePrepared(projectId: string, runId: string) {
      const queue = options.getQueue(projectId);
      if (queue.workspacePreparationRunId !== runId) return;
      queue.workspacePreparing = false;
      queue.workspacePreparationRunId = undefined;
      void processQueue(projectId);
    }
  };
}
