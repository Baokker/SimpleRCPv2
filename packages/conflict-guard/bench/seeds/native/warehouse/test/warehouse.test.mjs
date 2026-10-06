import { it } from 'node:test';
import assert from 'node:assert';
import * as stock from '../src/lots.ts';
import * as picking from '../src/picking.ts';
import * as transfers from '../src/transfers.ts';
import * as counting from '../src/cycleCount.ts';
it('expiry-first allocations conserve total stock and reservations', function () {
  let inventory = stock.receive(new Map(), { id: 'a', sku: 'x', bin: '1', received: 0, expires: 20, quantity: 5, reserved: 0 });
  inventory = stock.receive(inventory, { id: 'b', sku: 'x', bin: '2', received: 1, expires: 10, quantity: 3, reserved: 0 });
  const plan = picking.planPick(inventory, { id: 'order', items: [{ sku: 'x', quantity: 4 }] }, 2);
  assert.deepEqual(plan.allocations.map(({ lot, quantity }) => [lot, quantity]), [['b', 3], ['a', 1]]);
  assert.equal(stock.available(picking.finishPick(plan), 'x', 2), 4);
  assert.equal(stock.available(picking.cancelPick(plan), 'x', 2), 8);
  assert.equal(inventory.get('a').reserved, 0);
  assert.deepEqual(picking.splitLoads([{ sku: 'x', quantity: 7 }], 3).map((load) => load[0].quantity), [3, 3, 1]);
  assert.equal(counting.accuracy([{ lot: 'a', expected: 5, observed: 4, verifiedBy: ['a', 'b'] }]), 0.8);
});
it('transfer movement records time and prevents illegal transitions', function () {
  let transfer = transfers.createTransfer('t', 'north', 'south', 5, 0);
  transfer = transfers.transition(transfer, 'packed', 1);
  transfer = transfers.transition(transfer, 'in-transit', 2);
  assert.equal(transfers.pendingInbound([transfer], 'south'), 5);
  transfer = transfers.transition(transfer, 'received', 10);
  assert.equal(transfers.transitDuration(transfer), 8);
  assert.throws(() => transfers.transition(transfer, 'cancelled', 11));
});
