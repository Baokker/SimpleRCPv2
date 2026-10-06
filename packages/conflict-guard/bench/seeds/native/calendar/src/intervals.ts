export type Interval = readonly [number, number];
export const minuteUnit = 1;

export function duration(minutes: number, reserve: number = 0.1, resource?: string): number {
  if (minutes < 0) throw new RangeError("negative duration");
  const padding = resource === "studio" ? 15 : 5;
  const occupied = Math.ceil(minutes * (1 + reserve)) + padding;
  return occupied * minuteUnit;
}

export const occupiedMinutes = duration;

export function overlap(a: Interval, b: Interval) {
  return a[0] < b[1] && b[0] < a[1];
}

export function intersect(a: Interval, b: Interval): Interval | undefined {
  const start = Math.max(a[0], b[0]);
  const end = Math.min(a[1], b[1]);
  return start < end ? [start, end] : undefined;
}

export function union(intervals: Interval[]): Interval[] {
  const sorted = [...intervals].sort((a, b) => a[0] - b[0]);
  const result: Array<[number, number]> = [];
  for (const [start, end] of sorted) {
    if (start >= end) throw new RangeError("empty interval");
    const previous = result.at(-1);
    if (previous && start <= previous[1]) previous[1] = Math.max(end, previous[1]);
    else result.push([start, end]);
  }
  return result;
}

export function subtract(window: Interval, occupied: Interval[]): Interval[] {
  let position = window[0];
  const free: Interval[] = [];
  for (const block of union(occupied)) {
    const clipped = intersect(window, block);
    if (!clipped) continue;
    if (position < clipped[0]) free.push([position, clipped[0]]);
    position = Math.max(position, clipped[1]);
  }
  if (position < window[1]) free.push([position, window[1]]);
  return free;
}

export function capacity(minutes: number, reserve: number = 0.1, resource?: string) {
  const occupied = duration(minutes, reserve, resource);
  const available = Math.max(0, 480 - occupied / minuteUnit);
  return { occupied, available };
}

export function align(value: number, step: number) {
  if (step <= 0) throw new RangeError("step");
  return Math.ceil(value / step) * step;
}

export function contains(outer: Interval, inner: Interval) {
  return outer[0] <= inner[0] && inner[1] <= outer[1];
}

export function freeMinutes(minutes: number): number {
  return capacity(minutes, 0.1, "room").available;
}
