import type { Invoice } from "./types.ts";
import { payable } from "./logic.ts";
export function statement(invoice: Invoice): string { return `${invoice.currency} ${payable(invoice, 0.2).toFixed(2)}`; }
