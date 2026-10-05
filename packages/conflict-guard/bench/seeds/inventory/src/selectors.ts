import type { InventoryItem } from "./types.ts";
import { available } from "./logic.ts";
export function inStock(items: InventoryItem[]): string[] { return items.filter((item) => available(item, 1)).map((item) => item.sku); }
