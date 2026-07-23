import test from 'node:test';
import assert from 'node:assert/strict';

import { loadAnalysis, loadQuality } from '../../app/js/analysis/data-client.js';

const SHA = 'a'.repeat(64);
const MADE_SHA = 'b'.repeat(64);
const QUALITY_SHA = 'c'.repeat(64);

function manifest() {
  return {
    schema_version: '2.0',
    observed_at: 1_800_000_000,
    analysis_file: 'analysis-current.json',
    analysis_sha256: SHA,
    analysis_made_file: 'analysis-made-current.json',
    analysis_made_sha256: MADE_SHA,
    quality_file: 'quality.json',
    quality_sha256: QUALITY_SHA,
  };
}

test('made scope loads the small SHA-versioned artifact after a bucketed manifest', async () => {
  const requests = [];
  const fetcher = async (url, options) => {
    requests.push([url, options]);
    if (url.includes('manifest.json')) return { ok: true, json: async () => manifest() };
    return { ok: true, json: async () => ({ schema_version: '2.0', scope: 'made' }) };
  };

  const result = await loadAnalysis('made', fetcher, { nowMs: 1_800_000_000_000 });

  assert.equal(result.data.scope, 'made');
  assert.deepEqual(requests, [
    ['data/v2/manifest.json?v=6000000', { cache: 'no-store' }],
    [`data/v2/analysis-made-current.json?v=${MADE_SHA.slice(0, 16)}`, { cache: 'force-cache' }],
  ]);
});

test('all-site scope reuses a known manifest and loads only the full artifact', async () => {
  const requests = [];
  const fetcher = async (url, options) => {
    requests.push([url, options]);
    return { ok: true, json: async () => ({ schema_version: '2.0', scope: 'all' }) };
  };

  const result = await loadAnalysis('all', fetcher, { manifest: manifest() });

  assert.equal(result.data.scope, 'all');
  assert.deepEqual(requests, [
    [`data/v2/analysis-current.json?v=${SHA.slice(0, 16)}`, { cache: 'force-cache' }],
  ]);
});

test('quality uses its manifest hash and never throws when unavailable', async () => {
  const requests = [];
  const quality = await loadQuality(manifest(), async (url, options) => {
    requests.push([url, options]);
    return { ok: true, json: async () => ({ issues: [] }) };
  });

  assert.deepEqual(quality, { issues: [] });
  assert.deepEqual(requests, [
    [`data/v2/quality.json?v=${QUALITY_SHA.slice(0, 16)}`, { cache: 'force-cache' }],
  ]);
});
