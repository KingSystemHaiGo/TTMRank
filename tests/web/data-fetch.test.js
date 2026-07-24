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

test('non-timeout network failures still retry when timeout retries are disabled', async () => {
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
    retryTimeouts: false,
    timeoutMs: 100,
  });

  assert.deepEqual(payload, { ready: true });
  assert.deepEqual(requests, [
    ['data/value.json', 'force-cache'],
    ['data/value.json', 'force-cache'],
  ]);
});

test('request timeouts retain the shared retry behavior by default', async () => {
  let calls = 0;
  await assert.rejects(
    fetchJsonWithRetry('data/value.json', {
      fetcher: async () => {
        calls += 1;
        return new Promise(() => {});
      },
      retries: 1,
      retryDelayMs: 0,
      timeoutMs: 5,
    }),
    /request timeout after 5ms/,
  );
  assert.equal(calls, 2);
});

test('large immutable requests can avoid duplicate downloads after a timeout', async () => {
  let calls = 0;
  await assert.rejects(
    fetchJsonWithRetry('data/v2/analysis-current.0123456789abcdef.json', {
      fetcher: async () => {
        calls += 1;
        return new Promise(() => {});
      },
      retries: 1,
      retryTimeouts: false,
      timeoutMs: 5,
    }),
    /request timeout after 5ms/,
  );
  assert.equal(calls, 1);
});

test('a stalled JSON body keeps the timeout marker and is not downloaded twice', async () => {
  let calls = 0;
  await assert.rejects(
    fetchJsonWithRetry('data/v2/analysis-current.0123456789abcdef.json', {
      fetcher: async () => {
        calls += 1;
        return {
          ok: true,
          status: 200,
          json: async () => {
            await new Promise(resolve => setTimeout(resolve, 20));
            const error = new Error('body aborted');
            error.name = 'AbortError';
            throw error;
          },
        };
      },
      retries: 1,
      retryDelayMs: 0,
      retryTimeouts: false,
      timeoutMs: 5,
    }),
    /request timeout after 5ms/,
  );
  assert.equal(calls, 1);
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
