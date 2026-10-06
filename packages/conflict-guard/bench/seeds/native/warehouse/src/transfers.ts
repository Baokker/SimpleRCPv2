export type TransferState = 'created' | 'packed' | 'in-transit' | 'received' | 'cancelled';
export interface Transfer {
  id: string;
  from: string;
  to: string;
  quantity: number;
  state: TransferState;
  history: Array<{ state: TransferState; at: number }>;
}
const transitions: Record<TransferState, TransferState[]> = {
  created: ['packed', 'cancelled'],
  packed: ['in-transit', 'cancelled'],
  'in-transit': ['received'],
  received: [],
  cancelled: []
};
export function createTransfer(id: string, from: string, to: string, quantity: number, at: number): Transfer {
  if (from === to || quantity <= 0) throw new Error('invalid transfer');
  return { id, from, to, quantity, state: 'created', history: [{ state: 'created', at }] };
}
export function transition(transfer: Transfer, state: TransferState, at: number): Transfer {
  if (!transitions[transfer.state].includes(state)) throw new Error('invalid transition');
  if (at < transfer.history.at(-1)!.at) throw new Error('transfer time ordering');
  return { ...transfer, state, history: [...transfer.history, { state, at }] };
}
export function transitDuration(transfer: Transfer) {
  const start = transfer.history.find((entry) => entry.state === 'in-transit');
  const end = transfer.history.find((entry) => entry.state === 'received');
  return start && end ? end.at - start.at : undefined;
}
export function pendingInbound(transfers: Transfer[], location: string) {
  return transfers.filter((transfer) => transfer.to === location && transfer.state === 'in-transit')
    .reduce((quantity, transfer) => quantity + transfer.quantity, 0);
}
export function stalled(transfers: Transfer[], now: number, limit: number) {
  return transfers.filter((transfer) => transfer.state === 'in-transit' && now - transfer.history.at(-1)!.at > limit);
}
export function throughput(transfers: Transfer[], from: number, through: number) {
  return transfers.filter((transfer) => transfer.state === 'received' && transfer.history.at(-1)!.at >= from && transfer.history.at(-1)!.at <= through)
    .reduce((amount, transfer) => amount + transfer.quantity, 0);
}
export function routeVolumes(transfers: Transfer[]) {
  const totals: Record<string, number> = Object.create(null);
  for (const transfer of transfers) {
    if (transfer.state === 'cancelled') continue;
    const route = `${transfer.from}->${transfer.to}`;
    totals[route] = (totals[route] ?? 0) + transfer.quantity;
  }
  return totals;
}
