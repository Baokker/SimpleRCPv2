import { suite, test } from 'node:test';
import { deepStrictEqual as same, strictEqual as equals, throws as rejects } from 'node:assert';
import { append, balance, reverse, trialBalance } from '../src/ledger.ts';
import { total, addCredit, postInvoice } from '../src/invoices.ts';
import { allocate, aging } from '../src/payments.ts';
import { usage, validateReadings } from '../src/meter.ts';
suite('immutable accounting', () => {
  test('balanced entries, credits and oldest debt allocation', () => {
    const invoice = { id: 'i', customer: 'c', period: 1, credits: [], lines: [{ description: 'service', quantity: 2, unitPrice: 10, taxable: true }] };
    equals(total(addCredit(invoice, 3), 0.1), 19);
    const journal = postInvoice([], invoice, 0.1);
    equals(balance(journal, 'receivable:c'), 22);
    same(Object.values(trialBalance(journal)).reduce((sum, amount) => sum + amount, 0), 0);
    const reversed = reverse(journal, 'invoice-i', 'reverse-i', 2);
    equals(balance(reversed, 'revenue'), 0);
    rejects(() => append([], { id: 'bad', period: 1, memo: '', postings: [{ account: 'cash', debit: 1, credit: 0 }] }));
    const debts = [{ invoice: 'old', customer: 'c', due: 1, remaining: 10 }, { invoice: 'new', customer: 'c', due: 9, remaining: 20 }];
    const applied = allocate({ id: 'p', customer: 'c', amount: 15, remaining: 15 }, debts);
    same(applied.allocations.map((item) => item.amount), [10, 5]);
    equals(debts[0].remaining, 10);
    equals(aging(applied.debts, 20).month, 15);
  });
  test('meter resets count new readings without negative usage', () => {
    const readings = [{ account: 'c', meter: 'm', at: 1, value: 10 }, { account: 'c', meter: 'm', at: 2, value: 15 }, { account: 'c', meter: 'm', at: 3, value: 2 }];
    equals(validateReadings(readings), true);
    equals(usage(readings, 0, 3)['c:m'], 7);
  });
});
