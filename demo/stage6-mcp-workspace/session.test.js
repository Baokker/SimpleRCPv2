import { test } from 'node:test';
import assert from 'node:assert/strict';
import { updateSession } from './session.js';
test('session update', () => { assert.deepEqual(updateSession({}, 'name', 'Ada'), { name: 'Ada' }); });
