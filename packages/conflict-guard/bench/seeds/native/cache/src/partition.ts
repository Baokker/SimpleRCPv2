import { WeightedCache } from './lru.ts';
export class PartitionedCache<V> {
  private groups = new Map<string, WeightedCache<string, V>>();
  private quota: number;
  private now: () => number;
  constructor(quota: number, now: () => number) {
    this.quota = quota;
    this.now = now;
  }
  private group(tenant: string) {
    if (!tenant) throw new Error('tenant required');
    let cache = this.groups.get(tenant);
    if (!cache) {
      cache = new WeightedCache<string, V>(this.quota, this.now);
      this.groups.set(tenant, cache);
    }
    return cache;
  }
  read(tenant: string, key: string) {
    return this.group(tenant).get(key);
  }
  write(tenant: string, key: string, value: V, bytes: number, ttl?: number) {
    return this.group(tenant).set(key, value, bytes, ttl);
  }
  removeTenant(tenant: string) {
    return this.groups.delete(tenant);
  }
  prune() {
    return [...this.groups.values()].reduce((count, group) => count + group.prune(), 0);
  }
  statistics() {
    return [...this.groups].map(([tenant, cache]) => ({ tenant, ...cache.statistics() }));
  }
  clearKey(key: string) {
    let removed = 0;
    for (const cache of this.groups.values()) if (cache.delete(key)) removed += 1;
    return removed;
  }
  verify() {
    for (const cache of this.groups.values()) cache.verify();
    return true;
  }
}
