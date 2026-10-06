import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cents } from './money.js';
import { total } from './cart.js';
test('integer cents and quantities', () => {
  assert.equal(cents(1.005), 101);
  assert.equal(total([{price: 1.005, quantity: 3}, {price: 2, quantity: 2}]), 703);
  assert.equal(total([]), 0);
});
