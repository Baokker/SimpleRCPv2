import type { CommerceItem } from "./types.ts";
export function total(items: CommerceItem[]): number { return items.reduce((sum, item) => sum + item.price, 0); }
export function discountedTotal(items: CommerceItem[], rate: number): number { return total(items) * (1 - rate); }
