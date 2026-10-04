export interface CaptureClock {
  now(): number;
  schedule(at: number, callback: () => void): number;
  cancel(id: number): void;
}

export class VirtualCaptureClock implements CaptureClock {
  private time: number;
  private sequence = 0;
  private readonly jobs = new Map<number, { at: number; callback: () => void }>();

  constructor(at = 0) { this.time = at; }
  now() { return this.time; }
  schedule(at: number, callback: () => void) {
    if (!Number.isFinite(at) || at < this.time) throw new Error("Capture timer precedes the clock");
    const id = ++this.sequence;
    this.jobs.set(id, { at, callback });
    return id;
  }
  cancel(id: number) { this.jobs.delete(id); }
  nextDeadline() { return Math.min(...[...this.jobs.values()].map(job => job.at)); }
  advanceTo(at: number) {
    if (!Number.isFinite(at) || at < this.time) throw new Error("Capture clock must advance monotonically");
    while (true) {
      const next = [...this.jobs.entries()].filter(([, job]) => job.at <= at).sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
      if (!next) break;
      this.jobs.delete(next[0]);
      this.time = next[1].at;
      next[1].callback();
    }
    this.time = at;
  }
  clear() { this.jobs.clear(); }
}
