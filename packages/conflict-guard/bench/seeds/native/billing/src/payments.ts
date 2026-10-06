export interface Payment {
  id: string;
  customer: string;
  amount: number;
  remaining: number;
}
export interface Debt {
  invoice: string;
  customer: string;
  due: number;
  remaining: number;
}
export function allocate(payment: Payment, debts: readonly Debt[]) {
  let available = payment.remaining;
  const allocations: Array<{ invoice: string; amount: number }> = [];
  const ordered = debts.filter((debt) => debt.customer === payment.customer && debt.remaining > 0).sort((a, b) => a.due - b.due || a.invoice.localeCompare(b.invoice));
  for (const debt of ordered) {
    const amount = Math.min(available, debt.remaining);
    if (amount <= 0) break;
    allocations.push({ invoice: debt.invoice, amount });
    available -= amount;
  }
  const byInvoice = new Map(allocations.map((allocation) => [allocation.invoice, allocation.amount]));
  return {
    payment: { ...payment, remaining: available },
    debts: debts.map((debt) => ({ ...debt, remaining: debt.remaining - (byInvoice.get(debt.invoice) ?? 0) })),
    allocations
  };
}
export function overdue(debts: readonly Debt[], now: number) {
  return debts.filter((debt) => debt.due < now && debt.remaining > 0);
}
export function aging(debts: readonly Debt[], now: number) {
  const buckets = { current: 0, month: 0, quarter: 0, older: 0 };
  for (const debt of debts) {
    const age = now - debt.due;
    if (age <= 0) buckets.current += debt.remaining;
    else if (age <= 30) buckets.month += debt.remaining;
    else if (age <= 90) buckets.quarter += debt.remaining;
    else buckets.older += debt.remaining;
  }
  return buckets;
}
export function refund(payment: Payment, amount: number) {
  if (amount < 0 || amount > payment.remaining) throw new Error('refund exceeds unapplied payment');
  return { ...payment, amount: payment.amount - amount, remaining: payment.remaining - amount };
}
export function outstanding(debts: readonly Debt[], customer: string) {
  return debts.filter((debt) => debt.customer === customer).reduce((sum, debt) => sum + debt.remaining, 0);
}
