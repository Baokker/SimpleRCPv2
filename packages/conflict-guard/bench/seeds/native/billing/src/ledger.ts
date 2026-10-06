export interface Posting {
  account: string;
  debit: number;
  credit: number;
}
export interface JournalEntry {
  id: string;
  period: number;
  postings: readonly Posting[];
  memo: string;
  reversedBy?: string;
}
export type Journal = readonly JournalEntry[];
export function append(journal: Journal, entry: JournalEntry): Journal {
  if (journal.some((existing) => existing.id === entry.id)) throw new Error('duplicate entry');
  if (!entry.postings.length) throw new Error('empty posting');
  let debit = 0;
  let credit = 0;
  for (const posting of entry.postings) {
    if (posting.debit < 0 || posting.credit < 0 || posting.debit && posting.credit) throw new Error('posting direction');
    debit += Math.round(posting.debit * 100);
    credit += Math.round(posting.credit * 100);
  }
  if (debit !== credit) throw new Error('unbalanced entry');
  return [...journal, { ...entry, postings: entry.postings.map((posting) => ({ ...posting })) }];
}
export function balance(journal: Journal, account: string, through = Infinity) {
  return journal.filter((entry) => entry.period <= through)
    .flatMap((entry) => entry.postings)
    .filter((posting) => posting.account === account)
    .reduce((amount, posting) => amount + posting.debit - posting.credit, 0);
}
export function trialBalance(journal: Journal, through = Infinity) {
  const accounts = new Set(journal.flatMap((entry) => entry.postings.map((posting) => posting.account)));
  return Object.fromEntries([...accounts].sort().map((account) => [account, balance(journal, account, through)]));
}
export function reverse(journal: Journal, id: string, reversalId: string, period: number) {
  const entry = journal.find((item) => item.id === id);
  if (!entry || entry.reversedBy) throw new Error('entry cannot be reversed');
  const updated = journal.map((item) => item.id === id ? { ...item, reversedBy: reversalId } : item);
  return append(updated, {
    id: reversalId,
    period,
    memo: `reverse ${id}`,
    postings: entry.postings.map((posting) => ({ account: posting.account, debit: posting.credit, credit: posting.debit }))
  });
}
export function statement(journal: Journal, account: string) {
  let running = 0;
  return journal.flatMap((entry) => {
    const delta = entry.postings.filter((posting) => posting.account === account).reduce((sum, posting) => sum + posting.debit - posting.credit, 0);
    if (!delta) return [];
    running += delta;
    return [{ id: entry.id, period: entry.period, delta, balance: running }];
  });
}
export function closePeriod(journal: Journal, period: number, incomeAccounts: string[], equityAccount: string) {
  const postings = incomeAccounts.map((account) => {
    const amount = balance(journal, account, period);
    return { account, debit: Math.max(0, -amount), credit: Math.max(0, amount) };
  });
  const net = postings.reduce((sum, posting) => sum + posting.debit - posting.credit, 0);
  postings.push({ account: equityAccount, debit: Math.max(0, -net), credit: Math.max(0, net) });
  return append(journal, { id: `close-${period}`, period, memo: 'period closure', postings });
}
