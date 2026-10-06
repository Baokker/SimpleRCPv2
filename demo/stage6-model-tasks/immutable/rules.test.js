import { test } from 'node:test';
import assert from 'node:assert/strict';
import { byPrice } from './sort.js';
import { cheapest } from './catalog.js';
test('immutable catalog and empty result', () => {
  const items = Object.freeze([Object.freeze({price: 3, name: 'A'}), Object.freeze({price: 1, name: 'B'})]);
  assert.deepEqual(byPrice(items).map(i => i.name), ['B', 'A']);
  assert.equal(cheapest(items), 'B');
  assert.equal(cheapest([]), null);
  assert.equal(items[0].name, 'A');
});
