import test from 'node:test';
import assert from 'node:assert/strict';

import { fetchJsonWithRetry, immutableDataUrl } from '../../app/js/core/data-fetch.js';

test('immutable data files use their filename as the cache key', () => {
  assert.equal(
    immutableDataUrl('data/v2/analysis-current.0123456789abcdef.json', 'f'.repeat(64)),
    'data/v2/analysis-current.0123456789abcdef.json',
  );
  assert.equal(
    immutableDataUrl('data/v2/analysis-current.json', 'f'.repeat(64)),
    `data/v2/analysis-current.json?v=${'f'.repeat(16)}`,
  );
});

test('JSON requests retry once after a transient network failure', async () => {
  const requests = [];
  const fetcher = async (url, options) => {
    requests.push([url, options.cache]);
    if (requests.length === 1) throw new TypeError('temporary edge failure');
    return { ok: true, status: 200, json: async () => ({ ready: true }) };
  };

  const payload = await fetchJsonWithRetry('data/value.json', {
    fetcher,
    cache: 'force-cache',
    retries: 1,
    timeoutMs: 100,
  });

  assert.deepEqual(payload, { ready: true });
  assert.deepEqual(requests, [
    ['data/value.json', 'force-cache'],
    ['data/value.json', 'force-cache'],
  ]);
});

test('HTTP errors are reported without retrying permanent responses', async () => {
  let calls = 0;
  await assert.rejects(
    fetchJsonWithRetry('data/missing.json', {
      fetcher: async () => {
        calls += 1;
        return { ok: false, status: 404, json: async () => ({}) };
      },
      retries: 2,
      timeoutMs: 100,
    }),
    /HTTP 404/,
  );
  assert.equal(calls, 1);
});
