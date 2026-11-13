interface OpenCodeProcess {
  start(): Promise<{ url: string; version: string }>;
  dispose(): Promise<void>;
}

export interface OpenCodeClock {
  now(): number;
  setTimeout(callback: () => void, delay: number): ReturnType<typeof setTimeout>;
  clearTimeout(timer: ReturnType<typeof setTimeout>): void;
}

export function createOpenCodeLifecycle(options: {
  createProcess(): OpenCodeProcess;
  isIdle(): boolean;
  hasSubscriptions(): boolean;
  clearSubscriptions(): Promise<void>;
  idleMs?: number;
  clock?: OpenCodeClock;
}) {
  const clock = options.clock ?? { now: Date.now, setTimeout, clearTimeout };
  let process = options.createProcess();
  let started = false;
  let processDisposed = false;
  let disposed = false;
  let requestCount = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let changePromise: Promise<void> | undefined;
  let disposal: Promise<void> | undefined;
  let startup: ReturnType<OpenCodeProcess["start"]> | undefined;
  let restartIdleMs: number | undefined;

  function assertAvailable() {
    if (disposed) throw new Error("Agent 服务已经关闭");
  }

  function cancelIdle() {
    if (timer !== undefined) clock.clearTimeout(timer);
    timer = undefined;
  }

  function scheduleIdle() {
    if (options.idleMs === undefined || timer !== undefined || !started || disposed || changePromise || requestCount > 0 || !options.isIdle()) return;
    const idleSince = clock.now();
    const checkIdle = () => {
      timer = undefined;
      if (disposed || changePromise || requestCount > 0 || !options.isIdle()) return;
      const idleForMs = clock.now() - idleSince;
      if (idleForMs < options.idleMs!) {
        timer = clock.setTimeout(checkIdle, Math.min(options.idleMs! - idleForMs, 2_147_483_647));
        timer.unref?.();
        return;
      }
      void replace(options.createProcess, idleForMs).catch((error) => console.error("OpenCode 空闲退出失败", error));
    };
    timer = clock.setTimeout(checkIdle, Math.min(options.idleMs, 2_147_483_647));
    timer.unref?.();
  }

  function replace(createProcess: () => OpenCodeProcess, idleForMs?: number) {
    cancelIdle();
    const previous = changePromise;
    const replaceProcess = async () => {
      if (disposed) return;
      if (options.hasSubscriptions()) await options.clearSubscriptions();
      if (startup) await startup;
      await process.dispose();
      processDisposed = true;
      started = false;
      if (disposed) return;
      process = createProcess();
      processDisposed = false;
      if (idleForMs !== undefined) {
        restartIdleMs = idleForMs;
        console.info(`OpenCode 空闲退出 idleMs=${idleForMs}`);
      }
    };
    const replacement = previous ? previous.then(replaceProcess) : replaceProcess();
    const finished = replacement.finally(() => {
      if (changePromise === finished) changePromise = undefined;
      scheduleIdle();
    });
    changePromise = finished;
    return finished;
  }

  async function start() {
    while (changePromise) await changePromise;
    assertAvailable();
    if (!startup) {
      const startedAt = clock.now();
      startup = process.start().then((running) => {
        started = true;
        if (restartIdleMs !== undefined) {
          console.info(`OpenCode 空闲后启动 idleMs=${restartIdleMs} startupMs=${clock.now() - startedAt}`);
          restartIdleMs = undefined;
        }
        return running;
      }).finally(() => { startup = undefined; });
    }
    const running = await startup;
    assertAvailable();
    return running;
  }

  function trackRequest<Args extends unknown[], Result>(operation: (...args: Args) => Promise<Result>) {
    return async (...args: Args): Promise<Result> => {
      assertAvailable();
      cancelIdle();
      requestCount += 1;
      try {
        return await operation(...args);
      } finally {
        requestCount -= 1;
        scheduleIdle();
      }
    };
  }

  function dispose() {
    if (disposal) return disposal;
    disposed = true;
    cancelIdle();
    disposal = (async () => {
      try {
        if (changePromise) await changePromise;
        await options.clearSubscriptions();
        if (startup) await startup;
      } finally {
        if (!processDisposed) {
          await process.dispose();
          processDisposed = true;
        }
      }
    })();
    return disposal;
  }

  return { start, replace, trackRequest, cancelIdle, scheduleIdle, assertAvailable, dispose };
}
