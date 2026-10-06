export interface ScheduledTimer {
  at: number;
  order: number;
  callback: () => void;
  cancelled: boolean;
}

export class VirtualClock {
  private current = 0;
  private order = 0;
  private readonly timers = new Set<ScheduledTimer>();

  constructor(startAt = 0) {
    this.current = startAt;
  }

  now() {
    return this.current;
  }

  setTimeout(callback: () => void, delayMs: number) {
    const timer: ScheduledTimer = { at: this.current + Math.max(0, delayMs), order: this.order++, callback, cancelled: false };
    this.timers.add(timer);
    return timer;
  }

  clearTimeout(handle: unknown) {
    if (!handle || typeof handle !== "object") return;
    const timer = handle as ScheduledTimer;
    timer.cancelled = true;
    this.timers.delete(timer);
  }

  nextTimerAt() {
    return [...this.timers].filter((timer) => !timer.cancelled).sort((left, right) => left.at - right.at || left.order - right.order)[0]?.at;
  }

  advanceTo(at: number) {
    if (at < this.current) throw new Error("虚拟时钟不能向后移动");
    while (true) {
      const next = [...this.timers].filter((timer) => !timer.cancelled && timer.at <= at).sort((left, right) => left.at - right.at || left.order - right.order)[0];
      if (!next) break;
      this.timers.delete(next);
      this.current = next.at;
      if (!next.cancelled) next.callback();
    }
    this.current = at;
  }

  flush() {
    const last = [...this.timers].sort((left, right) => left.at - right.at || left.order - right.order).at(-1);
    if (last) this.advanceTo(last.at);
  }
}
