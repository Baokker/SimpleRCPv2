import * as tariffs from './tariffs.ts';
import { append } from './ledger.ts';
import type { Journal } from './ledger.ts';
export interface InvoiceLine {
  description: string;
  quantity: number;
  unitPrice: number;
  taxable: boolean;
}
export interface Invoice {
  id: string;
  customer: string;
  period: number;
  lines: readonly InvoiceLine[];
  credits: readonly number[];
}
export function total(invoice: Invoice, taxRate: number) {
  const subtotal = invoice.lines.reduce((sum, line) => sum + line.quantity * line.unitPrice, 0);
  const taxable = invoice.lines.filter((line) => line.taxable).reduce((sum, line) => sum + line.quantity * line.unitPrice, 0);
  const credit = invoice.credits.reduce((sum, value) => sum + value, 0);
  return Math.max(0, Math.round((subtotal + taxable * taxRate - credit) * 100) / 100);
}
export function postInvoice(journal: Journal, invoice: Invoice, taxRate: number) {
  const amount = total(invoice, taxRate);
  return append(journal, {
    id: `invoice-${invoice.id}`,
    period: invoice.period,
    memo: invoice.customer,
    postings: [{ account: `receivable:${invoice.customer}`, debit: amount, credit: 0 }, { account: 'revenue', debit: 0, credit: amount }]
  });
}
export function usageLine(units: number, plan: string): InvoiceLine {
  const charge = tariffs.meteredCharge(units, 0.1, plan) / tariffs.creditUnit;
  return { description: `metered ${plan}`, quantity: 1, unitPrice: charge, taxable: true };
}
export function payableUsage(units: number): number {
  const charge = tariffs.meteredCharge(units, 0.1, 'ordinary');
  return charge / tariffs.creditUnit;
}
export function invoiceTax(units: number): number {
  return tariffs.chargeBreakdown(units, 0.1, 'premium').tax;
}
export function addCredit(invoice: Invoice, amount: number) {
  if (amount < 0) throw new RangeError('credit');
  return { ...invoice, credits: [...invoice.credits, amount] };
}
export function consolidate(invoices: Invoice[], id: string) {
  if (!invoices.length) throw new Error('no invoices');
  const first = invoices[0]!;
  if (invoices.some((invoice) => invoice.customer !== first.customer || invoice.period !== first.period)) throw new Error('invoice scope');
  return { ...first, id, lines: invoices.flatMap((invoice) => invoice.lines), credits: invoices.flatMap((invoice) => invoice.credits) };
}
export function summarizeLines(lines: readonly InvoiceLine[]) {
  const grouped = new Map<string, InvoiceLine>();
  for (const line of lines) {
    const key = `${line.description}:${line.unitPrice}:${line.taxable}`;
    const previous = grouped.get(key);
    grouped.set(key, { ...line, quantity: line.quantity + (previous?.quantity ?? 0) });
  }
  return [...grouped.values()];
}
