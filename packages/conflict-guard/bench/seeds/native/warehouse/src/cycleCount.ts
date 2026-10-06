import type { Inventory } from './lots.ts';
export interface Count {
  lot: string;
  expected: number;
  observed: number;
  verifiedBy: string[];
}
export function discrepancies(counts: Count[]) {
  return counts.filter((count) => count.expected !== count.observed).map((count) => ({ ...count, difference: count.observed - count.expected }));
}
export function applyCounts(inventory: Inventory, counts: Count[], requiredVerifiers = 2) {
  const next = new Map(inventory);
  for (const count of counts) {
    const lot = next.get(count.lot);
    if (!lot || count.expected !== lot.quantity) throw new Error('stale count');
    if (new Set(count.verifiedBy).size < requiredVerifiers) throw new Error('insufficient verification');
    if (count.observed < lot.reserved) throw new Error('count below reservation');
    next.set(lot.id, { ...lot, quantity: count.observed });
  }
  return next;
}
export function countPriority(inventory: Inventory, lastCount: ReadonlyMap<string, number>, now: number) {
  return [...inventory.values()].map((lot) => ({ id: lot.id, priority: (now - (lastCount.get(lot.id) ?? 0)) * Math.log2(lot.quantity + 2) }))
    .sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id));
}
export function accuracy(counts: Count[]) {
  if (!counts.length) return 1;
  const absolute = counts.reduce((sum, count) => sum + Math.abs(count.expected - count.observed), 0);
  const expected = counts.reduce((sum, count) => sum + count.expected, 0);
  return expected ? Math.max(0, 1 - absolute / expected) : absolute ? 0 : 1;
}
export function reconcileCounts(first: Count[], second: Count[]) {
  const byLot = new Map(second.map((count) => [count.lot, count]));
  return first.map((count) => {
    const other = byLot.get(count.lot);
    if (!other || count.observed !== other.observed) return { lot: count.lot, requiresRecount: true };
    return { ...count, verifiedBy: [...new Set([...count.verifiedBy, ...other.verifiedBy])], requiresRecount: false };
  });
}
