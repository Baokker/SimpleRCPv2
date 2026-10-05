import type { Invoice } from "./types.ts";
export function tax(invoice: Invoice, rate: number): number { return Math.round(invoice.total * rate * 100) / 100; }
export function payable(invoice: Invoice, rate: number): number { return invoice.total + tax(invoice, rate); }
