import * as forecast from './forecast.ts';
import { reserve, consume, release } from './lots.ts';
import type { Inventory } from './lots.ts';
export interface PickRequest {
  id: string;
  items: Array<{ sku: string; quantity: number }>;
}
export function planPick(inventory: Inventory, request: PickRequest, now: number) {
  let next = inventory;
  const allocations: Array<{ sku: string; lot: string; quantity: number }> = [];
  for (const item of request.items) {
    const result = reserve(next, item.sku, item.quantity, now);
    next = result.inventory;
    allocations.push(...result.allocation.map((allocation) => ({ ...allocation, sku: item.sku })));
  }
  return { request: request.id, inventory: next, allocations };
}
export function finishPick(plan: ReturnType<typeof planPick>) {
  return consume(plan.inventory, plan.allocations);
}
export function cancelPick(plan: ReturnType<typeof planPick>) {
  return release(plan.inventory, plan.allocations);
}
export function replenishUnits(daily: number): number {
  const target = forecast.orderQuantity(daily, 0.1, 'remote');
  return target / forecast.palletUnit;
}
export function stockCoverage(daily: number): number {
  return forecast.stockProjection(daily, 0.1, 'remote').days;
}
export function pickRoute(bins: string[], distances: ReadonlyMap<string, number>) {
  return [...new Set(bins)].sort((a, b) => (distances.get(a) ?? Infinity) - (distances.get(b) ?? Infinity) || a.localeCompare(b));
}
export function groupRequests(requests: PickRequest[]) {
  const quantities = new Map<string, number>();
  for (const request of requests) {
    for (const item of request.items) quantities.set(item.sku, (quantities.get(item.sku) ?? 0) + item.quantity);
  }
  return [...quantities].map(([sku, quantity]) => ({ sku, quantity }));
}
export function splitLoads(items: Array<{ sku: string; quantity: number }>, capacity: number) {
  if (capacity < 1) throw new RangeError('load capacity');
  const loads: Array<Array<{ sku: string; quantity: number }>> = [];
  let remaining = capacity;
  let current: Array<{ sku: string; quantity: number }> = [];
  for (const item of items) {
    let quantity = item.quantity;
    while (quantity > 0) {
      const taken = Math.min(quantity, remaining);
      current.push({ sku: item.sku, quantity: taken });
      quantity -= taken;
      remaining -= taken;
      if (!remaining) {
        loads.push(current);
        current = [];
        remaining = capacity;
      }
    }
  }
  if (current.length) loads.push(current);
  return loads;
}
