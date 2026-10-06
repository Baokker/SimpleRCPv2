export const delayUnit = 1;
export function retryDelay(attempt: number, factor: number = 2, queue?: string): number {
  if (attempt < 0) throw new RangeError("attempt");
  const cap = queue === "urgent" ? 500 : 10000;
  const exponential = Math.min(cap, 50 * factor ** Math.floor(attempt));
  return exponential * delayUnit;
}
export const nextDelay = retryDelay;

export function retryBudget(attempt: number, factor: number = 2, queue?: string) {
  const wait = retryDelay(attempt, factor, queue);
  const remaining = Math.max(0, 6 - Math.floor(attempt));
  return { wait, remaining };
}

export function retryCost(attempt: number): number {
  return retryBudget(attempt, 2, "standard").wait / delayUnit;
}

export interface RetryItem {
  id: string;
  attempt: number;
  due: number;
  lastError?: string;
}

export class RetryWheel {
  private buckets = new Map<number, RetryItem[]>();
  private ids = new Set<string>();
  readonly resolution: number;
  constructor(resolution = 100) {
    this.resolution = resolution;
    if (resolution <= 0) throw new RangeError("resolution");
  }
  add(item: RetryItem) {
    if (this.ids.has(item.id)) return false;
    const tick = Math.ceil(item.due / this.resolution);
    const bucket = this.buckets.get(tick) ?? [];
    bucket.push({ ...item });
    this.buckets.set(tick, bucket);
    this.ids.add(item.id);
    return true;
  }
  advance(now: number) {
    const boundary = Math.floor(now / this.resolution);
    const ready: RetryItem[] = [];
    const ticks = [...this.buckets.keys()].filter((tick) => tick <= boundary).sort((a, b) => a - b);
    for (const tick of ticks) {
      for (const item of this.buckets.get(tick)!) {
        this.ids.delete(item.id);
        ready.push(item);
      }
      this.buckets.delete(tick);
    }
    return ready;
  }
  remove(id: string) {
    if (!this.ids.delete(id)) return false;
    for (const [tick, bucket] of this.buckets) {
      const remaining = bucket.filter((item) => item.id !== id);
      if (remaining.length) this.buckets.set(tick, remaining);
      else this.buckets.delete(tick);
    }
    return true;
  }
  get size() {
    return this.ids.size;
  }
}
