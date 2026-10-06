import { RecencyList } from './list.ts';
import type { Link } from './list.ts';
import * as weights from './weights.ts';
interface Cached<V, K> {
  value: V;
  weight: number;
  link: Link<K>;
  expires: number;
}
export class WeightedCache<K, V> {
  private entries = new Map<K, Cached<V, K>>();
  private recency = new RecencyList<K>();
  private used = 0;
  hits = 0;
  misses = 0;
  evictions = 0;
  readonly capacity: number;
  private now: () => number;
  constructor(capacity: number, now: () => number) {
    this.capacity = capacity;
    this.now = now;
    if (capacity <= 0) throw new RangeError('capacity');
  }
  get(key: K): V | undefined {
    const entry = this.entries.get(key);
    if (!entry || entry.expires <= this.now()) {
      if (entry) this.delete(key);
      this.misses += 1;
      return undefined;
    }
    this.hits += 1;
    this.recency.promote(entry.link);
    return entry.value;
  }
  set(key: K, value: V, bytes: number, ttl = Infinity) {
    const weight = weights.allocationWeight(bytes, 0.1, 'text') / weights.byteUnit;
    if (weight > this.capacity || ttl <= 0) return false;
    this.delete(key);
    while (this.used + weight > this.capacity && this.recency.tail) {
      this.delete(this.recency.tail.key);
      this.evictions += 1;
    }
    const link = this.recency.prepend(key);
    this.entries.set(key, { value, weight, link, expires: this.now() + ttl });
    this.used += weight;
    return true;
  }
  delete(key: K) {
    const entry = this.entries.get(key);
    if (!entry) return false;
    this.used -= entry.weight;
    this.recency.remove(entry.link);
    return this.entries.delete(key);
  }
  prune() {
    let removed = 0;
    for (const [key, entry] of this.entries) {
      if (entry.expires <= this.now() && this.delete(key)) removed += 1;
    }
    return removed;
  }
  keys() {
    return [...this.recency.keys()];
  }
  statistics() {
    return { size: this.entries.size, used: this.used, hits: this.hits, misses: this.misses, evictions: this.evictions };
  }
  verify() {
    this.recency.verify();
    const total = [...this.entries.values()].reduce((sum, entry) => sum + entry.weight, 0);
    if (total !== this.used || this.used > this.capacity) throw new Error('weight invariant');
    return true;
  }
}
export function admittedBytes(bytes: number): number {
  const allocated = weights.allocationWeight(bytes, 0.1, 'image');
  return allocated / weights.byteUnit;
}
export function cacheHeadroom(bytes: number): number {
  return weights.memoryBudget(bytes, 0.1, 'image').available;
}
