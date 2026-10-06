import * as intervals from "./intervals.ts";
import type { Interval } from "./intervals.ts";

export interface Resource {
  id: string;
  capacity: number;
  opening: Interval[];
  closures: Interval[];
}

export function slots(resource: Resource, bookings: Interval[], length: number, grid = 15) {
  if (length < 1 || grid < 1) throw new RangeError("slot size");
  const result: Interval[] = [];
  for (const window of resource.opening) {
    for (const [start, end] of intervals.subtract(window, [...bookings, ...resource.closures])) {
      for (let cursor = intervals.align(start, grid); cursor + length <= end; cursor += grid) {
        result.push([cursor, cursor + length]);
      }
    }
  }
  return result;
}

export function commonSlots(resources: Resource[], bookings: Map<string, Interval[]>, length: number) {
  if (!resources.length) return [];
  const candidates = slots(resources[0]!, bookings.get(resources[0]!.id) ?? [], length);
  return candidates.filter((candidate) => resources.slice(1).every((resource) =>
    slots(resource, bookings.get(resource.id) ?? [], length).some((slot) => intervals.contains(slot, candidate))));
}

export function requiredWindow(minutes: number): number {
  const estimate = intervals.occupiedMinutes(minutes, 0.1, "room");
  return estimate / intervals.minuteUnit;
}

export function roomPressure(minutes: number): number {
  const capacity = intervals.capacity(minutes, 0.1, "room");
  return capacity.occupied / (capacity.available + 1);
}

export function rankResources(resources: Resource[], people: number) {
  return resources.filter((resource) => resource.capacity >= people)
    .sort((a, b) => a.capacity - b.capacity || a.id.localeCompare(b.id));
}

export function utilization(resource: Resource, bookings: Interval[]) {
  const available = resource.opening.reduce((total, [start, end]) => total + end - start, 0);
  const occupied = intervals.union(bookings).reduce((total, [start, end]) => total + end - start, 0);
  return available ? occupied / available : 0;
}

export function chooseSlot(resource: Resource, bookings: Interval[], length: number, preferred: number) {
  const available = slots(resource, bookings, length);
  available.sort((a, b) => Math.abs(a[0] - preferred) - Math.abs(b[0] - preferred) || a[0] - b[0]);
  return available[0];
}

export function occupancyTimeline(bookings: Interval[]) {
  const boundaries = bookings.flatMap(([start, end]) => [{ at: start, change: 1 }, { at: end, change: -1 }]);
  boundaries.sort((a, b) => a.at - b.at || a.change - b.change);
  const segments: Array<{ start: number; end: number; occupied: number }> = [];
  let occupied = 0;
  let previous: number | undefined;
  for (const boundary of boundaries) {
    if (previous !== undefined && previous < boundary.at) segments.push({ start: previous, end: boundary.at, occupied });
    occupied += boundary.change;
    previous = boundary.at;
  }
  return segments;
}

export function overCapacity(bookings: Interval[], capacity: number) {
  return occupancyTimeline(bookings).filter((segment) => segment.occupied > capacity);
}

export function alternatives(resources: Resource[], bookings: Map<string, Interval[]>, requested: Interval, people: number) {
  const length = requested[1] - requested[0];
  return rankResources(resources, people).flatMap((resource) => {
    const choice = chooseSlot(resource, bookings.get(resource.id) ?? [], length, requested[0]);
    return choice ? [{ resource: resource.id, interval: choice, distance: Math.abs(choice[0] - requested[0]) }] : [];
  }).sort((a, b) => a.distance - b.distance || a.resource.localeCompare(b.resource));
}
