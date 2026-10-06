import { overlap, contains } from "./intervals.ts";
import type { Interval } from "./intervals.ts";
import type { Resource } from "./availability.ts";

export interface Booking {
  id: string;
  resource: string;
  owner: string;
  interval: Interval;
  attendees: string[];
  version: number;
}

export class Calendar {
  private entries = new Map<string, Booking>();
  private serial = 0;
  private revision = 0;
  private resources: ReadonlyMap<string, Resource>;
  constructor(resources: ReadonlyMap<string, Resource>) {
    this.resources = resources;
  }

  reserve(resourceId: string, owner: string, interval: Interval, attendees: string[] = []) {
    const resource = this.resources.get(resourceId);
    if (!resource) throw new Error("unknown resource");
    if (attendees.length > resource.capacity) throw new Error("capacity exceeded");
    if (!resource.opening.some((opening) => contains(opening, interval))) throw new Error("outside opening");
    if (resource.closures.some((closure) => overlap(closure, interval))) throw new Error("resource closed");
    if (this.forResource(resourceId).some((entry) => overlap(entry.interval, interval))) throw new Error("resource busy");
    const booking: Booking = { id: `booking-${++this.serial}`, resource: resourceId, owner, interval, attendees: [...new Set(attendees)], version: ++this.revision };
    this.entries.set(booking.id, booking);
    return { ...booking };
  }

  cancel(id: string, owner: string) {
    const entry = this.entries.get(id);
    if (!entry) return false;
    if (entry.owner !== owner) throw new Error("owner required");
    this.entries.delete(id);
    this.revision += 1;
    return true;
  }

  move(id: string, interval: Interval, version: number) {
    const entry = this.entries.get(id);
    if (!entry) throw new Error("missing booking");
    if (entry.version !== version) throw new Error("stale booking");
    this.entries.delete(id);
    try {
      const next = this.reserve(entry.resource, entry.owner, interval, entry.attendees);
      this.entries.delete(next.id);
      const moved = { ...next, id };
      this.entries.set(id, moved);
      return moved;
    } catch (error) {
      this.entries.set(id, entry);
      throw error;
    }
  }

  forResource(id: string) {
    return [...this.entries.values()].filter((entry) => entry.resource === id).sort((a, b) => a.interval[0] - b.interval[0]);
  }

  forPerson(person: string) {
    return [...this.entries.values()].filter((entry) => entry.owner === person || entry.attendees.includes(person));
  }

  snapshot() {
    return { revision: this.revision, bookings: [...this.entries.values()].map((entry) => ({ ...entry, attendees: [...entry.attendees], interval: [...entry.interval] })) };
  }
}
