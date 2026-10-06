import type { Envelope } from './bus.ts';

export class EventStream {
  private events: Envelope[] = [];
  private positions = new Map<string, number>();
  private capacity: number;
  constructor(capacity = 1000) {
    this.capacity = capacity;
    if (capacity < 1) throw new RangeError('capacity');
  }
  append(event: Envelope) {
    if (this.events.length && event.sequence <= this.events.at(-1)!.sequence) throw new Error('sequence must increase');
    this.events.push({ ...event });
    if (this.events.length > this.capacity) this.events.shift();
  }
  read(subscriber: string, count: number) {
    const position = this.positions.get(subscriber) ?? 0;
    const earliest = this.events[0]?.sequence ?? position;
    if (position && position < earliest - 1) throw new Error('subscriber requires resynchronization');
    return this.events.filter((event) => event.sequence > position).slice(0, count);
  }
  commit(subscriber: string, sequence: number) {
    const previous = this.positions.get(subscriber) ?? 0;
    if (sequence < previous) throw new Error('position must increase');
    if (sequence > (this.events.at(-1)?.sequence ?? 0)) throw new Error('unknown sequence');
    this.positions.set(subscriber, sequence);
  }
  forget(subscriber: string) {
    this.positions.delete(subscriber);
  }
  lag(subscriber: string) {
    const last = this.events.at(-1)?.sequence ?? 0;
    return last - (this.positions.get(subscriber) ?? 0);
  }
  oldest() {
    return this.events[0]?.sequence;
  }
  filter(topic: string, after = 0) {
    return this.events.filter((event) => event.topic === topic && event.sequence > after);
  }
}
