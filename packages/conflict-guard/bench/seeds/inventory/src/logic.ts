import type { InventoryItem } from "./types.ts";
export function available(item: InventoryItem, requested: number): boolean { return requested > 0 && item.count >= requested; }
export function reserve(item: InventoryItem, requested: number): InventoryItem { if (!available(item, requested)) throw new RangeError("quantity"); return { ...item, count: item.count - requested }; }
