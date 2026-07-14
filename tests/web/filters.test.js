import test from 'node:test';
import assert from 'node:assert/strict';

test('filter test harness is available', () => {
  assert.deepEqual([1, 2].filter(Boolean), [1, 2]);
});
