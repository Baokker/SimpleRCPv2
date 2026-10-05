import type { CommerceItem } from "./types.ts";
import { discountedTotal } from "./logic.ts";
export function receipt(items: CommerceItem[]): string { return discountedTotal(items, 0.1).toFixed(2); }
