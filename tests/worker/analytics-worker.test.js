import test from 'node:test';
import assert from 'node:assert/strict';
import { __test } from '../../cloudflare/analytics-worker.js';

test('worker integer validation and origins are strict', () => {
  assert.equal(__test.validInteger('42'),42); assert.equal(__test.validInteger('4.2'),null);
  assert.equal(__test.allowedOrigins({ALLOWED_ORIGINS:'https://a.example, https://b.example'}).has('https://b.example'),true);
});

test('snapshot rows reject malformed identifiers, hours, heat and score', () => {
  assert.deepEqual(__test.validSnapshot({ game_id: 7, captured_hour: 1_800_000_000, heat: 20, score: 8.5 }), { game_id: 7, captured_hour: 1_800_000_000, heat: 20, score: 8.5 });
  assert.equal(__test.validSnapshot({ game_id: null, captured_hour: 1_800_000_000, heat: 20 }), null);
  assert.equal(__test.validSnapshot({ game_id: 7, captured_hour: 1_800_000_001, heat: 20 }), null);
  assert.equal(__test.validSnapshot({ game_id: 7, captured_hour: 1_800_000_000, heat: -1 }), null);
  assert.equal(__test.validSnapshot({ game_id: 7, captured_hour: 1_800_000_000, heat: 20, score: 99 }), null);
});

test('limited body reader enforces actual bytes without trusting Content-Length', async () => {
  const response = new Response(new Uint8Array([1, 2, 3, 4]));
  assert.deepEqual([...await __test.readLimitedBytes(response, 4)], [1, 2, 3, 4]);
  await assert.rejects(() => __test.readLimitedBytes(new Response(new Uint8Array(5)), 4), /too large/);
});
