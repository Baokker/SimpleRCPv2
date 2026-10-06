import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cacheKey } from './cache.js';
import { createService } from './service.js';
test('distinct tuple keys and concurrent request coalescing', async () => {
  assert.notEqual(cacheKey('a:b', 'c'), cacheKey('a', 'b:c'));
  assert.notEqual(cacheKey('a', 'zh'), cacheKey('a', 'en'));
  let calls = 0;
  const service = createService(async (user, locale) => { calls++; await new Promise(r => setTimeout(r, 10)); return `${user}/${locale}`; });
  assert.deepEqual(await Promise.all([service('a', 'zh'), service('a', 'zh')]), ['a/zh', 'a/zh']);
  assert.equal(calls, 1);
  assert.equal(await service('a', 'en'), 'a/en');
  assert.equal(calls, 2);
});
