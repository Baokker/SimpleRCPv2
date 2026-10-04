export interface AgentSchedulerQueue {
  runIds: string[];
  processing: boolean;
  completion?: Promise<void>;
  activeRunIds: Set<string>;
  activeSessionIds: Set<string>;
  runningPromises: Set<Promise<void>>;
  workspacePreparing: boolean;
  rescanRequested: boolean;
  closing: boolean;
}

export interface RunnableAgentRun {
  runId: string;
  sessionId: string;
  requiresWorkspacePreparation: boolean;
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
}

export function createAgentScheduler(options: AgentSchedulerOptions) {
  async function processQueue(projectId: string): Promise<void> {
    const queue = options.getQueue(projectId);
    if (queue.processing) {
      queue.rescanRequested = true;
      return queue.completion;
    }
    queue.processing = true;
    queue.completion = (async () => {
      while (!options.isClosing() && !queue.closing && queue.activeRunIds.size < options.maxConcurrentRuns) {
        const candidate = await options.findRunnableRun(projectId, queue);
        if (!candidate) break;
        const { runId, sessionId, requiresWorkspacePreparation } = candidate;
        queue.runIds = queue.runIds.filter((queuedRunId) => queuedRunId !== runId);
        const overlappingRunIds = new Set(queue.activeRunIds);
        queue.activeRunIds.add(runId);
        queue.activeSessionIds.add(sessionId);
        if (requiresWorkspacePreparation) queue.workspacePreparing = true;
        const finishRun = options.onRunStart({
          projectId,
          runId,
          sessionId,
          overlappingRunIds,
          requiresWorkspacePreparation
        });
        let runningPromise: Promise<void>;
        runningPromise = options.executeRun(projectId, runId).finally(() => {
          queue.activeRunIds.delete(runId);
          queue.activeSessionIds.delete(sessionId);
          if (requiresWorkspacePreparation) queue.workspacePreparing = false;
          finishRun();
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

  return { processQueue };
}
